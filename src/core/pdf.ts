/**
 * Inspection and redaction of PDF metadata.
 *
 * A PDF carries identifying data in two independent places, and tools that
 * clean only one of them leave the other intact:
 *   - the /Info dictionary (Title, Author, Creator, Producer, dates)
 *   - an XMP packet in the catalog's /Metadata stream, which is where
 *     C2PA content credentials are attached when present
 * Both are handled here. Page content is never touched.
 */

import { PDFDocument, PDFName, PDFDict, PDFRef, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { parseToUnicode, decodeWithToUnicode, type ToUnicode } from './cmap.js';
import type { Finding, InspectResult, RedactResult, Note } from './types.js';
import { byConfidence, preview } from './types.js';
import { fingerprint } from './fingerprint.js';
import { scanContent } from './archive.js';
import { scanText, isArrangementFinding } from './text.js';
import { describeC2pa } from './c2pa.js';
import { findSourceTypes } from './sourcetype.js';

const INFO_FIELDS = [
  { key: 'Title', label: 'Title', kind: 'identity' as const, confidence: 'probable' as const },
  { key: 'Author', label: 'Author', kind: 'identity' as const, confidence: 'confirmed' as const },
  { key: 'Subject', label: 'Subject', kind: 'identity' as const, confidence: 'probable' as const },
  { key: 'Keywords', label: 'Keywords', kind: 'identity' as const, confidence: 'probable' as const },
  { key: 'Creator', label: 'Creating application', kind: 'provenance' as const, confidence: 'informational' as const },
  { key: 'Producer', label: 'Producing application', kind: 'provenance' as const, confidence: 'informational' as const },
  { key: 'CreationDate', label: 'Created', kind: 'timestamp' as const, confidence: 'probable' as const },
  { key: 'ModDate', label: 'Modified', kind: 'timestamp' as const, confidence: 'probable' as const },
];

async function load(data: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(data, {
    updateMetadata: false,
    ignoreEncryption: true,
    throwOnInvalidObject: false,
  });
}

/** Read the XMP packet, inflating it when the stream is Flate-encoded. */
/**
 * The document catalog, but only when it really is a dictionary.
 *
 * `doc.catalog` is typed as one, and with `throwOnInvalidObject: false` a
 * damaged file can leave something else there entirely — a number, a string,
 * whatever the trailer pointed at. Optional chaining guards against it being
 * absent and says nothing about it being the wrong shape, so `catalog?.get(…)`
 * threw a TypeError on a corrupted file. Found by fuzzing, which is the only
 * way this shape of input ever reaches the code.
 */
function catalogDict(doc: PDFDocument): PDFDict | undefined {
  const catalog = doc.catalog as unknown;
  return catalog instanceof PDFDict ? catalog : undefined;
}

function readXmp(doc: PDFDocument): string | undefined {
  // `throwOnInvalidObject: false` lets a damaged file load with no catalog at
  // all, and reading through it then fails as a TypeError rather than as
  // something a caller can report. A file that starts with %PDF is not a
  // promise that the rest of it parses.
  const ref = catalogDict(doc)?.get(PDFName.of('Metadata'));
  if (!ref) return undefined;
  const stream = doc.context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) return undefined;
  try {
    const bytes = decodePDFRawStream(stream).decode();
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Pull a single XMP property value, tolerating both element and attribute syntax. */
function xmpValue(xmp: string, property: string): string | undefined {
  const p = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const element = new RegExp(`<${p}[^>]*>([\\s\\S]*?)</${p}>`).exec(xmp);
  if (element?.[1]) {
    const text = element[1].replace(/<[^>]*>/g, '').trim();
    if (text) return text;
  }
  const attribute = new RegExp(`\\s${p}="([^"]*)"`).exec(xmp);
  return attribute?.[1] || undefined;
}

const XMP_FIELDS = [
  { property: 'xmp:CreatorTool', label: 'XMP creator tool', kind: 'provenance' as const, confidence: 'informational' as const },
  { property: 'pdf:Producer', label: 'XMP producer', kind: 'provenance' as const, confidence: 'informational' as const },
  { property: 'dc:creator', label: 'XMP author', kind: 'identity' as const, confidence: 'confirmed' as const },
  { property: 'dc:title', label: 'XMP title', kind: 'identity' as const, confidence: 'probable' as const },
  { property: 'xmp:CreateDate', label: 'XMP created', kind: 'timestamp' as const, confidence: 'probable' as const },
  { property: 'xmp:ModifyDate', label: 'XMP modified', kind: 'timestamp' as const, confidence: 'probable' as const },
  { property: 'xmpMM:DocumentID', label: 'XMP document ID', kind: 'environment' as const, confidence: 'probable' as const },
  { property: 'xmpMM:InstanceID', label: 'XMP instance ID', kind: 'environment' as const, confidence: 'probable' as const },
];

function looksLikeC2pa(xmp: string): boolean {
  return /c2pa|contentcredentials|content_credentials|claim_generator/i.test(xmp);
}

/** Cap on decompressed bytes read from streams, so a crafted PDF cannot stall the tab. */
const MAX_STREAM_BYTES = 8 * 1024 * 1024;

/**
 * Recover the readable text from a decoded content stream.
 *
 * Page text is not stored as plain bytes. It sits inside PDF string operands,
 * either literal `(like this)` or hexadecimal `<4C696B65>`, and most producers
 * choose hex — which is why a byte search over a decompressed stream finds
 * nothing even when the words are plainly there. Both forms are decoded here.
 */
function extractPdfStrings(stream: string): string {
  const pieces: string[] = [];

  // Hex strings. The negative lookbehind keeps dictionary delimiters (<<) out.
  for (const match of stream.matchAll(/(?<!<)<([0-9A-Fa-f\s]+)>(?!>)/g)) {
    const hex = (match[1] ?? '').replace(/\s+/g, '');
    if (hex.length < 2) continue;
    const bytes = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    pieces.push(decodePdfText(bytes));
  }

  // Literal strings, honouring backslash escapes.
  for (const match of stream.matchAll(/\(((?:[^()\\]|\\[\s\S])*)\)/g)) {
    const body = match[1] ?? '';
    if (!body) continue;
    pieces.push(body.replace(/\\([nrtbf()\\])/g, (_, c: string) =>
      c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c,
    ));
  }

  return pieces.join(' ');
}

/**
 * Decode a PDF text string.
 *
 * The spec says UTF-16BE when a byte-order mark is present and 8-bit
 * otherwise, but producers routinely emit UTF-16BE with no mark at all. Read as
 * Latin-1 that turns "Bonjour" into NUL-separated letters, and a zero-width
 * space (U+200B) into a space followed by a vertical tab — the exact character
 * this is meant to catch, silently destroyed.
 */
function decodePdfText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be', { fatal: false }).decode(bytes.subarray(2));
  }
  // A NUL byte does not occur in a real single-byte text string, but appears in
  // every ASCII character of an unmarked UTF-16BE one. That is a far steadier
  // signal than counting zero high bytes, which flips on the mix of scripts in
  // the string rather than on its encoding.
  if (bytes.length % 2 === 0 && bytes.includes(0)) {
    return new TextDecoder('utf-16be', { fatal: false }).decode(bytes);
  }
  return new TextDecoder('latin1').decode(bytes);
}

/**
 * Scan every decompressed stream in the document.
 *
 * Page text, embedded attachments, JavaScript and form data all live in
 * streams, usually Flate-compressed, so a plain byte search over the file finds
 * none of them. Decoding first is what makes an API key pasted into a paragraph
 * visible. Only unambiguous patterns are looked for — see archive.ts.
 */
function scanStreams(doc: PDFDocument): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let budget = MAX_STREAM_BYTES;

  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (budget <= 0) break;
    if (!(object instanceof PDFRawStream)) continue;
    let bytes: Uint8Array;
    try {
      bytes = decodePDFRawStream(object).decode();
    } catch {
      continue; // Unsupported filter (DCT, JPX); not text anyway.
    }
    budget -= bytes.length;
    const raw = new TextDecoder('latin1').decode(
      bytes.subarray(0, Math.min(bytes.length, MAX_STREAM_BYTES)),
    );
    // Scan both the raw stream (XMP, JavaScript, attachments) and the decoded
    // string operands (page text), since the two hide different things.
    const text = `${raw}\n${extractPdfStrings(raw)}`;
    const location = `stream ${ref.toString()}`;
    const candidates = [...scanContent(text, location), ...scanPdfPageText(raw, location)];
    for (const finding of candidates) {
      const key = `${finding.label}:${finding.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding);
    }
  }
  return findings;
}

/**
 * Invisible characters in the decoded page text.
 *
 * This is weaker than the equivalent check on a DOCX, and deliberately so.
 * A PDF string operand holds glyph codes, not Unicode: with a simple encoding
 * they coincide, but an embedded subset font maps them arbitrarily and only its
 * ToUnicode CMap can undo that. So a hit here is real, while a miss proves
 * nothing — which is why the scope note says the absence of findings in a PDF
 * body is not evidence of a clean body.
 */
function scanPdfPageText(stream: string, location: string): Finding[] {
  const scan = scanText(extractPdfStrings(stream));
  const findings: Finding[] = scan.findings
    // Exotic spaces are far too common in PDF text layout to be meaningful,
    // and a content stream's own newlines are not the document's.
    .filter((finding) => finding.confidence !== 'informational' && !isArrangementFinding(finding))
    .map((finding) => ({ ...finding, location: `${location} (${finding.location})` }));
  for (const payload of scan.decoded) {
    findings.push({
      kind: 'invisible-character',
      confidence: 'confirmed',
      location,
      label: 'Hidden payload in page text',
      value: payload,
    });
  }
  return findings;
}

/**
 * Page text decoded through the fonts the page actually uses, one string per
 * page. Split out from the scanning below so the same decoding can be run over
 * an earlier revision of the file and compared with this one.
 *
 * The raw-stream pass above reads string operands as if their bytes were
 * characters, which is right for a simple encoding and useless for an embedded
 * subset — and a subset is what every producer embeds as soon as the text has
 * accents. Here each page's `/Resources /Font` entries are resolved to their
 * `/ToUnicode` CMaps, the content stream is walked tracking the `Tf` operator
 * so the right map applies to each string, and the result is real text.
 */
function pageTexts(doc: PDFDocument): string[] {
  const texts: string[] = [];

  // Same reason readXmp guards its catalog read: a lenient load can produce a
  // document with no page tree at all, and walking it then fails as a
  // TypeError rather than as something a caller can report.
  let pages: ReturnType<PDFDocument['getPages']>;
  try {
    pages = doc.getPages();
  } catch {
    return texts;
  }

  pages.forEach((page) => {
    texts.push('');
    const fonts = new Map<string, ToUnicode>();
    try {
      const resources = page.node.Resources();
      const fontDict = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
      for (const [name, ref] of fontDict?.entries() ?? []) {
        const font = doc.context.lookupMaybe(ref, PDFDict);
        const toUnicode = font?.get(PDFName.of('ToUnicode'));
        const stream = toUnicode && doc.context.lookup(toUnicode);
        // pdf-lib's typed lookup has no PDFRawStream overload, so the class
        // check does the narrowing the way readXmp does above.
        if (!(stream instanceof PDFRawStream)) continue;
        const table = parseToUnicode(
          new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()),
        );
        // asString() keeps the leading slash that PDF names carry; the content
        // stream's operand is matched without it, so the key drops it too.
        if (table) fonts.set(name.asString().replace(/^\//, ''), table);
      }
    } catch {
      return; // A damaged resource tree is not worth failing the whole report.
    }
    if (fonts.size === 0) return;

    let content: string;
    try {
      content = page.node
        .normalizedEntries()
        .Contents?.asArray()
        .map((ref) => {
          const stream = doc.context.lookup(ref);
          return stream instanceof PDFRawStream
            ? new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode())
            : '';
        })
        .join('\n') ?? '';
    } catch {
      return;
    }

    let current: ToUnicode | undefined = fonts.size === 1 ? [...fonts.values()][0] : undefined;
    const pieces: string[] = [];
    // One pass over the operators that matter: `/Name size Tf` switches font,
    // and any hex string is text drawn with whichever font is current.
    for (const token of content.matchAll(/\/([^\s/<>[\]()]+)[^/]*?\bTf\b|<([0-9A-Fa-f\s]+)>/g)) {
      if (token[1] !== undefined) {
        current = fonts.get(token[1]) ?? current;
        continue;
      }
      if (!current) continue;
      const hex = (token[2] ?? '').replace(/\s+/g, '');
      if (hex.length < 2) continue;
      const bytes = new Uint8Array(Math.floor(hex.length / 2));
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      pieces.push(decodeWithToUnicode(bytes, current));
    }

    texts[texts.length - 1] = pieces.join(' ');
  });

  return texts;
}

function scanPageFonts(doc: PDFDocument): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  pageTexts(doc).forEach((text, index) => {
    if (!text) return;
    const scan = scanText(text);
    const location = `page ${index + 1}`;
    for (const finding of scan.findings) {
      // Layout spacing is the producer's, not the author's, and exotic spaces
      // are how a PDF kerns — both would be noise here.
      if (finding.confidence === 'informational' || isArrangementFinding(finding)) continue;
      const key = `${finding.label}:${finding.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ ...finding, location: `${location} (${finding.location})` });
    }
    for (const payload of scan.decoded) {
      findings.push({
        kind: 'invisible-character',
        confidence: 'confirmed',
        location,
        label: 'Hidden payload in page text',
        value: payload,
      });
    }
  });

  return findings;
}

/**
 * What a PDF's own construction says about who built it.
 *
 * Same reasoning as the OOXML equivalent: every other check reads a field that
 * names a tool, and finds nothing when the tool does not sign itself. A PDF
 * carries its answer in the parts a producer either writes or does not.
 *
 * The signals are not equal, and treating them as equal is how a check like
 * this starts accusing people. Two carry weight:
 *
 *   - A trailer with no `/ID`. The specification asks for one, and Acrobat,
 *     Word, LibreOffice and pdfTeX all write it. Omitting it is a library
 *     shortcut, not something an interactive application does.
 *   - Creation and modification stamped at the same instant: written once in a
 *     single pass, never reopened and saved again.
 *
 * Two more are suggestive on their own but far too common to lean on:
 *
 *   - No XMP `/Metadata`, and no `/StructTreeRoot`. Word and LibreOffice write
 *     both, which is why they look conclusive — but a file printed to PDF from
 *     Preview, a browser or an older driver has neither, and a person did that.
 *
 * So one of the two weighty signals is required, plus a second of any kind.
 * The weak pair alone says nothing and is reported as nothing. Even then the
 * conclusion is narrow: a program built this file — not which program, and not
 * that a model wrote the words in it.
 */
function structuralPdf(doc: PDFDocument, findings: Finding[]): Finding[] {
  const out: Finding[] = [];

  // An /Info dictionary that exists and holds nothing is not a shape any
  // producer emits — every one of them writes at least a /Producer. It means
  // the file was scrubbed, which is worth saying plainly: removing metadata
  // leaves its own trace, and a reader of this report deserves to know that
  // about someone else's file as much as about their own.
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (info && 'keys' in info && [...(info as { keys(): unknown[] }).keys()].length === 0) {
    out.push({
      kind: 'provenance',
      confidence: 'confirmed',
      location: 'trailer /Info',
      label: 'Metadata has been stripped from this file',
      value:
        'the /Info dictionary is present and empty, which no producer writes — every one of them ' +
        'records at least a /Producer. Cleaning a document leaves this shape behind',
    });
  }

  const strong: string[] = [];
  if (!doc.context.trailerInfo.ID) strong.push('the trailer carries no /ID, which the format asks for');

  const created = findings.find((f) => f.label === 'Created')?.value;
  const modified = findings.find((f) => f.label === 'Modified')?.value;
  if (created && created === modified) strong.push('created and modified at the same instant');

  const weak: string[] = [];
  if (!catalogDict(doc)?.get(PDFName.of('Metadata'))) weak.push('no XMP metadata packet');
  if (!catalogDict(doc)?.get(PDFName.of('StructTreeRoot'))) weak.push('not tagged for accessibility');

  // One weighty signal is the entry price. Without it the file is only missing
  // things that a print-to-PDF driver also leaves out, and saying anything
  // there would put a person's own document under suspicion.
  if (strong.length >= 1 && strong.length + weak.length >= 2) {
    out.push({
      kind: 'provenance',
      confidence: strong.length >= 2 ? 'probable' : 'informational',
      location: 'file structure',
      label: 'Assembled by a program, not exported from an editor',
      value:
        [...strong, ...weak].join('; ') +
        (weak.length && strong.length < 2
          ? ' — the last of these are also absent from a file printed to PDF'
          : ''),
    });
  }
  return out;
}

/**
 * Earlier revisions of the document, still inside the file.
 *
 * A PDF can be saved incrementally: the writer appends a new body and a new
 * cross-reference table pointing back at the old one with `/Prev`, and leaves
 * everything that came before exactly where it was. The reader shows the latest
 * revision. The bytes of every earlier one are still there.
 *
 * This is the mechanism behind most published redaction failures. A name is
 * covered with a black rectangle, the file is saved, and the original text sits
 * in the previous revision for anyone who opens the file in a text editor. The
 * tool cannot extract what is in there — doing that properly means parsing each
 * revision as its own document — but it can say that it exists, which is the
 * part the author needs to know before sending the file.
 *
 * Linearised files are the false positive to avoid. "Fast web view" writes a
 * second cross-reference section at the front so a viewer can render page one
 * before the rest arrives, and that section carries a `/Prev` like an update
 * would. It is one revision in two pieces, not two revisions, so a file that
 * declares `/Linearized` gets one section discounted.
 */
function priorRevisions(data: Uint8Array): Finding[] {
  /*
   * ASCII-only markers, so a byte scan is exact and never decodes the file.
   *
   * This read `Buffer.from(data).toString('latin1')` and broke the web build:
   * `Buffer` is a Node global with no browser equivalent, so every PDF dropped
   * on the page failed with "Buffer is not defined". The whole test suite
   * passed, because every test runs under Node. `latin1` here is the WHATWG
   * label for windows-1252, which differs from true Latin-1 only in 0x80–0x9F —
   * irrelevant when the only things looked for are `%%EOF` and `/Linearized`.
   * What matters is that it stays a single byte per character, so every index
   * below is a byte offset.
   */
  const text = new TextDecoder('latin1').decode(data);
  const eof = (text.match(/%%EOF/g) ?? []).length;
  const linearised = /\/Linearized/.test(text.slice(0, 4096));
  const revisions = eof - (linearised ? 1 : 0);
  if (revisions < 2) return [];

  const firstEof = text.indexOf('%%EOF');
  const retained = firstEof > 0 ? firstEof : 0;
  const share = Math.round((retained / data.length) * 100);

  return [
    {
      kind: 'provenance',
      confidence: 'confirmed',
      location: 'file revisions',
      label: 'Earlier versions of this document are still in the file',
      value:
        `${revisions} revisions are present${linearised ? ' (one cross-reference section discounted as linearisation)' : ''}. ` +
        `A reader shows only the newest; the previous ones were appended to, never removed, and the ` +
        `first ends ${retained.toLocaleString('en-US')} bytes in — about ${share}% of the file. ` +
        `Text covered or deleted in a later revision is still readable in an earlier one`,
    },
  ];
}

/*
 * Reading an earlier revision costs a parse each time, on a file a stranger
 * supplied. At most this many are opened, and none is started that is
 * predicted to run past the deadline.
 *
 * The prediction is the point. pdf-lib spends about nine seconds a megabyte on
 * bytes that sit outside any object, scanning for the next `obj` one byte at a
 * time, so a hostile file is slow to parse whatever this code does. Checking
 * the clock between parses is not enough: one parse started a millisecond
 * before the deadline runs to completion. A first version guarded with a count
 * of object headers per 256 KB instead, and measurement showed it doing
 * nothing — a 262 KB file of filler holding six objects passed it, and cost a
 * second full parse — while any stricter count would have skipped the
 * revisions of a legitimate scanned PDF, which is a few objects wrapped around
 * very large images. Time is what matters, and the caller has already measured
 * it: a prefix costs roughly its share of what the whole file took.
 */
const MAX_REVISIONS_READ = 6;
const REVISION_DEADLINE_MS = 2_000;

/** Offsets just past each `%%EOF`, which is where one revision ends. */
function eofOffsets(text: string): number[] {
  const offsets: number[] = [];
  for (const match of text.matchAll(/%%EOF/g)) {
    offsets.push((match.index ?? 0) + '%%EOF'.length);
  }
  return offsets;
}

/**
 * Everything a document says in words, for comparing one revision with another.
 *
 * Both decoders are used because each fails where the other works. A subset
 * font maps glyph codes arbitrarily and only its ToUnicode CMap can undo that,
 * which is what `pageTexts` does; but a page using a standard encoding carries
 * no CMap at all, and there the string operands are already the characters.
 * Using one alone would make the comparison silently empty for half the files
 * it is asked about.
 */
function documentText(doc: PDFDocument): string {
  const pieces = pageTexts(doc).filter(Boolean);
  let budget = MAX_STREAM_BYTES;

  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (budget <= 0) break;
    if (!(object instanceof PDFRawStream)) continue;
    let bytes: Uint8Array;
    try {
      bytes = decodePDFRawStream(object).decode();
    } catch {
      continue; // Unsupported filter (DCT, JPX); not text anyway.
    }
    budget -= bytes.length;
    pieces.push(
      extractPdfStrings(
        new TextDecoder('latin1').decode(
          bytes.subarray(0, Math.min(bytes.length, MAX_STREAM_BYTES)),
        ),
      ),
    );
  }

  return pieces.join(' ');
}

/** One spelling per piece of text, so the comparison is about words. */
function normalise(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SHINGLE = 4;

/**
 * Runs of words the earlier revision has and the current one does not.
 *
 * Word sets would be useless — every document shares "de", "the", "le" — and a
 * whole-string comparison would call an entire page lost over one edited
 * character. Overlapping four-word shingles sit between the two: a word counts
 * as surviving when any window containing it still occurs in the current text,
 * so an unchanged paragraph stays quiet and a deleted sentence comes back
 * whole.
 *
 * Short runs are kept rather than filtered away. A first attempt dropped
 * anything under three words to suppress re-flow noise, and in doing so threw
 * away the case the whole feature exists for: one amount, one name, one
 * account number, changed and saved. They are reported with the surviving
 * words either side, so a reader can see whether they are looking at a
 * redacted figure or at a page number that moved.
 */
interface Lost {
  /** The words the current revision no longer has. */
  run: string;
  /** Those words with the surviving ones either side, when there are any. */
  context: string;
  words: number;
}

const CONTEXT_WORDS = 4;

function lostText(before: string, after: string): Lost[] {
  const old = normalise(before);
  const now = normalise(after);
  if (!old) return [];

  const oldWords = old.split(' ');
  if (oldWords.length < SHINGLE) {
    // Too short to shingle; containment is the only honest answer.
    return now.includes(old) ? [] : [{ run: old, context: old, words: oldWords.length }];
  }

  const present = new Set<string>();
  const newWords = now ? now.split(' ') : [];
  for (let i = 0; i + SHINGLE <= newWords.length; i++) {
    present.add(newWords.slice(i, i + SHINGLE).join(' '));
  }

  const covered = new Array<boolean>(oldWords.length).fill(false);
  for (let i = 0; i + SHINGLE <= oldWords.length; i++) {
    if (!present.has(oldWords.slice(i, i + SHINGLE).join(' '))) continue;
    for (let k = i; k < i + SHINGLE; k++) covered[k] = true;
  }

  const runs: Lost[] = [];
  let start = -1;
  for (let i = 0; i <= oldWords.length; i++) {
    const lost = i < oldWords.length && !covered[i];
    if (lost && start < 0) start = i;
    if (!lost && start >= 0) {
      runs.push({
        run: oldWords.slice(start, i).join(' '),
        context: oldWords
          .slice(Math.max(0, start - CONTEXT_WORDS), Math.min(oldWords.length, i + CONTEXT_WORDS))
          .join(' '),
        words: i - start,
      });
      start = -1;
    }
  }
  return runs;
}

/**
 * Text that an earlier revision still holds and the current one no longer shows.
 *
 * `priorRevisions` above can say that earlier versions are in the file; it
 * cannot say what is in them, and a warning a reader cannot act on is a warning
 * they learn to skip. Each earlier revision is a complete PDF ending at its own
 * `%%EOF`, so truncating the file there and parsing the prefix gives the
 * document as it stood — no new parser, the same two decoders run again.
 *
 * Only what disappeared is reported. Text still on the page is the current
 * document's business and every other check already covers it; what matters
 * here is the sentence someone deleted, saved, and believed was gone.
 */
/**
 * Exported for its tests, which pass `parseMs` directly: the decision not to
 * start a parse is what needs testing, and timing pdf-lib on a CI runner
 * cannot test it — the same file parses four times slower on one machine than
 * on another, so any threshold in seconds is either flaky or meaningless.
 * Callers outside this file use {@link inspectPdf}.
 */
export async function revisionLeaks(data: Uint8Array, doc: PDFDocument, parseMs: number): Promise<Finding[]> {
  const deadline = Date.now() + REVISION_DEADLINE_MS;

  const text = new TextDecoder('latin1').decode(data);
  const ends = eofOffsets(text);
  // The last offset ends the current revision, which is the thing compared
  // against rather than a candidate.
  const earlier = ends.slice(0, -1).slice(-MAX_REVISIONS_READ);
  if (earlier.length === 0) return [];

  // The caller already parsed this file; parsing it a second time to read its
  // own text would double the cost of every multi-revision document.
  const current = documentText(doc);

  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const [index, end] of earlier.entries()) {
    const predicted = parseMs * (end / data.length);
    if (Date.now() + predicted > deadline) break;
    let older: string;
    try {
      older = documentText(await load(data.subarray(0, end)));
    } catch {
      // Expected, and not a failure worth reporting: a prefix of a linearised
      // or object-stream file is often not a document on its own. The count
      // finding above still stands.
      continue;
    }

    for (const lost of lostText(older, current)) {
      const key = lost.run.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        kind: 'identity',
        // A deleted phrase is unambiguous. One or two changed words are just as
        // often a page number or a date that moved, so they are graded for what
        // they are rather than asserted.
        confidence: lost.words >= 3 ? 'confirmed' : 'probable',
        location: `revision ${index + 1}`,
        label: 'Text an earlier revision still holds',
        value:
          `"${preview(lost.run, 160)}" — in an earlier revision, not in the current one` +
          (lost.context === lost.run ? '' : `; in context: "${preview(lost.context, 160)}"`),
      });
      if (findings.length >= 20) return findings;
    }
  }

  return findings;
}

/**
 * Annotation authors, which are comment metadata rather than page content.
 *
 * A sticky note, a highlight or a review comment carries `/T` — the title of
 * the annotation, which every reader fills with the commenter's name — and
 * often `/M`, when they wrote it. A document that went through review names
 * everyone who touched it, and nothing on the page shows that.
 */
/**
 * Every annotation dictionary the pages carry.
 *
 * One walk, shared by the reader above and the cleaner below, so that the two
 * can never disagree about which annotations exist — a reader that found a
 * name the cleaner did not visit would report a removal that never happened.
 * Popup notes and replies (`/IRT`) are annotations in the same `/Annots`
 * arrays, so they are covered without being named.
 */
function annotationDicts(doc: PDFDocument): PDFDict[] {
  const found: PDFDict[] = [];

  // Same reason readXmp guards its catalog read: a lenient load can produce a
  // document with no page tree at all.
  let pages: ReturnType<PDFDocument['getPages']>;
  try {
    pages = doc.getPages();
  } catch {
    return found;
  }

  for (const page of pages) {
    let annots: unknown;
    try {
      annots = page.node.lookup(PDFName.of('Annots'));
    } catch {
      continue;
    }
    if (!annots || typeof annots !== 'object' || !('asArray' in annots)) continue;
    for (const ref of (annots as { asArray(): unknown[] }).asArray()) {
      let annot: unknown;
      try {
        annot = doc.context.lookup(ref as Parameters<typeof doc.context.lookup>[0]);
      } catch {
        continue;
      }
      // The type says dictionary; a damaged file can put anything here, and
      // only the class check says what it really is. See catalogDict.
      if (annot instanceof PDFDict) found.push(annot);
    }
  }
  return found;
}

function annotationAuthors(doc: PDFDocument): Finding[] {
  const authors = new Map<string, number>();
  const annots = annotationDicts(doc);
  const annotations = annots.length;

  for (const annot of annots) {
    const title = annot.get(PDFName.of('T'));
    const name = title && 'decodeText' in title
      ? (title as { decodeText(): string }).decodeText()
      : undefined;
    if (name?.trim()) authors.set(name.trim(), (authors.get(name.trim()) ?? 0) + 1);
  }

  if (authors.size === 0) return [];
  const listed = [...authors]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => (n > 1 ? `${name} (${n})` : name));
  return [
    {
      kind: 'identity',
      confidence: 'confirmed',
      location: 'page annotations (/T)',
      label: 'Annotation authors',
      value: `${listed.join(', ')} — named on ${annotations} annotation${annotations > 1 ? 's' : ''} carried by the pages`,
    },
  ];
}

/*
 * What a clean takes off an annotation, and what it leaves.
 *
 * `/T` is the commenter's name, which every PDF reader fills in from the
 * account it runs under. `/M` and `/CreationDate` say when they wrote it —
 * enough, across a reviewed document, to reconstruct who worked on it and in
 * what order. All three go.
 *
 * `/Contents` stays. The comment's text is something someone chose to write
 * into the document, as much as a sentence on the page is, and deleting it
 * would change what the document says. A clean removes what the file says
 * about its authors, not what its authors said.
 */
const ANNOTATION_AUTHORSHIP = ['T', 'M', 'CreationDate'].map((key) => PDFName.of(key));

function scrubAnnotations(doc: PDFDocument): void {
  for (const annot of annotationDicts(doc)) {
    for (const key of ANNOTATION_AUTHORSHIP) annot.delete(key);
  }
}

export async function inspectPdf(data: Uint8Array): Promise<InspectResult> {
  const started = Date.now();
  const doc = await load(data);
  const parseMs = Date.now() - started;
  const findings: Finding[] = [];
  const notes: Note[] = [];

  findings.push(...priorRevisions(data));
  findings.push(...(await revisionLeaks(data, doc, parseMs)));
  findings.push(...annotationAuthors(doc));

  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (info && 'get' in info) {
    for (const field of INFO_FIELDS) {
      const raw = (info as { get(k: PDFName): unknown }).get(PDFName.of(field.key));
      if (!raw) continue;
      const value = String((raw as { decodeText?: () => string; asString?: () => string }).decodeText?.() ??
        (raw as { asString?: () => string }).asString?.() ??
        raw);
      if (value.trim()) {
        findings.push({
          kind: field.kind,
          confidence: field.confidence,
          location: `/Info /${field.key}`,
          label: field.label,
          value,
        });
      }
    }
  }

  const xmp = readXmp(doc);
  if (xmp) {
    for (const field of XMP_FIELDS) {
      const value = xmpValue(xmp, field.property);
      if (value) {
        findings.push({
          kind: field.kind,
          confidence: field.confidence,
          location: `/Metadata ${field.property}`,
          label: field.label,
          value,
        });
      }
    }
    findings.push(...findSourceTypes(xmp, '/Metadata'));
    if (looksLikeC2pa(xmp)) findings.push(...describeC2pa(xmp, '/Metadata'));
  }

  // The trailer /ID is a pair of hashes identifying this document and this
  // save. It survives every metadata wipe that does not rewrite the trailer.
  const id = doc.context.lookup(doc.context.trailerInfo.ID);
  if (id && 'asArray' in id) {
    const parts = (id as { asArray(): unknown[] }).asArray();
    const first = parts[0];
    if (first) {
      findings.push({
        kind: 'environment',
        confidence: 'probable',
        location: 'trailer /ID',
        label: 'Document identifier (/ID)',
        value: String((first as { asString?: () => string }).asString?.() ?? first),
      });
    }
  }

  // The eight fields above are the standard ones, but /Info is an open
  // dictionary: a generation pipeline can write anything into it, and those
  // custom keys are usually the most revealing entries in the whole file.
  if (info && 'keys' in info) {
    const known = new Set(INFO_FIELDS.map((f) => f.key));
    const dict = info as unknown as { keys(): PDFName[]; get(k: PDFName): unknown };
    for (const key of dict.keys()) {
      const name = key.asString().replace(/^\//, '');
      if (known.has(name)) continue;
      const raw = dict.get(key);
      if (!raw) continue;
      const value = String(
        (raw as { decodeText?: () => string }).decodeText?.() ??
          (raw as { asString?: () => string }).asString?.() ??
          raw,
      ).trim();
      if (!value) continue;
      findings.push({
        kind: 'provenance',
        confidence: 'confirmed',
        location: `/Info /${name}`,
        label: `Custom info key: ${name}`,
        value,
      });
    }
  }

  findings.push(...scanStreams(doc));
  findings.push(...scanPageFonts(doc));
  findings.push(...structuralPdf(doc, findings));

  const names = catalogDict(doc)?.get(PDFName.of('Names'));
  if (names) {
    const resolved = doc.context.lookup(names);
    if (resolved && 'get' in resolved && (resolved as { get(k: PDFName): unknown }).get(PDFName.of('EmbeddedFiles'))) {
      findings.push({
        kind: 'provenance',
        confidence: 'probable',
        location: '/Names /EmbeddedFiles',
        label: 'Embedded file attachments',
        value: 'present — may carry provenance manifests or source data',
      });
    }
  }

  notes.push({ code: 'scope:pdf-metadata-only' });

  // Derived last, so it can draw on every field the format modules surfaced.
  findings.push(...fingerprint(findings));

  return { format: 'pdf', findings: findings.sort(byConfidence), notes };
}

export interface RedactPdfOptions {
  /** Remove the XMP packet entirely rather than blanking known fields. Default true. */
  removeXmp?: boolean;
}

export async function redactPdf(data: Uint8Array, options: RedactPdfOptions = {}): Promise<RedactResult> {
  const { removeXmp = true } = options;

  const before = await inspectPdf(data);
  const doc = await load(data);
  const notes: Note[] = [];

  // Every key is removed, not just the eight standard ones: a generation
  // pipeline writes its own, and reporting those while leaving them in place
  // would be worse than not reporting them at all. The pdf-lib setters are
  // avoided because they write empty entries that still announce which fields
  // existed.
  const infoRef = doc.context.trailerInfo.Info;
  const info = doc.context.lookup(infoRef);
  if (info && 'delete' in info && 'keys' in info) {
    const dict = info as unknown as { delete(k: PDFName): void; keys(): PDFName[] };
    for (const key of [...dict.keys()]) dict.delete(key);
  }

  // Then drop the husk. An /Info dictionary present and empty is a shape no
  // producer writes, so leaving it would replace one mark with another —
  // "this file has been cleaned" is itself information about the file.
  // structuralPdf() reports exactly that when it sees it elsewhere; it would be
  // incoherent to keep emitting it ourselves.
  if (infoRef) {
    delete doc.context.trailerInfo.Info;
    if (infoRef instanceof PDFRef) doc.context.delete(infoRef);
  }

  if (removeXmp) {
    const hadXmp = Boolean(catalogDict(doc)?.get(PDFName.of('Metadata')));
    const xmp = readXmp(doc);
    catalogDict(doc)?.delete(PDFName.of('Metadata'));
    if (hadXmp && xmp && looksLikeC2pa(xmp)) {
      notes.push({ code: 'removed:c2pa', detail: '/Metadata' });
    }
  }

  scrubAnnotations(doc);

  notes.push(...before.notes);

  // Loading with `updateMetadata: false` is what keeps pdf-lib from stamping a
  // fresh ModDate and its own Producer string onto the document; save() itself
  // takes no such option.
  const out = await doc.save();
  return { format: 'pdf', data: out, removed: before.findings, notes };
}

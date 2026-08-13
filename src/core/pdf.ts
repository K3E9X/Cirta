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

import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import type { Finding, InspectResult, RedactResult, Note } from './types.js';
import { byConfidence } from './types.js';
import { fingerprint } from './fingerprint.js';
import { scanContent } from './archive.js';

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
function readXmp(doc: PDFDocument): string | undefined {
  const ref = doc.catalog.get(PDFName.of('Metadata'));
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

/** PDF text strings are UTF-16BE when they carry a byte-order mark, else 8-bit. */
function decodePdfText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be', { fatal: false }).decode(bytes.subarray(2));
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
    for (const finding of scanContent(text, `stream ${ref.toString()}`)) {
      const key = `${finding.label}:${finding.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding);
    }
  }
  return findings;
}

export async function inspectPdf(data: Uint8Array): Promise<InspectResult> {
  const doc = await load(data);
  const findings: Finding[] = [];
  const notes: Note[] = [];

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
    if (looksLikeC2pa(xmp)) {
      findings.push({
        kind: 'provenance',
        confidence: 'confirmed',
        location: '/Metadata',
        label: 'C2PA content credentials',
        value: 'signed provenance manifest',
        affectsVerifiability: true,
      });
    }
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

  const names = doc.catalog.get(PDFName.of('Names'));
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

  // The pdf-lib setters would write empty entries that still announce which
  // fields existed. Deleting the keys outright leaves no trace of them.
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (info && 'delete' in info) {
    const dict = info as { delete(k: PDFName): void };
    for (const field of INFO_FIELDS) dict.delete(PDFName.of(field.key));
  }

  if (removeXmp) {
    const hadXmp = Boolean(doc.catalog.get(PDFName.of('Metadata')));
    const xmp = readXmp(doc);
    doc.catalog.delete(PDFName.of('Metadata'));
    if (hadXmp && xmp && looksLikeC2pa(xmp)) {
      notes.push({ code: 'removed:c2pa', detail: '/Metadata' });
    }
  }

  notes.push(...before.notes);

  // Loading with `updateMetadata: false` is what keeps pdf-lib from stamping a
  // fresh ModDate and its own Producer string onto the document; save() itself
  // takes no such option.
  const out = await doc.save();
  return { format: 'pdf', data: out, removed: before.findings, notes };
}

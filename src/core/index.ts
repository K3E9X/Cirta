/**
 * Cirta — local inspection and redaction of document provenance metadata.
 *
 * Scope, stated plainly because most tools in this space are vague about it:
 *
 *   Handled      Metadata in PDF, OOXML (.pptx/.docx/.xlsx), OpenDocument
 *                (.odt/.ods/.odp), SVG, HTML and Markdown front matter;
 *                Exif/IPTC in embedded pictures; invisible Unicode in text.
 *   Not handled  Statistical watermarks embedded in an LLM's token choices.
 *                Those live in the wording, not in any removable field, and
 *                reading them requires the model vendor's secret key. No local
 *                tool can detect or remove one, and this package does not
 *                claim to.
 */

export * from './types.js';
export {
  scanText,
  cleanText,
  decodeTextInput,
  BinaryInputError,
} from './text.js';
export type { TextScan, CleanTextOptions, CleanTextResult } from './text.js';
export { inspectPdf, redactPdf } from './pdf.js';
export type { RedactPdfOptions } from './pdf.js';
export { xrayPdf } from './xray.js';
export type { XrayEngine, XrayRegion, XrayResult } from './xray.js';
export { hiddenInPptx, stripHiddenPptx } from './hidden-pptx.js';
export { hiddenInHtml, hiddenInDocx, stripHiddenHtml, stripHiddenDocx, aimedAtModel, AIMED_LABEL, type HiddenHow } from './hidden-text.js';
export { inspectOoxml, redactOoxml } from './ooxml.js';
export type { RedactOoxmlOptions } from './ooxml.js';
export { inspectOdf, redactOdf, isOdf } from './odf.js';
export { inspectMarkup, redactMarkup, detectMarkupFormat } from './markup.js';
export type { MarkupFormat } from './markup.js';
export { inspectImage, stripImageMetadata, detectImageKind } from './image.js';
export { fingerprint, provenance } from './fingerprint.js';
export type { Provenance } from './fingerprint.js';
export { readManifest, describeC2pa, readXmpClaimGenerator } from './c2pa.js';
export type { ManifestSummary } from './c2pa.js';
export { decodeCbor, asMap } from './cbor.js';
export { parseBoxes, findManifest, findByLabel, collectLabels, contentOf } from './jumbf.js';
export { exposure, estimateTokens } from './exposure.js';
export { stylometry } from './stylometry.js';
export type { Stylometry, StyleBand, StyleIndicator } from './stylometry.js';
export type { Exposure, ExposureBand, TokenEstimate } from './exposure.js';
export { walkArchive, scanContent, ARCHIVE_LIMITS } from './archive.js';
export { emailHeaders, stripToolHeaders } from './email.js';
export { findDeceptiveUrls, decodePunycode, skeleton } from './url.js';
export { toSarif, ruleId, meetsThreshold } from './sarif.js';
export type { SarifInput } from './sarif.js';
export { inspectPlainText, cleanPlainText, type PlainTextClean } from './plaintext.js';
export { parseRules, RulesError, type Rule } from './rules.js';
export { findResidue, stripMarkdownResidue, removeScaffolding } from './residue.js';
export { inspectClipboardHtml } from './clipboard.js';
export type { ArchiveMember } from './archive.js';
export { unzipGuarded, ZIP_LIMITS, ArchiveTooLargeError } from './zip.js';
export { manifest, manifestEntry, manifestOptions, sha256, MANIFEST_SCHEMA } from './manifest.js';
export { REPORT_SCHEMA } from './report-schema.js';
export type { Manifest, ManifestEntry, ManifestFinding, ManifestSide } from './manifest.js';

import { unzipGuarded, ArchiveTooLargeError, ZIP_EPOCH } from './zip.js';
import { zipSync } from 'fflate';
import type { Format, InspectOptions, InspectResult, RedactResult, Note, Finding } from './types.js';
import { inspectPdf, redactPdf, assertReadablePdf } from './pdf.js';
import { inspectEml, redactEml } from './mail.js';
import { looksLikeMail } from './mime.js';
import { inspectOoxml, redactOoxml } from './ooxml.js';
import { inspectOdf, redactOdf, isOdf } from './odf.js';
import { inspectMarkup, redactMarkupCounted, detectMarkupFormat } from './markup.js';
import { stripRemoteResources } from './beacons.js';
import { stripTracking } from './tracking.js';
import { bodyText } from './body-text.js';
import { piiFindings } from './pii.js';
import { ruleFindings } from './rules.js';
import { decodeTextInput, cleanText, BinaryInputError } from './text.js';
import { stripToolHeaders } from './email.js';
import { inspectPlainText } from './plaintext.js';
import { fingerprint } from './fingerprint.js';
import { inspectImage, stripImageMetadata, detectImageKind } from './image.js';
import { walkArchive, inspectPlainMember, pathFindings, ARCHIVE_LIMITS, ARCHIVE_SEPARATOR } from './archive.js';
import { fileNameFindings } from './filenames.js';
import { byConfidence } from './types.js';
import { isCfb, readCfb } from './cfb.js';
import { compoundKind, inspectLegacyOffice } from './legacy-office.js';
import { inspectMsg } from './msg.js';
import { inspectNotebook, parseNotebook, redactNotebook } from './notebook.js';
import { reencodeImage } from './reencode.js';
import { PICTURE_LOCATION, REWRITABLE_PICTURES } from './picture-formats.js';
import { isRtf, inspectRtf, redactRtf } from './rtf.js';
import { isEpub, inspectEpub, redactEpub } from './epub.js';
import { looksLikeLatex, inspectLatex, redactLatex } from './latex.js';
import { calendarFormat, inspectCalendar, redactCalendar } from './calendar.js';
import { detectMovieKind, inspectMovie, stripMovie } from './media-mp4.js';
import { isMp3, inspectMp3, stripMp3 } from './media-audio.js';

import { UnsupportedFormatError } from './errors.js';
export { UnsupportedFormatError, type ErrorCode } from './errors.js';

const UNSUPPORTED =
  'Unrecognised file. Supported: PDF, Office Open XML (.pptx, .docx, .xlsx, .vsdx), ' +
  'OpenDocument (.odt, .ods, .odp), legacy Office (.doc, .xls, .ppt) and Outlook (.msg), inspection only, ' +
  'Jupyter notebooks, RTF, EPUB, LaTeX, iCalendar, vCard, SVG, HTML, Markdown, JPEG, PNG, WebP and GIF, and TIFF, HEIC and AVIF, inspection only; MP4, QuickTime, M4A and MP3.';

/** [F-2.2] A compound file this library can name, or undefined. */
function compound(data: Uint8Array) {
  if (!isCfb(data)) return undefined;
  const cfb = readCfb(data);
  const kind = cfb && compoundKind(cfb);
  return cfb && kind ? { cfb, kind } : undefined;
}

function startsWith(data: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => data[i] === byte);
}

const isPdf = (data: Uint8Array) => startsWith(data, [0x25, 0x50, 0x44, 0x46]); // %PDF
const isZip = (data: Uint8Array) => startsWith(data, [0x50, 0x4b, 0x03, 0x04]);

/** A saved mail: named .eml, or opening with an RFC 5322 header block. */
const isMail = (data: Uint8Array, hint?: string) =>
  hint === 'eml' || /\.eml$/i.test(hint ?? '') || looksLikeMail(data);

/** True for a ZIP that is a document package rather than a plain archive. */
function isDocumentPackage(parts: Record<string, Uint8Array>): boolean {
  return (
    isOdf(parts) ||
    isEpub(parts) ||
    Boolean(parts['word/document.xml'] ?? parts['ppt/presentation.xml'] ?? parts['xl/workbook.xml'] ?? parts['visio/document.xml'])
  );
}

/**
 * Report on every member of a plain archive.
 *
 * Each member is dispatched through the ordinary detection path, so a PPTX
 * inside a ZIP gets the same treatment it would get on its own. Members no
 * parser claims are scanned for credentials and provider identifiers.
 */
async function inspectArchive(data: Uint8Array, options: InspectOptions): Promise<InspectResult> {
  const members = walkArchive(data);
  const findings: Finding[] = [];
  const notes: Note[] = [{ code: 'scope:archive' }];

  const seen = new Set<string>();
  for (const member of members) {
    // [F-P2 2.1] The member's name: a direction control, a double extension, a path out of the folder.
    findings.push(...fileNameFindings(member.path.split(ARCHIVE_SEPARATOR).pop() ?? member.path, member.path));
    // A nested archive's members are already in the list, under its path.
    if (member.expanded) continue;
    try {
      // The engine goes in, the pictures do not: a page number alone would not
      // say which member of the archive they came from.
      const inner = await inspectFile(member.data, member.path, { xray: options.xray });
      for (const finding of inner.findings) {
        const located = { ...finding, location: `${member.path}${ARCHIVE_SEPARATOR}${finding.location}` };
        const key = `${located.label}\u0000${located.location}\u0000${located.value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(located);
      }
    } catch {
      // No parser claims it; fall back to the content scan.
      findings.push(...inspectPlainMember(member));
    }
  }

  findings.push(...pathFindings(members.map((m) => m.path)));
  if (members.length >= ARCHIVE_LIMITS.maxMembers) {
    notes.push({ code: 'limit:archive-truncated', detail: `${ARCHIVE_LIMITS.maxMembers} members` });
  }

  return { format: 'zip', findings: findings.sort(byConfidence), notes };
}

/**
 * `hint` is a file name, an extension or a format name. `'text'` additionally
 * means "decode these bytes as text whatever the guard thinks", which is how
 * the CLI's `--force-text` reaches this far down.
 */
const decodeOptions = (hint?: string) => ({ allowBinary: hint === 'text' });

/**
 * Identify a document from its content rather than its file extension.
 *
 * `hint` is only consulted for text formats where the bytes alone are
 * ambiguous — a Markdown file without front matter looks like plain text.
 */
export function detectFormat(data: Uint8Array, hint?: string): Format | undefined {
  if (isPdf(data)) return 'pdf';
  if (isZip(data)) {
    try {
      const parts = unzipGuarded(data);
      if (isOdf(parts)) return 'odt'; // refined by inspectOdf
      if (isEpub(parts)) return 'epub';
      if (parts['word/document.xml']) return 'docx';
      if (parts['ppt/presentation.xml']) return 'pptx';
      if (parts['xl/workbook.xml']) return 'xlsx';
      if (parts['visio/document.xml']) return 'vsdx';
      return 'zip';
    } catch {
      return undefined;
    }
  }
  const legacy = compound(data);
  if (legacy) return legacy.kind;
  if (isCfb(data)) return undefined;
  const image = detectImageKind(data);
  if (image) return image;
  // [F-P3 2.2] After the pictures: HEIC and AVIF open with the same ftyp box.
  const movie = detectMovieKind(data);
  if (movie) return movie;
  if (isMp3(data)) return 'mp3';
  if (isRtf(data)) return 'rtf';
  if (isMail(data, hint)) return 'eml';
  try {
    const text = decodeTextInput(data, decodeOptions(hint));
    // [F-2.2] A notebook is JSON with a shape; a .ipynb that does not parse is text.
    if (parseNotebook(text)) return 'ipynb';
    // [F-P2 2.2] Content lines, then LaTeX, before the markup sniff: a % comment is not Markdown.
    const calendar = calendarFormat(text);
    if (calendar) return calendar;
    if (looksLikeLatex(text, hint)) return 'latex';
    // Anything that decodes as text but is no known markup is still a file
    // whose invisible characters travel: a .txt, a source file, a CSV. It gets
    // the character-level pass rather than a refusal.
    return detectMarkupFormat(text, hint) ?? 'text';
  } catch {
    return undefined;
  }
}

/** Image metadata, plus whatever the fingerprinter derives from it. */
const imageLocation = (image: Format) => (image === 'jpeg' ? 'JPEG segments' : image === 'png' ? 'PNG chunks' : PICTURE_LOCATION[image as keyof typeof PICTURE_LOCATION]);

function imageFindings(data: Uint8Array, image: Format): Finding[] {
  const found = inspectImage(data, imageLocation(image));
  return [...found, ...fingerprint(found)].sort(byConfidence);
}

/**
 * Inspect a file, turning a parser's complaint into a refusal callers can match.
 *
 * Fuzzing made the case for this. Twenty-one distinct rejections escaped the
 * public entry point as a bare `Error` — "invalid zip data", "No PDF header
 * found" — all of them correct refusals of corrupt input, none of them a type a
 * caller could catch on. A consumer had no way to tell "this file is not
 * supported" from "this library broke".
 *
 * A corrupt file is an unsupported file, so those become UnsupportedFormatError
 * with the parser's own words kept. A TypeError or RangeError is *not* wrapped:
 * that is this code indexing or slicing something it did not check, and
 * disguising it as a refusal would hide exactly the bug the fuzzer exists to
 * find.
 */
export async function inspectFile(data: Uint8Array, hint?: string, options: InspectOptions = {}): Promise<InspectResult> {
  const result = await asRefusal(() => dispatch(data, hint, options));
  if (!options.pii && !options.rules?.length) return result;
  return { ...result, findings: [...result.findings, ...(await dlp(data, result, options))].sort(byConfidence) };
}

/**
 * [F-2.3] Personal data and an organisation's words, in the document's text
 * and — for the rules — in the fields already reported, each at its own
 * location. Reported once per value.
 */
async function dlp(data: Uint8Array, result: InspectResult, options: InspectOptions): Promise<Finding[]> {
  const text = await bodyText(data, result.format);
  const found: Finding[] = [];
  if (options.pii) found.push(...piiFindings(text, 'document body'));
  if (options.rules?.length) {
    for (const finding of result.findings) found.push(...ruleFindings(finding.value, options.rules, finding.location));
    found.push(...ruleFindings(text, options.rules, 'document body'));
  }
  const seen = new Set<string>();
  return found.filter((f) => {
    const key = `${f.label}\u0000${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function asRefusal<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof UnsupportedFormatError ||
      error instanceof BinaryInputError ||
      error instanceof ArchiveTooLargeError ||
      error instanceof TypeError ||
      error instanceof RangeError ||
      error instanceof ReferenceError
    ) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new UnsupportedFormatError(`This file could not be parsed: ${detail}`, 'unparseable', detail);
  }
}

/**
 * [F-2.1] How a container inspects a file it carries — a PDF's attachment,
 * an Office document's embedded object — bounded in depth, so a file nested
 * in itself a hundred times is read three levels down and no further.
 */
const MAX_NESTING = 3;
const depths = new WeakMap<InspectOptions, number>();

function member(options: InspectOptions): InspectOptions['inspectMember'] {
  const depth = depths.get(options) ?? 0;
  if (depth >= MAX_NESTING) return undefined;
  return (bytes, name) => {
    const inner: InspectOptions = { xray: options.xray };
    depths.set(inner, depth + 1);
    return inspectFile(bytes, name, inner);
  };
}

/**
 * [C10.6] Nothing to look at is not the same as nothing found: an empty
 * ".pdf" reported as text with "no metadata" said something untrue about it.
 */
function refuseEmpty(data: Uint8Array): void {
  if (data.length === 0) throw new UnsupportedFormatError('Empty file.', 'empty-file');
}

async function dispatch(data: Uint8Array, hint: string | undefined, options: InspectOptions): Promise<InspectResult> {
  refuseEmpty(data);
  if (isPdf(data)) return inspectPdf(data, { ...options, inspectMember: member(options) });
  if (isZip(data)) {
    const parts = unzipGuarded(data);
    if (!isDocumentPackage(parts)) return inspectArchive(data, options);
    if (isEpub(parts)) return inspectEpub(data, options);
    return isOdf(parts) ? inspectOdf(data) : inspectOoxml(data);
  }
  if (isCfb(data)) {
    const legacy = compound(data);
    if (!legacy) throw new UnsupportedFormatError(UNSUPPORTED);
    const inner = { ...options, inspectMember: member(options) };
    return legacy.kind === 'msg' ? inspectMsg(legacy.cfb, inner) : inspectLegacyOffice(legacy.cfb, legacy.kind, inner);
  }

  const image = detectImageKind(data);
  if (image) {
    return {
      format: image,
      // fingerprint() runs here as it does for every other format. Without it
      // a picture whose chunk named Stable Diffusion still had the report open
      // with "nothing names a tool" — the headline contradicting the table
      // directly under it.
      findings: imageFindings(data, image),
      notes: [{ code: 'scope:image-metadata-only' }],
    };
  }

  // [F-P3 2.2] Video and audio.
  const movie = detectMovieKind(data);
  if (movie) {
    const found = inspectMovie(data);
    return { format: movie, findings: [...found, ...fingerprint(found)].sort(byConfidence), notes: [{ code: 'scope:media' }] };
  }
  if (isMp3(data)) {
    const found = inspectMp3(data);
    return { format: 'mp3', findings: [...found, ...fingerprint(found)].sort(byConfidence), notes: [{ code: 'scope:media' }] };
  }

  if (isRtf(data)) return inspectRtf(data, { ...options, inspectMember: member(options) });

  // [C4] Before the markup sniff: a mail whose body is HTML is a mail first.
  if (isMail(data, hint)) return inspectEml(data, (bytes, name) => inspectFile(bytes, name, { xray: options.xray }));

  const format = detectFormat(data, hint);
  if (format === 'ipynb') return inspectNotebook(parseNotebook(decodeTextInput(data, decodeOptions(hint)))!);
  if (format === 'latex') return inspectLatex(decodeTextInput(data, decodeOptions(hint)));
  if (format === 'ics' || format === 'vcf') return inspectCalendar(decodeTextInput(data, decodeOptions(hint)), format);
  if (format === 'svg' || format === 'html' || format === 'markdown') {
    return {
      format,
      findings: inspectMarkup(decodeTextInput(data, decodeOptions(hint)), format),
      notes: [{ code: 'scope:markup-metadata-only' }],
    };
  }
  if (format === 'text') {
    return {
      format,
      findings: inspectPlainText(decodeTextInput(data, decodeOptions(hint))),
      notes: [{ code: 'scope:invisible-characters-only' }],
    };
  }
  throw new UnsupportedFormatError(UNSUPPORTED);
}

/**
 * Re-inspect the redacted output and report whatever survived.
 *
 * Detection and removal can drift apart — a field gets recognised before it
 * gets cleared — and the failure mode is the worst one available here: a report
 * that lists something and then hands back a file still carrying it. Checking
 * the actual output rather than trusting the removal code means the claim is
 * always measured, and things that genuinely cannot be removed (a secret in the
 * page text, which only the author can rewrite) are named instead of implied.
 */
/** What a finding is about, independent of the value it reported. */
const findingKey = (finding: Finding): string => `${finding.label}\u0000${finding.location}`;

async function noteSurvivors(result: RedactResult, hint?: string, options: InspectOptions = {}): Promise<RedactResult> {
  if (!result.data) return result;
  let survivors: Finding[];
  try {
    // Rendered again, not assumed: hidden text is page content, which cleaning
    // leaves alone, and the cleaned copy is checked for it like everything else.
    survivors = (await inspectFile(result.data, hint, { xray: options.xray, pii: options.pii, rules: options.rules })).findings;
  } catch (error) {
    // [C1] A copy this library cannot read back is not handed over. Returning
    // it unchecked is how an unreadable PDF went out with "9 fields removed".
    throw new UnsupportedFormatError(
      'The cleaned copy did not parse again, so it was not delivered.',
      'output-unreadable',
      error instanceof Error ? error.message : String(error),
    );
  }

  /*
   * `removed` means gone from the output, checked — not merely found in the
   * input. The redactors returned everything inspection had found, so a file
   * whose comment authors were never touched came back reporting them removed:
   * "7 fields removed" above a table that listed the commenter's name, above a
   * note saying that name was still there. The re-inspection below already ran
   * for the note; it now decides the list as well.
   *
   * Identity is label and location, not value. A field still present with any
   * value has not been removed, and a cleaner that under-claims is the safe
   * failure for a tool people trust with what they send.
   */
  const still = new Set(survivors.map(findingKey));
  const removed = result.removed.filter((finding) => !still.has(findingKey(finding)));

  // Informational findings are the ones deliberately kept — typographic spaces,
  // software names in a field that is meant to name software. Listing them as
  // "not removed" would bury the survivors that actually matter.
  const notable = survivors.filter((f) => f.confidence !== 'informational');
  if (notable.length === 0) return { ...result, removed, kept: [] };

  const labels = [...new Set(notable.map((f) => f.label))];
  return {
    ...result,
    removed,
    kept: notable,
    notes: [...result.notes, { code: 'kept:in-content', detail: labels.join(', ') }],
  };
}

/** Refusals that mean "this member cannot be cleaned", as opposed to a bug. */
const MEMBER_REFUSALS = new Set(['image-not-rewritable', 'epub-encrypted', 'unsupported', 'unparseable', 'legacy-not-rewritable', 'encrypted-pdf', 'output-unreadable', 'renderer-unavailable', 'burn-unavailable', 'archive-not-rewritable']);

/**
 * [F-P2 2.4] A plain archive, cleaned member by member with the same options,
 * an archive inside it in turn, then repacked in its order, every member
 * dated 1980-01-01. One member that cannot be cleaned — a program, a legacy
 * Office file, an encrypted PDF — and the archive is refused, naming each:
 * a copy that left one of them as it was would not be a cleaned archive.
 */
async function redactArchive(data: Uint8Array, options: InspectOptions, depth: number): Promise<RedactResult> {
  const parts = unzipGuarded(data);
  const out: Record<string, Uint8Array> = {};
  const removed: Finding[] = [];
  const notes: Note[] = [{ code: 'scope:archive' }];
  const unsupported: string[] = [];
  const seenNotes = new Set<string>();

  for (const [name, bytes] of Object.entries(parts)) {
    if (name.endsWith('/') || bytes.length === 0) {
      out[name] = bytes;
      continue;
    }
    try {
      const nested = isZip(bytes) && !isDocumentPackage(unzipGuarded(bytes));
      if (nested && depth + 1 > ARCHIVE_LIMITS.maxDepth) {
        unsupported.push(name);
        continue;
      }
      const cleaned = nested ? await redactArchive(bytes, options, depth + 1) : await redactFile(bytes, name, options);
      out[name] = cleaned.data ?? bytes;
      removed.push(...cleaned.removed.map((f) => ({ ...f, location: `${name}${ARCHIVE_SEPARATOR}${f.location}` })));
      for (const note of cleaned.notes) {
        if (note.code.startsWith('scope:') || note.code === 'kept:in-content') continue;
        const key = `${note.code}\u0000${note.detail ?? ''}`;
        if (!seenNotes.has(key)) notes.push(note);
        seenNotes.add(key);
      }
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (error instanceof BinaryInputError || (typeof code === 'string' && MEMBER_REFUSALS.has(code))) {
        // A nested archive names its own members.
        const detail = code === 'archive-not-rewritable' ? (error as UnsupportedFormatError).detail : undefined;
        unsupported.push(...(detail ? detail.split(', ').map((inner) => `${name}${ARCHIVE_SEPARATOR}${inner}`) : [name]));
        continue;
      }
      throw error;
    }
  }

  if (unsupported.length) {
    const shown = unsupported.slice(0, 20).join(', ') + (unsupported.length > 20 ? `, +${unsupported.length - 20}` : '');
    throw new UnsupportedFormatError(
      `This archive holds files Cirta cannot clean: ${shown}. It is not rewritten.`,
      'archive-not-rewritable',
      shown,
    );
  }
  return { format: 'zip', data: zipSync(out, { level: 6, mtime: ZIP_EPOCH }), removed, notes };
}

/**
 * Clean a file. [C11.1] A parser's complaint becomes a coded refusal here
 * too, as it does for inspection: a truncated PDF reached the reader as
 * "Failed to parse PDF document", in English, with no code to translate.
 */
export async function redactFile(data: Uint8Array, hint?: string, options: InspectOptions = {}): Promise<RedactResult> {
  return asRefusal(() => redact(data, hint, options));
}

async function redact(data: Uint8Array, hint?: string, options: InspectOptions = {}): Promise<RedactResult> {
  refuseEmpty(data);
  if (isPdf(data)) {
    const result = await redactPdf(data, {
      stripActive: options.stripActive,
      removeAttachments: options.removeAttachments,
      flattenAnnotations: options.flattenAnnotations,
      stripTracking: options.stripTracking,
      burnRedactions: options.burnRedactions,
      xray: options.xray,
    });
    await assertReadablePdf(result.data!);
    return noteSurvivors(result, hint, options);
  }
  if (isZip(data)) {
    const parts = unzipGuarded(data);
    if (!isDocumentPackage(parts)) return noteSurvivors(await redactArchive(data, options, 0), hint, options);
    if (isEpub(parts)) return noteSurvivors(await redactEpub(data, { removeHidden: options.removeHidden, stripTracking: options.stripTracking }), hint, options);
    return noteSurvivors(isOdf(parts) ? redactOdf(data) : redactOoxml(data, { removeHidden: options.removeHidden, acceptChanges: options.acceptChanges, removeComments: options.removeComments, stripActive: options.stripActive, removeNotes: options.removeNotes, removeHiddenSlides: options.removeHiddenSlides, removeHiddenSheets: options.removeHiddenSheets, stripTracking: options.stripTracking }), hint, options);
  }

  // [F-2.2] Inspected, never rewritten: see legacy-office.ts for why.
  const legacy = compound(data);
  if (legacy) {
    throw new UnsupportedFormatError(
      'Legacy Office files and Outlook messages are inspected but not rewritten. Save it in a current format and clean that copy.',
      'legacy-not-rewritable',
      legacy.kind,
    );
  }

  const image = detectImageKind(data);
  if (image) {
    // [F-P2 2.2] Inspected only: refused rather than handed back with its metadata.
    if (!REWRITABLE_PICTURES.has(image)) {
      throw new UnsupportedFormatError(
        `A ${image.toUpperCase()} picture is inspected but not rewritten: its metadata cannot be taken out without rewriting its structure. Export it as JPEG or PNG and clean that copy.`,
        'image-not-rewritable',
        image,
      );
    }
    const before = inspectImage(data, imageLocation(image));
    const notes: Note[] = [{ code: 'scope:image-metadata-only' }];
    if (before.some((f) => f.affectsVerifiability)) notes.push({ code: 'removed:c2pa' });
    let cleaned: Uint8Array = stripImageMetadata(data) ?? data;
    // [F-P2 2.4] Rebuilt from the pixels, on request; refused rather than skipped without a codec.
    if (options.reencodeImages) {
      if (!options.imageCodec) throw new UnsupportedFormatError('Re-encoding pictures needs an image codec, which is not available here.', 'reencode-unavailable');
      if (image !== 'jpeg' && image !== 'png') throw new UnsupportedFormatError('Re-encoding is offered for JPEG and PNG pictures.', 'reencode-unavailable', image);
      cleaned = await reencodeImage(data, image, options.imageCodec);
      notes.push({ code: 'reencoded:image' });
    }
    return noteSurvivors(
      { format: image, data: cleaned, removed: before, notes },
      hint,
      options,
    );
  }

  // [F-P3 2.2] Cleaned in place: the metadata boxes become free space, the media does not move.
  const movie = detectMovieKind(data);
  if (movie) return noteSurvivors({ format: movie, data: stripMovie(data), removed: inspectMovie(data), notes: [{ code: 'scope:media' }] }, hint, options);
  if (isMp3(data)) return noteSurvivors({ format: 'mp3', data: stripMp3(data), removed: inspectMp3(data), notes: [{ code: 'scope:media' }] }, hint, options);

  if (isRtf(data)) return noteSurvivors(await redactRtf(data, { stripActive: options.stripActive }), hint, options);

  if (isMail(data, hint)) {
    return noteSurvivors(await redactEml(data, (bytes, name) => inspectFile(bytes, name, { xray: options.xray })), hint, options);
  }

  const format = detectFormat(data, hint);
  if (format === 'ics' || format === 'vcf') return noteSurvivors(redactCalendar(decodeTextInput(data, decodeOptions(hint)), format), hint, options);
  if (format === 'latex') return noteSurvivors(redactLatex(decodeTextInput(data, decodeOptions(hint))), hint, options);
  if (format === 'ipynb') {
    const notebook = parseNotebook(decodeTextInput(data, decodeOptions(hint)))!;
    return noteSurvivors(redactNotebook(notebook, { clearOutputs: options.clearOutputs }), hint, options);
  }
  if (format === 'svg' || format === 'html' || format === 'markdown') {
    const text = decodeTextInput(data, decodeOptions(hint));
    const counted = redactMarkupCounted(text, format, { removeHidden: options.removeHidden });
    const notes: Note[] = [{ code: 'scope:markup-metadata-only' }];
    if (counted.hiddenRemoved) notes.push({ code: 'removed:hidden-text', detail: String(counted.hiddenRemoved) });
    // [F-2.1] Remote pictures, styles, scripts and frames, on request.
    const remote = options.stripRemote && format !== 'svg' ? stripRemoteResources(counted.text, format === 'markdown') : { text: counted.text, removed: 0 };
    if (remote.removed) notes.push({ code: 'removed:remote-resources', detail: String(remote.removed) });
    // [F-2.4] Tracking parameters out of every link, on request.
    const tracking = options.stripTracking ? stripTracking(remote.text) : { text: remote.text, removed: 0 };
    if (tracking.removed) notes.push({ code: 'removed:tracking-params', detail: String(tracking.removed) });
    const cleaned = tracking.text;
    return noteSurvivors(
      {
        format,
        data: new TextEncoder().encode(cleaned),
        text: cleaned,
        removed: inspectMarkup(text, format),
        notes,
      },
      hint,
      options,
    );
  }
  if (format === 'text') {
    const text = decodeTextInput(data, decodeOptions(hint));
    // Typographic spaces are preserved, as they are in every document body:
    // a file on disk is authored content, not a paste being tidied up, and
    // flattening the no-break space in "Objet : le rapport" is a regression.
    const result = cleanText(text, { normalizeSpaces: false, normalize: 'when-flagged' });
    // Mail headers that name a tool go too. They are metadata by every
    // definition this tool uses, and on a generated draft they are the single
    // most explicit mark in the file — X-Mailer naming the desktop client that
    // composed it. The message's own headers stay: From, Subject and
    // Message-ID are content, and noteSurvivors() will say so.
    const stripped = stripToolHeaders(result.text);
    const notes: Note[] = [{ code: 'scope:invisible-characters-only' }];
    if (result.kept.length) {
      notes.push({ code: 'kept:content', detail: result.kept.map((f) => f.label).join(', ') });
    }
    // [C8] What changed in the words, and what was deliberately left.
    if (result.recomposed) notes.push({ code: 'changed:nfc', detail: String(result.recomposed) });
    if (result.spacesKept) notes.push({ code: 'kept:typographic-spaces', detail: String(result.spacesKept) });
    return noteSurvivors(
      {
        format,
        data: new TextEncoder().encode(stripped.text),
        text: stripped.text,
        removed: result.removed,
        notes,
      },
      hint,
      options,
    );
  }
  throw new UnsupportedFormatError(UNSUPPORTED);
}

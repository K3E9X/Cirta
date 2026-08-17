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
export { inspectPlainText } from './plaintext.js';
export type { ArchiveMember } from './archive.js';
export { unzipGuarded, ZIP_LIMITS, ArchiveTooLargeError } from './zip.js';

import { unzipGuarded } from './zip.js';
import type { Format, InspectResult, RedactResult, Note, Finding } from './types.js';
import { inspectPdf, redactPdf } from './pdf.js';
import { inspectOoxml, redactOoxml } from './ooxml.js';
import { inspectOdf, redactOdf, isOdf } from './odf.js';
import { inspectMarkup, redactMarkup, detectMarkupFormat } from './markup.js';
import { decodeTextInput, cleanText } from './text.js';
import { stripToolHeaders } from './email.js';
import { inspectPlainText } from './plaintext.js';
import { inspectImage, stripImageMetadata, detectImageKind } from './image.js';
import { walkArchive, inspectPlainMember, pathFindings, ARCHIVE_LIMITS } from './archive.js';
import { byConfidence } from './types.js';

export class UnsupportedFormatError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'UnsupportedFormatError';
  }
}

const UNSUPPORTED =
  'Unrecognised file. Supported: PDF, Office Open XML (.pptx, .docx, .xlsx), ' +
  'OpenDocument (.odt, .ods, .odp), SVG, HTML, Markdown, JPEG and PNG.';

function startsWith(data: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => data[i] === byte);
}

const isPdf = (data: Uint8Array) => startsWith(data, [0x25, 0x50, 0x44, 0x46]); // %PDF
const isZip = (data: Uint8Array) => startsWith(data, [0x50, 0x4b, 0x03, 0x04]);

/** True for a ZIP that is a document package rather than a plain archive. */
function isDocumentPackage(parts: Record<string, Uint8Array>): boolean {
  return (
    isOdf(parts) ||
    Boolean(parts['word/document.xml'] ?? parts['ppt/presentation.xml'] ?? parts['xl/workbook.xml'])
  );
}

/**
 * Report on every member of a plain archive.
 *
 * Each member is dispatched through the ordinary detection path, so a PPTX
 * inside a ZIP gets the same treatment it would get on its own. Members no
 * parser claims are scanned for credentials and provider identifiers.
 */
async function inspectArchive(data: Uint8Array): Promise<InspectResult> {
  const members = walkArchive(data);
  const findings: Finding[] = [];
  const notes: Note[] = [{ code: 'scope:archive' }];

  for (const member of members) {
    try {
      const inner = await inspectFile(member.data, member.path);
      for (const finding of inner.findings) {
        findings.push({ ...finding, location: `${member.path} → ${finding.location}` });
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
      if (parts['word/document.xml']) return 'docx';
      if (parts['ppt/presentation.xml']) return 'pptx';
      if (parts['xl/workbook.xml']) return 'xlsx';
      return 'zip';
    } catch {
      return undefined;
    }
  }
  const image = detectImageKind(data);
  if (image) return image;
  try {
    const text = decodeTextInput(data, decodeOptions(hint));
    // Anything that decodes as text but is no known markup is still a file
    // whose invisible characters travel: a .txt, a source file, a CSV. It gets
    // the character-level pass rather than a refusal.
    return detectMarkupFormat(text, hint) ?? 'text';
  } catch {
    return undefined;
  }
}

export async function inspectFile(data: Uint8Array, hint?: string): Promise<InspectResult> {
  if (isPdf(data)) return inspectPdf(data);
  if (isZip(data)) {
    const parts = unzipGuarded(data);
    if (!isDocumentPackage(parts)) return inspectArchive(data);
    return isOdf(parts) ? inspectOdf(data) : inspectOoxml(data);
  }

  const image = detectImageKind(data);
  if (image) {
    return {
      format: image,
      findings: inspectImage(data, image === 'jpeg' ? 'JPEG segments' : 'PNG chunks'),
      notes: [{ code: 'scope:image-metadata-only' }],
    };
  }

  const format = detectFormat(data, hint);
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
async function noteSurvivors(result: RedactResult, hint?: string): Promise<RedactResult> {
  if (!result.data || result.removed.length === 0) return result;
  let survivors: Finding[];
  try {
    survivors = (await inspectFile(result.data, hint)).findings;
  } catch {
    return result;
  }
  // Informational findings are the ones deliberately kept — typographic spaces,
  // software names in a field that is meant to name software. Listing them as
  // "not removed" would bury the survivors that actually matter.
  const notable = survivors.filter((f) => f.confidence !== 'informational');
  if (notable.length === 0) return result;

  const labels = [...new Set(notable.map((f) => f.label))];
  return {
    ...result,
    notes: [...result.notes, { code: 'kept:in-content', detail: labels.join(', ') }],
  };
}

export async function redactFile(data: Uint8Array, hint?: string): Promise<RedactResult> {
  if (isPdf(data)) return noteSurvivors(await redactPdf(data), hint);
  if (isZip(data)) {
    const parts = unzipGuarded(data);
    if (!isDocumentPackage(parts)) {
      throw new UnsupportedFormatError(
        'Plain archives are inspected but not rewritten. Extract it, redact the files individually, and repack.',
      );
    }
    return noteSurvivors(isOdf(parts) ? redactOdf(data) : redactOoxml(data), hint);
  }

  const image = detectImageKind(data);
  if (image) {
    const before = inspectImage(data, image === 'jpeg' ? 'JPEG segments' : 'PNG chunks');
    const notes: Note[] = [{ code: 'scope:image-metadata-only' }];
    if (before.some((f) => f.affectsVerifiability)) notes.push({ code: 'removed:c2pa' });
    return noteSurvivors(
      { format: image, data: stripImageMetadata(data) ?? data, removed: before, notes },
      hint,
    );
  }

  const format = detectFormat(data, hint);
  if (format === 'svg' || format === 'html' || format === 'markdown') {
    const text = decodeTextInput(data, decodeOptions(hint));
    const cleaned = redactMarkup(text, format);
    return noteSurvivors(
      {
        format,
        data: new TextEncoder().encode(cleaned),
        text: cleaned,
        removed: inspectMarkup(text, format),
        notes: [{ code: 'scope:markup-metadata-only' }],
      },
      hint,
    );
  }
  if (format === 'text') {
    const text = decodeTextInput(data, decodeOptions(hint));
    // Typographic spaces are preserved, as they are in every document body:
    // a file on disk is authored content, not a paste being tidied up, and
    // flattening the no-break space in "Objet : le rapport" is a regression.
    const result = cleanText(text, { normalizeSpaces: false });
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
    return noteSurvivors(
      {
        format,
        data: new TextEncoder().encode(stripped.text),
        text: stripped.text,
        removed: result.removed,
        notes,
      },
      hint,
    );
  }
  throw new UnsupportedFormatError(UNSUPPORTED);
}

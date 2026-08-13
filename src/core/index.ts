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
  summarizeText,
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
export { inspectImage, stripImageMetadata, detectImageKind, hasC2pa } from './image.js';
export { fingerprint } from './fingerprint.js';
export { exposure, estimateTokens, EXPOSURE_THRESHOLDS } from './exposure.js';
export type { Exposure, ExposureBand, TokenEstimate } from './exposure.js';
export { walkArchive, scanContent, ARCHIVE_LIMITS } from './archive.js';
export type { ArchiveMember } from './archive.js';

import { unzipSync } from 'fflate';
import type { Format, InspectResult, RedactResult, Note, Finding } from './types.js';
import { inspectPdf, redactPdf } from './pdf.js';
import { inspectOoxml, redactOoxml } from './ooxml.js';
import { inspectOdf, redactOdf, isOdf } from './odf.js';
import { inspectMarkup, redactMarkup, detectMarkupFormat } from './markup.js';
import { decodeTextInput } from './text.js';
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
 * Identify a document from its content rather than its file extension.
 *
 * `hint` is only consulted for text formats where the bytes alone are
 * ambiguous — a Markdown file without front matter looks like plain text.
 */
export function detectFormat(data: Uint8Array, hint?: string): Format | undefined {
  if (isPdf(data)) return 'pdf';
  if (isZip(data)) {
    try {
      const parts = unzipSync(data);
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
    return detectMarkupFormat(decodeTextInput(data), hint);
  } catch {
    return undefined;
  }
}

export async function inspectFile(data: Uint8Array, hint?: string): Promise<InspectResult> {
  if (isPdf(data)) return inspectPdf(data);
  if (isZip(data)) {
    const parts = unzipSync(data);
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
      findings: inspectMarkup(decodeTextInput(data), format),
      notes: [{ code: 'scope:markup-metadata-only' }],
    };
  }
  throw new UnsupportedFormatError(UNSUPPORTED);
}

export async function redactFile(data: Uint8Array, hint?: string): Promise<RedactResult> {
  if (isPdf(data)) return redactPdf(data);
  if (isZip(data)) {
    const parts = unzipSync(data);
    if (!isDocumentPackage(parts)) {
      throw new UnsupportedFormatError(
        'Plain archives are inspected but not rewritten. Extract it, redact the files individually, and repack.',
      );
    }
    return isOdf(parts) ? redactOdf(data) : redactOoxml(data);
  }

  const image = detectImageKind(data);
  if (image) {
    const before = inspectImage(data, image === 'jpeg' ? 'JPEG segments' : 'PNG chunks');
    const notes: Note[] = [{ code: 'scope:image-metadata-only' }];
    if (before.some((f) => f.affectsVerifiability)) notes.push({ code: 'removed:c2pa' });
    return {
      format: image,
      data: stripImageMetadata(data) ?? data,
      removed: before,
      notes,
    };
  }

  const format = detectFormat(data, hint);
  if (format === 'svg' || format === 'html' || format === 'markdown') {
    const text = decodeTextInput(data);
    const cleaned = redactMarkup(text, format);
    return {
      format,
      data: new TextEncoder().encode(cleaned),
      text: cleaned,
      removed: inspectMarkup(text, format),
      notes: [{ code: 'scope:markup-metadata-only' }],
    };
  }
  throw new UnsupportedFormatError(UNSUPPORTED);
}

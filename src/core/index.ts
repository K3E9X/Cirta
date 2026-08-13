/**
 * Cirta — local inspection and redaction of document provenance metadata.
 *
 * Scope, stated plainly because most tools in this space are vague about it:
 *
 *   Handled      Document metadata in PDF, PPTX, DOCX and XLSX; invisible
 *                Unicode characters in plain text.
 *   Not handled  Statistical watermarks embedded in an LLM's token choices.
 *                Those live in the wording, not in any removable field, and
 *                reading them requires the model vendor's secret key. No local
 *                tool can detect or remove one, and this package does not
 *                claim to.
 */

export * from './types.js';
export { scanText, cleanText, summarizeText } from './text.js';
export type { TextScan, CleanTextOptions, CleanTextResult } from './text.js';
export { inspectPdf, redactPdf } from './pdf.js';
export type { RedactPdfOptions } from './pdf.js';
export { inspectOoxml, redactOoxml } from './ooxml.js';
export { inspectImage, stripImageMetadata, detectImageKind } from './image.js';
export { fingerprint } from './fingerprint.js';
export type { RedactOoxmlOptions } from './ooxml.js';

import type { Format, InspectResult, RedactResult } from './types.js';
import { inspectPdf, redactPdf } from './pdf.js';
import { inspectOoxml, redactOoxml } from './ooxml.js';

export class UnsupportedFormatError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'UnsupportedFormatError';
  }
}

function startsWith(data: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => data[i] === byte);
}

/** Identify a document from its magic bytes rather than its file extension. */
export function detectFormat(data: Uint8Array): Format | undefined {
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) return 'docx'; // ZIP; refined by inspectOoxml
  return undefined;
}

export async function inspectFile(data: Uint8Array): Promise<InspectResult> {
  const format = detectFormat(data);
  if (format === 'pdf') return inspectPdf(data);
  if (format) return inspectOoxml(data);
  throw new UnsupportedFormatError(
    'Unrecognised file. Supported: PDF, and Office Open XML (.pptx, .docx, .xlsx).',
  );
}

export async function redactFile(data: Uint8Array): Promise<RedactResult> {
  const format = detectFormat(data);
  if (format === 'pdf') return redactPdf(data);
  if (format) return redactOoxml(data);
  throw new UnsupportedFormatError(
    'Unrecognised file. Supported: PDF, and Office Open XML (.pptx, .docx, .xlsx).',
  );
}

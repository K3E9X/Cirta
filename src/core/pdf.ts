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

const INFO_FIELDS = [
  { key: 'Title', label: 'Title', kind: 'identity' as const },
  { key: 'Author', label: 'Author', kind: 'identity' as const },
  { key: 'Subject', label: 'Subject', kind: 'identity' as const },
  { key: 'Keywords', label: 'Keywords', kind: 'identity' as const },
  { key: 'Creator', label: 'Creating application', kind: 'provenance' as const },
  { key: 'Producer', label: 'Producing application', kind: 'provenance' as const },
  { key: 'CreationDate', label: 'Created', kind: 'timestamp' as const },
  { key: 'ModDate', label: 'Modified', kind: 'timestamp' as const },
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
  { property: 'xmp:CreatorTool', label: 'XMP creator tool', kind: 'provenance' as const },
  { property: 'pdf:Producer', label: 'XMP producer', kind: 'provenance' as const },
  { property: 'dc:creator', label: 'XMP author', kind: 'identity' as const },
  { property: 'dc:title', label: 'XMP title', kind: 'identity' as const },
  { property: 'xmp:CreateDate', label: 'XMP created', kind: 'timestamp' as const },
  { property: 'xmp:ModifyDate', label: 'XMP modified', kind: 'timestamp' as const },
  { property: 'xmpMM:DocumentID', label: 'XMP document ID', kind: 'environment' as const },
  { property: 'xmpMM:InstanceID', label: 'XMP instance ID', kind: 'environment' as const },
];

function looksLikeC2pa(xmp: string): boolean {
  return /c2pa|contentcredentials|content_credentials|claim_generator/i.test(xmp);
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
        findings.push({ kind: field.kind, location: `/Info /${field.key}`, label: field.label, value });
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
          location: `/Metadata ${field.property}`,
          label: field.label,
          value,
        });
      }
    }
    if (looksLikeC2pa(xmp)) {
      findings.push({
        kind: 'provenance',
        location: '/Metadata',
        label: 'C2PA content credentials',
        value: 'signed provenance manifest',
        affectsVerifiability: true,
      });
    }
  }

  const names = doc.catalog.get(PDFName.of('Names'));
  if (names) {
    const resolved = doc.context.lookup(names);
    if (resolved && 'get' in resolved && (resolved as { get(k: PDFName): unknown }).get(PDFName.of('EmbeddedFiles'))) {
      findings.push({
        kind: 'provenance',
        location: '/Names /EmbeddedFiles',
        label: 'Embedded file attachments',
        value: 'present — may carry provenance manifests or source data',
      });
    }
  }

  notes.push({ code: 'scope:pdf-metadata-only' });

  return { format: 'pdf', findings, notes };
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

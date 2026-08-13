/**
 * Inspection and redaction of OpenDocument files (.odt, .ods, .odp).
 *
 * Like OOXML this is a ZIP container, but the metadata lives in a single
 * `meta.xml` and the vocabulary is different: `meta:generator` names the
 * producing build precisely enough to identify a distribution, and
 * `meta:initial-creator` survives long after `dc:creator` has been changed.
 *
 * One structural rule matters here. The `mimetype` entry must be the first in
 * the archive and stored uncompressed; repacking it any other way produces a
 * file that some readers refuse.
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import type { Finding, InspectResult, RedactResult, Format, Note, Confidence } from './types.js';
import { byConfidence } from './types.js';
import { getElementText, setElementText, removeElement, collectAttribute } from './xml.js';
import { fingerprint } from './fingerprint.js';
import { inspectImage, stripImageMetadata } from './image.js';

type Parts = Record<string, Uint8Array>;

const META_FIELDS: Array<{ tag: string; label: string; kind: Finding['kind']; confidence: Confidence }> = [
  { tag: 'meta:initial-creator', label: 'Initial author', kind: 'identity', confidence: 'confirmed' },
  { tag: 'dc:creator', label: 'Last modified by', kind: 'identity', confidence: 'confirmed' },
  { tag: 'meta:printed-by', label: 'Printed by', kind: 'identity', confidence: 'confirmed' },
  { tag: 'dc:title', label: 'Title', kind: 'identity', confidence: 'probable' },
  { tag: 'dc:subject', label: 'Subject', kind: 'identity', confidence: 'probable' },
  { tag: 'dc:description', label: 'Description', kind: 'identity', confidence: 'probable' },
  { tag: 'meta:keyword', label: 'Keywords', kind: 'identity', confidence: 'probable' },
  { tag: 'meta:generator', label: 'Producing application', kind: 'provenance', confidence: 'informational' },
  { tag: 'meta:creation-date', label: 'Created', kind: 'timestamp', confidence: 'probable' },
  { tag: 'dc:date', label: 'Modified', kind: 'timestamp', confidence: 'probable' },
  { tag: 'meta:print-date', label: 'Last printed', kind: 'timestamp', confidence: 'probable' },
  { tag: 'meta:editing-cycles', label: 'Edit cycles', kind: 'timestamp', confidence: 'probable' },
  { tag: 'meta:editing-duration', label: 'Total editing time', kind: 'timestamp', confidence: 'probable' },
];

const ODF_MIMETYPES: Array<[RegExp, Format]> = [
  [/opendocument\.text/, 'odt'],
  [/opendocument\.spreadsheet/, 'ods'],
  [/opendocument\.presentation/, 'odp'],
];

/** True when the ZIP declares itself as an OpenDocument package. */
export function isOdf(parts: Parts): boolean {
  const mimetype = parts['mimetype'];
  return Boolean(mimetype && strFromU8(mimetype).startsWith('application/vnd.oasis.opendocument'));
}

export function detectOdfFormat(parts: Parts): Format {
  const mimetype = parts['mimetype'] ? strFromU8(parts['mimetype']) : '';
  for (const [pattern, format] of ODF_MIMETYPES) {
    if (pattern.test(mimetype)) return format;
  }
  return 'odt';
}

function readText(parts: Parts, path: string): string | undefined {
  const raw = parts[path];
  return raw ? strFromU8(raw) : undefined;
}

function findMediaParts(parts: Parts): string[] {
  return Object.keys(parts).filter((p) => /^Pictures\//.test(p));
}

/** Locate a C2PA provenance manifest if the producer embedded one. */
function findC2paParts(parts: Parts): string[] {
  return Object.keys(parts).filter((p) => /c2pa|contentcredentials|content_credentials/i.test(p));
}

export function inspectOdf(data: Uint8Array): InspectResult {
  const parts = unzipSync(data);
  const format = detectOdfFormat(parts);
  const findings: Finding[] = [];
  const notes: Note[] = [];

  const meta = readText(parts, 'meta.xml');
  if (meta) {
    for (const field of META_FIELDS) {
      const value = getElementText(meta, field.tag);
      if (value && value !== '0' && value !== 'PT00H00M00S') {
        findings.push({
          kind: field.kind,
          confidence: field.confidence,
          location: `meta.xml:${field.tag}`,
          label: field.label,
          value,
        });
      }
    }

    // Arbitrary key/value pairs an author or a template can attach.
    const userDefined = collectAttribute(meta, 'meta:name');
    if (userDefined.length) {
      findings.push({
        kind: 'identity',
        confidence: 'confirmed',
        location: 'meta.xml:meta:user-defined',
        label: 'User-defined properties',
        value: userDefined.join(', '),
      });
    }
  }

  if (Object.keys(parts).some((p) => p.startsWith('Thumbnails/'))) {
    findings.push({
      kind: 'identity',
      confidence: 'probable',
      location: 'Thumbnails/',
      label: 'Embedded thumbnail',
      value: 'rendered preview of document content',
    });
  }

  for (const path of findMediaParts(parts)) {
    findings.push(...inspectImage(parts[path]!, path));
  }

  for (const path of findC2paParts(parts)) {
    findings.push({
      kind: 'provenance',
      confidence: 'confirmed',
      location: path,
      label: 'C2PA provenance manifest',
      value: 'signed content credentials',
      affectsVerifiability: true,
    });
  }

  notes.push({ code: 'scope:ooxml-metadata-only' });
  findings.push(...fingerprint(findings));

  return { format, findings: findings.sort(byConfidence), notes };
}

/** Repack with `mimetype` first and stored, as the OpenDocument package spec requires. */
function repack(parts: Parts): Uint8Array {
  const ordered: Parts = {};
  const mimetype = parts['mimetype'];
  if (mimetype) ordered['mimetype'] = mimetype;
  for (const [path, raw] of Object.entries(parts)) {
    if (path !== 'mimetype') ordered[path] = raw;
  }
  return zipSync(ordered, { level: 6, ...(mimetype ? { mimetype: { level: 0 } } : {}) });
}

export function redactOdf(data: Uint8Array): RedactResult {
  const before = inspectOdf(data);
  const parts = unzipSync(data);
  const format = detectOdfFormat(parts);
  const notes: Note[] = [];

  let meta = readText(parts, 'meta.xml');
  if (meta) {
    for (const field of META_FIELDS) {
      // Dates and durations are removed rather than blanked; an empty
      // meta:creation-date is not a valid value.
      meta = /date$/.test(field.tag)
        ? removeElement(meta, field.tag)
        : setElementText(meta, field.tag, field.tag === 'meta:editing-cycles' ? '0' : '');
    }
    meta = removeElement(meta, 'meta:user-defined');
    meta = removeElement(meta, 'meta:document-statistic');
    parts['meta.xml'] = strToU8(meta);
  }

  for (const path of Object.keys(parts)) {
    if (path.startsWith('Thumbnails/')) delete parts[path];
  }

  for (const path of findMediaParts(parts)) {
    const stripped = stripImageMetadata(parts[path]!);
    if (stripped) parts[path] = stripped;
  }

  for (const path of findC2paParts(parts)) {
    delete parts[path];
    notes.push({ code: 'removed:c2pa', detail: path });
  }

  notes.push(...before.notes);

  return { format, data: repack(parts), removed: before.findings, notes };
}

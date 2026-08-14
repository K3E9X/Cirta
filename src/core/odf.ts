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

import { zipSync, strToU8, strFromU8 } from 'fflate';
import { unzipGuarded } from './zip.js';
import type { Finding, InspectResult, RedactResult, Format, Note, Confidence } from './types.js';
import { byConfidence } from './types.js';
import {
  getElementText,
  removeElement,
  collectAttribute,
  collectNamedProperties,
  collectTextContent,
  mapTextContent,
} from './xml.js';
import { scanText, cleanText, isArrangementFinding } from './text.js';
import { fingerprint } from './fingerprint.js';
import { describeC2pa } from './c2pa.js';
import { findSourceTypes } from './sourcetype.js';
import { scanContent } from './archive.js';
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

/** OpenDocument keeps all visible text in these two parts. */
function isBodyPart(path: string): boolean {
  return path === 'content.xml' || path === 'styles.xml';
}

/** Invisible characters in the body travel with copied text, so they are reported. */
function inspectBodyText(parts: Parts): Finding[] {
  const findings: Finding[] = [];
  for (const [path, raw] of Object.entries(parts)) {
    if (!isBodyPart(path)) continue;
    const scan = scanText(collectTextContent(strFromU8(raw)));
    for (const finding of scan.findings) {
      // Line and sentence layout here belongs to the markup, not the author.
      if (isArrangementFinding(finding)) continue;
      findings.push({ ...finding, location: `${path} (${finding.location})` });
    }
    for (const payload of scan.decoded) {
      findings.push({
        kind: 'invisible-character',
        confidence: 'confirmed',
        location: path,
        label: 'Hidden payload in document text',
        value: payload,
      });
    }
  }
  return findings;
}

/**
 * What an OpenDocument package's own construction says about who built it.
 *
 * ODF gives a cleaner answer than any other format here, because an office
 * suite writes several parts that have nothing to do with the document's
 * content and that a generating library has no reason to invent:
 *
 *   - `settings.xml` — window size, cursor position, zoom level. This is the
 *     state of somebody's screen. Nothing writes it but an application that
 *     had a screen.
 *   - `meta:editing-cycles` — how many times the file was opened and saved.
 *     LibreOffice writes it on the first save and increments it forever after.
 *   - `Thumbnails/thumbnail.png` and `manifest.rdf`, both written by default.
 *
 * The first two carry the weight; the last two are ordinary enough to disable
 * that they only corroborate. The check earns its place because `meta:generator`
 * is a free-text field: a library can write `LibreOffice/7.5` into it and be
 * believed. It cannot as easily fake having been open in a window.
 */
function structuralOdf(parts: Parts, meta: string | undefined): Finding[] {
  const out: Finding[] = [];
  const has = (p: string) => Object.keys(parts).some((k) => k === p || k.startsWith(p));

  const generator = meta ? getElementText(meta, 'meta:generator') : undefined;
  const created = meta ? getElementText(meta, 'meta:creation-date') : undefined;

  // An office suite's package with an emptied meta.xml. The parts that prove a
  // window was open are still there, so the missing metadata was taken out
  // afterwards rather than never written — worth saying, because cleaning a
  // file leaves its own mark and the reader deserves to know that.
  if (has('settings.xml') && generator !== undefined && generator.trim() === '') {
    out.push({
      kind: 'provenance',
      confidence: 'confirmed',
      location: 'meta.xml:meta:generator',
      label: 'Metadata has been stripped from this file',
      value:
        'the generator element is present and empty, which no application writes; the package ' +
        'still carries the parts an office suite adds, so the metadata was removed after the fact',
    });
  }

  const strong: string[] = [];
  if (!has('settings.xml')) strong.push('no settings.xml, which records the state of an open window');
  if (meta && !getElementText(meta, 'meta:editing-cycles')) {
    strong.push('no edit-cycle count, which an office suite writes on the first save');
  }

  const weak: string[] = [];
  if (!has('Thumbnails/')) weak.push('no embedded thumbnail');
  if (!has('manifest.rdf')) weak.push('no manifest.rdf');

  if (strong.length >= 1 && strong.length + weak.length >= 2) {
    const claim = generator?.trim()
      ? ` — despite meta:generator naming ${generator.trim()}`
      : '';
    out.push({
      kind: 'provenance',
      confidence: strong.length >= 2 ? 'probable' : 'informational',
      location: 'package structure',
      label: 'Assembled by a program, not saved from an office suite',
      value: [...strong, ...weak].join('; ') + claim,
    });
  }

  if (created && meta) {
    const modified = getElementText(meta, 'dc:date');
    if (modified && modified === created) {
      out.push({
        kind: 'provenance',
        confidence: 'informational',
        location: 'meta.xml',
        label: 'Written in a single pass',
        value: 'created and last modified at the same instant, so the file was never reopened',
      });
    }
  }

  return out;
}

export function inspectOdf(data: Uint8Array): InspectResult {
  const parts = unzipGuarded(data);
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

    // Arbitrary key/value pairs an author or a template can attach. Reported
    // with their values, since that is where a model or session name lands.
    const userDefined = collectNamedProperties(meta, 'meta:user-defined', 'meta:name');
    for (const { name, value } of userDefined) {
      findings.push({
        kind: 'identity',
        confidence: 'confirmed',
        location: `meta.xml:meta:user-defined:${name}`,
        label: `User-defined property: ${name}`,
        value,
      });
    }
    if (userDefined.length === 0) {
      const names = collectAttribute(meta, 'meta:name');
      if (names.length) {
        findings.push({
          kind: 'identity',
          confidence: 'confirmed',
          location: 'meta.xml:meta:user-defined',
          label: 'User-defined properties',
          value: names.join(', '),
        });
      }
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
    findings.push(...describeC2pa(strFromU8(parts[path]!), path, parts[path]!));
  }

  for (const [path, raw] of Object.entries(parts)) {
    if (!/\.(xml|rdf|txt|json)$/.test(path)) continue;
    findings.push(...scanContent(strFromU8(raw), path));
    findings.push(...findSourceTypes(strFromU8(raw), path));
  }

  findings.push(...inspectBodyText(parts));
  findings.push(...structuralOdf(parts, meta));

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
  const parts = unzipGuarded(data);
  const format = detectOdfFormat(parts);
  const notes: Note[] = [];

  let meta = readText(parts, 'meta.xml');
  if (meta) {
    // Removed, not blanked. An empty <meta:generator/> is not a neutral
    // value — it is a shape no application writes, and structuralOdf() reports
    // it as evidence the file was scrubbed. Blanking would replace one mark
    // with another, which is the opposite of the point. Every element here is
    // optional in the schema, so removal produces a valid document.
    for (const field of META_FIELDS) meta = removeElement(meta, field.tag);
    meta = removeElement(meta, 'meta:user-defined');
    meta = removeElement(meta, 'meta:document-statistic');
    parts['meta.xml'] = strToU8(meta);
  }

  for (const path of Object.keys(parts)) {
    if (path.startsWith('Thumbnails/')) delete parts[path];
  }

  for (const path of Object.keys(parts)) {
    if (!isBodyPart(path)) continue;
    parts[path] = strToU8(mapTextContent(strFromU8(parts[path]!), (text) => cleanText(text, { normalizeSpaces: false }).text));
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

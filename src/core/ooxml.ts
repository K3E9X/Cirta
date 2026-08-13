/**
 * Inspection and redaction of Office Open XML documents (.pptx, .docx, .xlsx).
 *
 * An OOXML file is a ZIP container. Identifying data lives in a handful of
 * well-known parts:
 *   docProps/core.xml    author, last editor, timestamps, revision counter
 *   docProps/app.xml     producing application, company, manager, template path
 *   docProps/custom.xml  arbitrary custom properties
 *   docProps/thumbnail.* rendered preview of the first page or slide
 *   word/settings.xml    rsid values, which correlate documents edited together
 *   comments / revisions author names attached to tracked changes
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { inspectImage, stripImageMetadata } from './image.js';
import { fingerprint } from './fingerprint.js';
import { scanContent } from './archive.js';
import type { Finding, InspectResult, RedactResult, Format, Note, Confidence } from './types.js';
import { byConfidence } from './types.js';
import {
  getElementText,
  setElementText,
  removeElement,
  removeAttribute,
  collectAttribute,
} from './xml.js';

type Parts = Record<string, Uint8Array>;

const CORE_FIELDS: Array<{ tag: string; label: string; kind: Finding['kind']; confidence: Confidence }> = [
  { tag: 'dc:creator', label: 'Author', kind: 'identity', confidence: 'confirmed' },
  { tag: 'cp:lastModifiedBy', label: 'Last modified by', kind: 'identity', confidence: 'confirmed' },
  { tag: 'dc:title', label: 'Title', kind: 'identity', confidence: 'probable' },
  { tag: 'dc:subject', label: 'Subject', kind: 'identity', confidence: 'probable' },
  { tag: 'dc:description', label: 'Description', kind: 'identity', confidence: 'probable' },
  { tag: 'cp:keywords', label: 'Keywords', kind: 'identity', confidence: 'probable' },
  { tag: 'cp:category', label: 'Category', kind: 'identity', confidence: 'probable' },
  { tag: 'cp:contentStatus', label: 'Content status', kind: 'identity', confidence: 'informational' },
  { tag: 'cp:revision', label: 'Revision number', kind: 'timestamp', confidence: 'probable' },
  { tag: 'cp:lastPrinted', label: 'Last printed', kind: 'timestamp', confidence: 'probable' },
  { tag: 'dcterms:created', label: 'Created', kind: 'timestamp', confidence: 'probable' },
  { tag: 'dcterms:modified', label: 'Modified', kind: 'timestamp', confidence: 'probable' },
];

const APP_FIELDS: Array<{ tag: string; label: string; kind: Finding['kind']; confidence: Confidence }> = [
  { tag: 'Application', label: 'Producing application', kind: 'provenance', confidence: 'informational' },
  { tag: 'AppVersion', label: 'Application version', kind: 'provenance', confidence: 'informational' },
  { tag: 'Company', label: 'Company', kind: 'identity', confidence: 'confirmed' },
  { tag: 'Manager', label: 'Manager', kind: 'identity', confidence: 'confirmed' },
  { tag: 'Template', label: 'Template', kind: 'environment', confidence: 'confirmed' },
  { tag: 'TotalTime', label: 'Total editing time', kind: 'timestamp', confidence: 'probable' },
];

/** Timestamp-typed elements are removed rather than blanked; an empty
 *  `dcterms:created` is not a valid W3CDTF value. */
const DATE_TAGS = new Set(['dcterms:created', 'dcterms:modified']);

/**
 * Replacement for comment and tracked-change author names. The attribute is
 * required by the schema, so the name is substituted rather than deleted; the
 * placeholder is then ignored on inspection so that a redacted document reports
 * as clean.
 */
const ANONYMOUS_AUTHOR = 'Author';

export function detectOoxmlFormat(parts: Parts): Format {
  if (parts['word/document.xml']) return 'docx';
  if (parts['ppt/presentation.xml']) return 'pptx';
  if (parts['xl/workbook.xml']) return 'xlsx';
  return 'docx';
}

function readText(parts: Parts, path: string): string | undefined {
  const raw = parts[path];
  return raw ? strFromU8(raw) : undefined;
}

/** Locate a C2PA provenance manifest if the producer embedded one. */
function findC2paParts(parts: Parts): string[] {
  return Object.keys(parts).filter((p) => /c2pa|contentcredentials|content_credentials/i.test(p));
}

/** Embedded pictures, which keep their own camera metadata. */
function findMediaParts(parts: Parts): string[] {
  return Object.keys(parts).filter((p) => /^(ppt|word|xl)\/media\//.test(p));
}

/**
 * A hyperlink pointing at the author's own disk or an internal share leaks the
 * username and the network topology. Web links are ignored.
 */
const LOCAL_TARGET = /^(file:|[a-z]:[\\/]|\\\\)/i;

function findLocalHyperlinks(parts: Parts): Array<{ part: string; target: string }> {
  const out: Array<{ part: string; target: string }> = [];
  for (const [path, raw] of Object.entries(parts)) {
    if (!path.endsWith('.rels')) continue;
    const xml = strFromU8(raw);
    for (const target of collectAttribute(xml, 'Target')) {
      const decoded = decodeURI(target.replace(/&amp;/g, '&'));
      if (LOCAL_TARGET.test(decoded)) out.push({ part: path, target: decoded });
    }
  }
  return out;
}

/** Slides marked `show="0"` stay in the file and travel with it. */
function findHiddenSlides(parts: Parts): string[] {
  return Object.keys(parts)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .filter((p) => /<p:sld[^>]*\sshow="(0|false)"/.test(strFromU8(parts[p]!)))
    .sort();
}

/** Presenter notes are rarely written for the audience that receives the deck. */
function findSpeakerNotes(parts: Parts): number {
  return Object.keys(parts).filter(
    (p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p) && /<a:t>[^<]+<\/a:t>/.test(strFromU8(parts[p]!)),
  ).length;
}

export function inspectOoxml(data: Uint8Array): InspectResult {
  const parts = unzipSync(data);
  const format = detectOoxmlFormat(parts);
  const findings: Finding[] = [];
  const notes: Note[] = [];

  const core = readText(parts, 'docProps/core.xml');
  if (core) {
    for (const field of CORE_FIELDS) {
      const value = getElementText(core, field.tag);
      if (value) {
        findings.push({
          kind: field.kind,
          confidence: field.confidence,
          location: `docProps/core.xml:${field.tag}`,
          label: field.label,
          value,
        });
      }
    }
  }

  const app = readText(parts, 'docProps/app.xml');
  if (app) {
    for (const field of APP_FIELDS) {
      const value = getElementText(app, field.tag);
      if (value && value !== '0') {
        findings.push({
          kind: field.kind,
          confidence: field.confidence,
          location: `docProps/app.xml:${field.tag}`,
          label: field.label,
          value,
        });
      }
    }
  }

  const custom = readText(parts, 'docProps/custom.xml');
  if (custom) {
    const names = collectAttribute(custom, 'name');
    findings.push({
      kind: 'identity',
      confidence: 'confirmed',
      location: 'docProps/custom.xml',
      label: 'Custom properties',
      value: names.length ? names.join(', ') : 'present',
    });
  }

  const thumbnail = Object.keys(parts).find((p) => p.startsWith('docProps/thumbnail'));
  if (thumbnail) {
    findings.push({
      kind: 'identity',
      confidence: 'probable',
      location: thumbnail,
      label: 'Embedded thumbnail',
      value: 'rendered preview of document content',
    });
  }

  const settings = readText(parts, 'word/settings.xml');
  if (settings) {
    const rsids = collectAttribute(settings, 'w:val').filter((v) => /^[0-9A-F]{8}$/i.test(v));
    if (rsids.length) {
      findings.push({
        kind: 'environment',
        confidence: 'probable',
        location: 'word/settings.xml:w:rsid',
        label: 'Revision save IDs',
        value: `${rsids.length} value${rsids.length > 1 ? 's' : ''} (correlate documents edited in the same session)`,
      });
    }
  }

  const authors = new Set<string>();
  for (const [path, raw] of Object.entries(parts)) {
    if (!/\.xml$/.test(path)) continue;
    if (!/comments|people|document|slide/.test(path)) continue;
    for (const author of collectAttribute(strFromU8(raw), 'w:author')) {
      if (author !== ANONYMOUS_AUTHOR) authors.add(author);
    }
  }
  if (authors.size) {
    findings.push({
      kind: 'identity',
      confidence: 'confirmed',
      location: 'tracked changes / comments',
      label: 'Comment and revision authors',
      value: [...authors].join(', '),
    });
  }

  for (const { part, target } of findLocalHyperlinks(parts)) {
    findings.push({
      kind: 'environment',
      confidence: 'confirmed',
      location: part,
      label: 'Link to a local or network path',
      value: target,
    });
  }

  for (const path of findMediaParts(parts)) {
    findings.push(...inspectImage(parts[path]!, path));
  }

  const hidden = findHiddenSlides(parts);
  if (hidden.length) {
    findings.push({
      kind: 'identity',
      confidence: 'probable',
      location: hidden.join(', '),
      label: 'Hidden slides',
      value: `${hidden.length} hidden slide${hidden.length > 1 ? 's' : ''} still present in the file`,
    });
  }

  const notesCount = findSpeakerNotes(parts);
  if (notesCount) {
    findings.push({
      kind: 'identity',
      confidence: 'probable',
      location: 'ppt/notesSlides/',
      label: 'Speaker notes',
      value: `${notesCount} slide${notesCount > 1 ? 's' : ''} with presenter notes`,
    });
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

  // Credentials and provider-issued ids are scanned for in the body too: they
  // cannot occur innocently, unlike a vendor name, which often just means the
  // document talks about the vendor.
  for (const [path, raw] of Object.entries(parts)) {
    if (!/\.(xml|rels|json|txt|bin)$/.test(path)) continue;
    findings.push(...scanContent(strFromU8(raw), path));
  }

  notes.push({ code: 'scope:ooxml-metadata-only' });

  // Derived last, so it can draw on every field the format modules surfaced.
  findings.push(...fingerprint(findings));

  return { format, findings: findings.sort(byConfidence), notes };
}

export interface RedactOoxmlOptions {
  /** Remove the embedded thumbnail preview. Default true. */
  removeThumbnail?: boolean;
  /** Remove rsid values from word/settings.xml. Default true. */
  removeRsids?: boolean;
  /** Remove comment and tracked-change author names. Default true. */
  anonymizeAuthors?: boolean;
  /** Strip Exif/XMP/IPTC from embedded pictures. Default true. */
  stripMedia?: boolean;
}

/** Drop a part and the `[Content_Types].xml` override and relationship that reference it. */
function removePart(parts: Parts, path: string): void {
  delete parts[path];

  const types = readText(parts, '[Content_Types].xml');
  if (types) {
    const cleaned = types.replace(
      new RegExp(`<Override[^>]*PartName="/${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`, 'g'),
      '',
    );
    parts['[Content_Types].xml'] = strToU8(cleaned);
  }

  const rels = readText(parts, '_rels/.rels');
  if (rels) {
    const target = path.replace(/^docProps\//, '');
    const cleaned = rels.replace(
      new RegExp(`<Relationship[^>]*Target="[^"]*${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`, 'g'),
      '',
    );
    parts['_rels/.rels'] = strToU8(cleaned);
  }
}

/** Rebuild the container with `[Content_Types].xml` first, as OPC readers expect. */
function repack(parts: Parts): Uint8Array {
  const ordered: Parts = {};
  const contentTypes = parts['[Content_Types].xml'];
  if (contentTypes) ordered['[Content_Types].xml'] = contentTypes;
  for (const [path, raw] of Object.entries(parts)) {
    if (path !== '[Content_Types].xml') ordered[path] = raw;
  }
  return zipSync(ordered, { level: 6 });
}

export function redactOoxml(data: Uint8Array, options: RedactOoxmlOptions = {}): RedactResult {
  const {
    removeThumbnail = true,
    removeRsids = true,
    anonymizeAuthors = true,
    stripMedia = true,
  } = options;

  const before = inspectOoxml(data);
  const parts = unzipSync(data);
  const format = detectOoxmlFormat(parts);
  const notes: Note[] = [];

  let core = readText(parts, 'docProps/core.xml');
  if (core) {
    for (const field of CORE_FIELDS) {
      core = DATE_TAGS.has(field.tag)
        ? removeElement(core, field.tag)
        : setElementText(core, field.tag, '');
    }
    parts['docProps/core.xml'] = strToU8(core);
  }

  let app = readText(parts, 'docProps/app.xml');
  if (app) {
    for (const field of APP_FIELDS) {
      app = field.tag === 'TotalTime' ? setElementText(app, field.tag, '0') : setElementText(app, field.tag, '');
    }
    parts['docProps/app.xml'] = strToU8(app);
  }

  if (parts['docProps/custom.xml']) removePart(parts, 'docProps/custom.xml');

  if (removeThumbnail) {
    const thumbnail = Object.keys(parts).find((p) => p.startsWith('docProps/thumbnail'));
    if (thumbnail) removePart(parts, thumbnail);
  }

  if (removeRsids) {
    const settings = readText(parts, 'word/settings.xml');
    if (settings) {
      let cleaned = removeElement(settings, 'w:rsids');
      cleaned = removeAttribute(cleaned, 'w:rsidR');
      cleaned = removeAttribute(cleaned, 'w:rsidRDefault');
      parts['word/settings.xml'] = strToU8(cleaned);
    }
  }

  if (anonymizeAuthors) {
    for (const [path, raw] of Object.entries(parts)) {
      if (!/\.xml$/.test(path)) continue;
      const xml = strFromU8(raw);
      if (!xml.includes('w:author=')) continue;
      parts[path] = strToU8(xml.replace(/\sw:author="[^"]*"/g, ` w:author="${ANONYMOUS_AUTHOR}"`));
    }
  }

  if (stripMedia) {
    for (const path of findMediaParts(parts)) {
      const stripped = stripImageMetadata(parts[path]!);
      if (stripped) parts[path] = stripped;
    }
  }

  for (const path of findC2paParts(parts)) {
    removePart(parts, path);
    notes.push({ code: 'removed:c2pa', detail: path });
  }

  // Hyperlinks, hidden slides and speaker notes are document content rather
  // than metadata. Deleting them would silently change what the recipient
  // reads, so they are reported and left alone.
  const contentLeft = [
    findLocalHyperlinks(parts).length && 'local links',
    findHiddenSlides(parts).length && 'hidden slides',
    findSpeakerNotes(parts) && 'speaker notes',
  ].filter((v): v is string => typeof v === 'string');
  if (contentLeft.length) notes.push({ code: 'kept:content', detail: contentLeft.join(', ') });

  notes.push(...before.notes);

  return { format, data: repack(parts), removed: before.findings, notes };
}

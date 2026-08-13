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
import type { Finding, InspectResult, RedactResult, Format, Note } from './types.js';
import {
  getElementText,
  setElementText,
  removeElement,
  removeAttribute,
  collectAttribute,
} from './xml.js';

type Parts = Record<string, Uint8Array>;

const CORE_FIELDS: Array<{ tag: string; label: string; kind: Finding['kind'] }> = [
  { tag: 'dc:creator', label: 'Author', kind: 'identity' },
  { tag: 'cp:lastModifiedBy', label: 'Last modified by', kind: 'identity' },
  { tag: 'dc:title', label: 'Title', kind: 'identity' },
  { tag: 'dc:subject', label: 'Subject', kind: 'identity' },
  { tag: 'dc:description', label: 'Description', kind: 'identity' },
  { tag: 'cp:keywords', label: 'Keywords', kind: 'identity' },
  { tag: 'cp:category', label: 'Category', kind: 'identity' },
  { tag: 'cp:contentStatus', label: 'Content status', kind: 'identity' },
  { tag: 'cp:revision', label: 'Revision number', kind: 'timestamp' },
  { tag: 'dcterms:created', label: 'Created', kind: 'timestamp' },
  { tag: 'dcterms:modified', label: 'Modified', kind: 'timestamp' },
];

const APP_FIELDS: Array<{ tag: string; label: string; kind: Finding['kind'] }> = [
  { tag: 'Application', label: 'Producing application', kind: 'provenance' },
  { tag: 'AppVersion', label: 'Application version', kind: 'provenance' },
  { tag: 'Company', label: 'Company', kind: 'identity' },
  { tag: 'Manager', label: 'Manager', kind: 'identity' },
  { tag: 'Template', label: 'Template', kind: 'environment' },
  { tag: 'TotalTime', label: 'Total editing time', kind: 'timestamp' },
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
      location: 'docProps/custom.xml',
      label: 'Custom properties',
      value: names.length ? names.join(', ') : 'present',
    });
  }

  const thumbnail = Object.keys(parts).find((p) => p.startsWith('docProps/thumbnail'));
  if (thumbnail) {
    findings.push({
      kind: 'identity',
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
      location: 'tracked changes / comments',
      label: 'Comment and revision authors',
      value: [...authors].join(', '),
    });
  }

  for (const path of findC2paParts(parts)) {
    findings.push({
      kind: 'provenance',
      location: path,
      label: 'C2PA provenance manifest',
      value: 'signed content credentials',
      affectsVerifiability: true,
    });
  }

  notes.push({ code: 'scope:ooxml-metadata-only' });

  return { format, findings, notes };
}

export interface RedactOoxmlOptions {
  /** Remove the embedded thumbnail preview. Default true. */
  removeThumbnail?: boolean;
  /** Remove rsid values from word/settings.xml. Default true. */
  removeRsids?: boolean;
  /** Remove comment and tracked-change author names. Default true. */
  anonymizeAuthors?: boolean;
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
  const { removeThumbnail = true, removeRsids = true, anonymizeAuthors = true } = options;

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

  for (const path of findC2paParts(parts)) {
    removePart(parts, path);
    notes.push({ code: 'removed:c2pa', detail: path });
  }

  notes.push(...before.notes);

  return { format, data: repack(parts), removed: before.findings, notes };
}

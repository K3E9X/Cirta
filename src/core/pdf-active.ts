/**
 * [F-2.1] What a PDF does, as opposed to what it says.
 *
 * A PDF can run JavaScript when it opens or when a page or a field is
 * touched, launch a program, post its form fields to a server, open another
 * file over a network share, play rich media, and carry other files inside
 * it. None of that is metadata, and all of it travels with a "cleaned"
 * copy unless it is taken out. Each is reported with what it targets — the
 * code, the program, the address — because "the file has a script" is not
 * something anyone can act on.
 */

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString, decodePDFRawStream } from 'pdf-lib';
import type { Finding, InspectResult } from './types.js';
import { preview } from './types.js';
import { cleanUrl, trackingFinding } from './tracking.js';
import { linkFindings } from './links.js';
import { fileNameFindings } from './filenames.js';

type Lookup = (value: unknown) => unknown;

const MAX_ACTIONS = 200;
const MAX_FILES = 20;
const MAX_EMBEDDED_BYTES = 32 * 1024 * 1024;

/** Actions that do something beyond moving the reader inside this document. */
const ACTIVE = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'GoToR', 'GoToE', 'RichMediaExecute', 'Rendition', 'Movie', 'Sound']);
/** Annotations that are, themselves, active content. */
const ACTIVE_ANNOTS = new Set(['RichMedia', 'Screen', 'Movie', 'Sound', 'FileAttachment']);

function text(value: unknown, lookup: Lookup): string | undefined {
  const resolved = lookup(value);
  if (resolved instanceof PDFString || resolved instanceof PDFHexString) return resolved.decodeText();
  if (resolved instanceof PDFName) return resolved.decodeText();
  if (resolved instanceof PDFRawStream) {
    try {
      return new TextDecoder('latin1').decode(decodePDFRawStream(resolved).decode().subarray(0, 64 * 1024));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const dict = (value: unknown, lookup: Lookup): PDFDict | undefined => {
  const resolved = lookup(value);
  return resolved instanceof PDFDict ? resolved : undefined;
};

/** A key of a dictionary — of something that really is one: a damaged file's catalog may not be. */
const get = (d: unknown, key: string) => (d instanceof PDFDict ? d.get(PDFName.of(key)) : undefined);

/** A file specification as a name: a string, or a dictionary's /UF, /F or /Win /F. */
function fileName(value: unknown, lookup: Lookup): string | undefined {
  const direct = text(value, lookup);
  if (direct !== undefined) return direct;
  const spec = dict(value, lookup);
  if (!spec) return undefined;
  return text(get(spec, 'UF'), lookup) ?? text(get(spec, 'F'), lookup) ?? text(get(dict(get(spec, 'Win'), lookup), 'F'), lookup);
}

/** What one action does, in its own terms: its type and its target. */
function describe(action: PDFDict, lookup: Lookup): { type: string; target: string } | undefined {
  const type = text(get(action, 'S'), lookup);
  if (!type || !ACTIVE.has(type)) return undefined;
  switch (type) {
    case 'JavaScript':
      return { type, target: preview((text(get(action, 'JS'), lookup) ?? '').replace(/\s+/g, ' ').trim(), 200) };
    case 'Launch':
    case 'GoToR':
    case 'GoToE':
    case 'ImportData':
    case 'SubmitForm':
      return { type, target: fileName(get(action, 'F'), lookup) ?? fileName(get(action, 'Win'), lookup) ?? '' };
    default:
      return { type, target: '' };
  }
}

/** An action and the ones chained after it with /Next. */
function chain(value: unknown, lookup: Lookup, seen = new Set<unknown>()): PDFDict[] {
  const out: PDFDict[] = [];
  const queue = [value];
  while (queue.length && out.length < MAX_ACTIONS) {
    const item = lookup(queue.shift());
    if (!item || seen.has(item)) continue;
    seen.add(item);
    if (item instanceof PDFArray) queue.push(...item.asArray());
    else if (item instanceof PDFDict) {
      out.push(item);
      const next = get(item, 'Next');
      if (next) queue.push(next);
    }
  }
  return out;
}

/** The leaves of a name tree (/Names /JavaScript, /Names /EmbeddedFiles). */
function nameTree(root: PDFDict | undefined, lookup: Lookup): Array<{ name: string; value: unknown }> {
  const out: Array<{ name: string; value: unknown }> = [];
  const seen = new Set<unknown>();
  const queue: Array<PDFDict | undefined> = [root];
  while (queue.length && out.length < MAX_ACTIONS) {
    const node = queue.shift();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    const names = lookup(get(node, 'Names'));
    if (names instanceof PDFArray) {
      const items = names.asArray();
      for (let i = 0; i + 1 < items.length; i += 2) out.push({ name: text(items[i], lookup) ?? '', value: items[i + 1] });
    }
    const kids = lookup(get(node, 'Kids'));
    if (kids instanceof PDFArray) for (const kid of kids.asArray()) queue.push(dict(kid, lookup));
  }
  return out;
}

export interface EmbeddedFile {
  name: string;
  mime?: string;
  data: Uint8Array;
}

export interface ActiveScan {
  findings: Finding[];
  files: EmbeddedFile[];
}

function embedded(spec: PDFDict | undefined, lookup: Lookup): EmbeddedFile | undefined {
  if (!spec) return undefined;
  const stream = lookup(get(dict(get(spec, 'EF'), lookup), 'F')) ?? lookup(get(dict(get(spec, 'EF'), lookup), 'UF'));
  if (!(stream instanceof PDFRawStream)) return undefined;
  let data: Uint8Array;
  try {
    data = decodePDFRawStream(stream).decode();
  } catch {
    data = stream.contents;
  }
  if (data.length > MAX_EMBEDDED_BYTES) data = data.subarray(0, 0);
  const mime = text(stream.dict.get(PDFName.of('Subtype')), lookup);
  return { name: fileName(spec, lookup) ?? 'unnamed', mime, data };
}

/** Every page's dictionary, in order, through the page tree. */
function pages(doc: PDFDocument): PDFDict[] {
  try {
    return doc.getPages().map((page) => page.node);
  } catch {
    return [];
  }
}

export function scanActive(doc: PDFDocument): ActiveScan {
  const lookup: Lookup = (value) => (value instanceof PDFRef ? doc.context.lookup(value) : value);
  const findings: Finding[] = [];
  const files: EmbeddedFile[] = [];
  const uris = new Set<string>();
  const catalog: PDFDict | undefined = doc.catalog instanceof PDFDict ? doc.catalog : undefined;

  const report = (label: string, location: string, action: PDFDict, where?: string) => {
    if (findings.length >= MAX_ACTIONS) return;
    const described = describe(action, lookup);
    if (!described) return;
    const what = described.target ? `${described.type}: ${described.target}` : described.type;
    findings.push({
      kind: 'active-content',
      confidence: 'confirmed',
      location,
      label: label === 'by-type' ? LABEL[described.type] ?? 'JavaScript in the document' : label,
      value: where ? `${where} — ${what}` : what,
    });
  };

  const follow = (value: unknown, label: string, location: string, where?: string) => {
    for (const action of chain(value, lookup)) {
      const type = text(get(action, 'S'), lookup);
      if (type === 'URI') {
        const uri = text(get(action, 'URI'), lookup);
        if (uri) uris.add(uri);
      } else report(label, location, action, where);
    }
  };

  const triggers = (owner: PDFDict | undefined, location: string, where: string) => {
    const aa = dict(get(owner, 'AA'), lookup);
    if (!aa) return;
    for (const [key, value] of aa.entries()) follow(value, 'Action triggered by an event', location, `${where} /${key.decodeText()}`);
  };

  // On opening: a destination array only moves the view; a dictionary is an action.
  const open = lookup(get(catalog, 'OpenAction'));
  if (open instanceof PDFDict) follow(open, 'Action run when the document opens', '/OpenAction');
  triggers(catalog, '/AA', '/Root');

  const names = dict(get(catalog, 'Names'), lookup);
  for (const { name, value } of nameTree(dict(get(names, 'JavaScript'), lookup), lookup)) {
    follow(value, 'JavaScript in the document', '/Names /JavaScript', name || undefined);
  }
  for (const { value } of nameTree(dict(get(names, 'EmbeddedFiles'), lookup), lookup)) {
    const file = embedded(dict(value, lookup), lookup);
    if (file && files.length < MAX_FILES) files.push(file);
  }

  for (const [index, page] of pages(doc).entries()) {
    const where = `page ${index + 1}`;
    triggers(page, where, where);
    const annots = lookup(get(page, 'Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (const item of annots.asArray()) {
      const annot = dict(item, lookup);
      if (!annot) continue;
      const subtype = text(get(annot, 'Subtype'), lookup) ?? '';
      if (subtype === 'FileAttachment') {
        const file = embedded(dict(get(annot, 'FS'), lookup), lookup);
        if (file && files.length < MAX_FILES) files.push(file);
      } else if (ACTIVE_ANNOTS.has(subtype)) {
        findings.push({ kind: 'active-content', confidence: 'probable', location: where, label: 'Rich media (Flash, 3D, video)', value: subtype });
      }
      const a = get(annot, 'A');
      if (a) follow(a, 'by-type', where, where);
      triggers(annot, where, where);
    }
  }

  // Form fields carry their own triggers: keystroke, format, validate, calculate.
  const form = dict(get(catalog, 'AcroForm'), lookup);
  const fields = lookup(get(form, 'Fields'));
  const queue = fields instanceof PDFArray ? [...fields.asArray()] : [];
  const seen = new Set<unknown>();
  while (queue.length && seen.size < 5000) {
    const field = dict(queue.shift(), lookup);
    if (!field || seen.has(field)) continue;
    seen.add(field);
    const name = text(get(field, 'T'), lookup) ?? '';
    triggers(field, '/AcroForm', `/T ${name}`);
    const a = get(field, 'A');
    if (a) follow(a, 'by-type', '/AcroForm', `/T ${name}`);
    const kids = lookup(get(field, 'Kids'));
    if (kids instanceof PDFArray) queue.push(...kids.asArray());
  }
  if (get(form, 'XFA')) {
    findings.push({ kind: 'active-content', confidence: 'probable', location: '/AcroForm /XFA', label: 'XFA form', value: 'XFA' });
  }

  for (const file of files) {
    findings.push({
      kind: 'active-content',
      confidence: 'probable',
      location: '/EmbeddedFiles',
      label: 'Embedded file',
      value: `${file.name} — ${file.data.length} bytes${file.mime ? `, ${file.mime}` : ''}`,
    });
    findings.push(...fileNameFindings(file.name, '/EmbeddedFiles'));
  }
  findings.push(...linkFindings(uris, 'links'));
  for (const uri of uris) {
    const tracked = trackingFinding(uri, 'links');
    if (tracked) findings.push(tracked);
  }
  if (uris.size) {
    const list = [...uris];
    findings.push({
      kind: 'active-content',
      confidence: 'informational',
      location: 'links',
      label: 'Web addresses linked',
      value: `${list.length} — ${preview(list.join(', '), 400)}`,
    });
  }
  return { findings, files };
}

const LABEL: Record<string, string> = {
  JavaScript: 'JavaScript in the document',
  Launch: 'Launches a program or a file',
  SubmitForm: 'Sends form data to an address',
  ImportData: 'Imports data from a file',
  GoToR: 'Opens another document',
  GoToE: 'Opens another document',
  RichMediaExecute: 'Rich media (Flash, 3D, video)',
  Rendition: 'Rich media (Flash, 3D, video)',
  Movie: 'Rich media (Flash, 3D, video)',
  Sound: 'Rich media (Flash, 3D, video)',
};

/** Each embedded file inspected, its findings located under it. */
export async function embeddedFindings(files: EmbeddedFile[], inspect: ((data: Uint8Array, name: string) => Promise<InspectResult>) | undefined): Promise<Finding[]> {
  if (!inspect) return [];
  const out: Finding[] = [];
  for (const file of files) {
    if (!file.data.length) continue;
    try {
      const inner = await inspect(file.data, file.name);
      out.push(...inner.findings.map((f) => ({ ...f, location: `attachment ${file.name} → ${f.location}` })));
    } catch {
      // Not a format any parser claims: listed above, not read.
    }
  }
  return out;
}

/**
 * Take every active element out, in place. Plain web links stay: where a
 * link points is part of what the document says. Returns how many elements
 * went. Objects nothing points to any more are dropped too — a script left
 * as an orphan object would still be in the file's bytes.
 */
export function stripActive(doc: PDFDocument): number {
  const lookup: Lookup = (value) => (value instanceof PDFRef ? doc.context.lookup(value) : value);
  let removed = 0;
  const drop = (owner: PDFDict | undefined, key: string) => {
    if (owner?.has(PDFName.of(key))) {
      owner.delete(PDFName.of(key));
      removed++;
    }
  };
  const isActive = (value: unknown) => chain(value, lookup).some((action) => ACTIVE.has(text(get(action, 'S'), lookup) ?? ''));

  const catalog: PDFDict | undefined = doc.catalog instanceof PDFDict ? doc.catalog : undefined;
  const open = lookup(get(catalog, 'OpenAction'));
  if (open instanceof PDFDict) drop(catalog, 'OpenAction');
  drop(catalog, 'AA');
  const names = dict(get(catalog, 'Names'), lookup);
  drop(names, 'JavaScript');
  drop(names, 'EmbeddedFiles');

  for (const page of pages(doc)) {
    drop(page, 'AA');
    const annots = lookup(get(page, 'Annots'));
    if (!(annots instanceof PDFArray)) continue;
    const keep = annots.asArray().filter((item) => {
      const annot = dict(item, lookup);
      if (!annot) return true;
      if (ACTIVE_ANNOTS.has(text(get(annot, 'Subtype'), lookup) ?? '')) {
        removed++;
        return false;
      }
      drop(annot, 'AA');
      if (isActive(get(annot, 'A'))) drop(annot, 'A');
      return true;
    });
    page.set(PDFName.of('Annots'), doc.context.obj(keep));
  }

  const form = dict(get(catalog, 'AcroForm'), lookup);
  drop(form, 'XFA');
  const fields = lookup(get(form, 'Fields'));
  const queue = fields instanceof PDFArray ? [...fields.asArray()] : [];
  const seen = new Set<unknown>();
  while (queue.length && seen.size < 5000) {
    const field = dict(queue.shift(), lookup);
    if (!field || seen.has(field)) continue;
    seen.add(field);
    drop(field, 'AA');
    if (isActive(get(field, 'A'))) drop(field, 'A');
    const kids = lookup(get(field, 'Kids'));
    if (kids instanceof PDFArray) queue.push(...kids.asArray());
  }

  if (removed) pruneUnreachable(doc);
  return removed;
}

/** Delete every indirect object the trailer no longer leads to. */
export function pruneUnreachable(doc: PDFDocument): void {
  const reachable = new Set<string>();
  const queue: unknown[] = [doc.context.trailerInfo.Root, doc.context.trailerInfo.Info];
  let steps = 0;
  while (queue.length && steps++ < 500_000) {
    const item = queue.pop();
    if (item instanceof PDFRef) {
      const key = item.toString();
      if (reachable.has(key)) continue;
      reachable.add(key);
      queue.push(doc.context.lookup(item));
    } else if (item instanceof PDFRawStream) {
      queue.push(...item.dict.values());
    } else if (item instanceof PDFDict) {
      queue.push(...item.values());
    } else if (item instanceof PDFArray) {
      queue.push(...item.asArray());
    }
  }
  if (steps >= 500_000) return; // too large to be sure: leave every object rather than guess
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) doc.context.delete(ref);
  }
}

/** [F-2.4] Tracking parameters out of every /URI action. Returns how many links changed. */
export function stripTrackingPdf(doc: PDFDocument): number {
  let changed = 0;
  const seen = new Set<unknown>();
  // Actions are often written inline, in an annotation inline in /Annots:
  // every container is walked, direct objects included, each once.
  const visit = (value: unknown, depth: number) => {
    if (depth > 32 || seen.has(value)) return;
    seen.add(value);
    if (value instanceof PDFArray) {
      for (const item of value.asArray()) visit(item, depth + 1);
    } else if (value instanceof PDFDict) {
      const uri = value.get(PDFName.of('URI'));
      if (value.get(PDFName.of('S'))?.toString() === '/URI' && (uri instanceof PDFString || uri instanceof PDFHexString)) {
        const cleaned = cleanUrl(uri.decodeText());
        if (cleaned !== undefined) {
          // As bytes in hex: a literal string would need its parentheses and
          // backslashes escaped, and a URI is ASCII, not text to re-encode.
          value.set(PDFName.of('URI'), PDFHexString.of([...cleaned].map((c) => (c.charCodeAt(0) & 0xff).toString(16).padStart(2, '0')).join('')));
          changed++;
        }
      }
      for (const item of value.values()) if (!(item instanceof PDFRef)) visit(item, depth + 1);
    }
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) visit(object, 0);
  return changed;
}

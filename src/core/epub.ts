/**
 * [F-P2 2.2] EPUB: a ZIP whose `mimetype` says so.
 *
 * The package document (the OPF, found through META-INF/container.xml) holds
 * Dublin Core: the creator, contributors — calibre and Sigil name themselves
 * as the "book producer" —, the publisher, dates, and an identifier that is
 * often a UUID minted on the author's machine and kept through every edition.
 * The NCX repeats the author and the identifier. Each page is XHTML and goes
 * through the HTML pass; each picture through the picture pass. calibre
 * leaves the reader's position in META-INF/calibre_bookmarks.txt, Apple a
 * purchase record in iTunesMetadata.plist.
 *
 * Cleaning keeps what a reader needs — the title, the language, an ISBN —,
 * removes the rest, replaces the unique identifier by one derived from the
 * cleaned content (the same book cleaned twice gets the same one, and it says
 * nothing about the original), dates the required dcterms:modified
 * 1980-01-01 like the ZIP members, and repacks with the mimetype first and
 * stored. A book under DRM is reported and refused: its pages cannot be read,
 * so they cannot be cleaned.
 */

import { strFromU8, strToU8, zipSync } from 'fflate';
import { dtdFindings } from './xml.js';
import type { Finding, InspectOptions, InspectResult, Note, RedactResult } from './types.js';
import { byConfidence, preview } from './types.js';
import { inspectMarkup, redactMarkupCounted } from './markup.js';
import { inspectImage, stripImageMetadata, detectImageKind } from './image.js';
import { stripTracking } from './tracking.js';
import { fingerprint } from './fingerprint.js';
import { unzipGuarded, ZIP_EPOCH } from './zip.js';
import { UnsupportedFormatError } from './errors.js';
import { ARCHIVE_SEPARATOR } from './archive.js';
import { replaceSpans } from './linear.js';

type Parts = Record<string, Uint8Array>;

export const isEpub = (parts: Parts) => Boolean(parts['mimetype'] && strFromU8(parts['mimetype']).trim() === 'application/epub+zip');

/** dcterms:modified once cleaned: required by EPUB 3, dated like every repacked member. */
export const EPUB_EPOCH = '1980-01-01T00:00:00Z';

const MODIFIED = /\sproperty\s*=\s*"dcterms:modified"/;

const decode = (text: string) =>
  replaceSpans(text, '<![CDATA[', ']]>', (span) => span.slice(9, -3))
    .replace(/<[^<>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .trim();

const attr = (attrs: string, name: string) => new RegExp(`\\s${name.replace(':', '\\:')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs)?.slice(1).find((v) => v !== undefined);

function opfPath(parts: Parts): string | undefined {
  const container = parts['META-INF/container.xml'];
  const declared = container && /<rootfile\b[^<>]*\sfull-path\s*=\s*"([^"]+)"/.exec(strFromU8(container))?.[1];
  if (declared && parts[declared]) return declared;
  return Object.keys(parts).find((p) => /\.opf$/i.test(p));
}

const isPage = (path: string) => /\.(?:x?html?)$/i.test(path);
const isSvg = (path: string) => /\.svg$/i.test(path);

/** Members that say nothing about the book's content, and so are left out of its identifier. */
const isPackaging = (path: string, opf: string | undefined) => path === 'mimetype' || path.startsWith('META-INF/') || path === opf || /\.ncx$/i.test(path) || path === 'iTunesMetadata.plist';

/** A UUID (RFC 9562 version 8) from the content: the same pages, the same identifier. */
async function contentUuid(parts: Parts, opf: string | undefined): Promise<string> {
  const chunks: Uint8Array[] = [];
  for (const path of Object.keys(parts).filter((p) => !isPackaging(p, opf)).sort()) chunks.push(strToU8(`${path}\0`), parts[path]!, strToU8('\0'));
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', all)).slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x80;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Encryption that is not font obfuscation: the pages cannot be read without a key. */
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);

function encrypted(parts: Parts): string[] {
  const out: string[] = [];
  const xml = parts['META-INF/encryption.xml'];
  if (xml) {
    for (const block of strFromU8(xml).matchAll(/<(?:\w+:)?EncryptedData\b(?:(?!<(?:\w+:)?EncryptedData\b)[\s\S])*?<\/(?:\w+:)?EncryptedData>/g)) {
      const algorithm = /Algorithm\s*=\s*"([^"]*)"/.exec(block[0])?.[1] ?? '';
      const uri = /<(?:\w+:)?CipherReference\b[^<>]*\sURI\s*=\s*"([^"]*)"/.exec(block[0])?.[1];
      if (!FONT_OBFUSCATION.has(algorithm) && uri) out.push(decodeURIComponent(uri));
    }
  }
  if (parts['META-INF/rights.xml']) out.push('META-INF/rights.xml');
  return out;
}

interface DcElement {
  name: string;
  attrs: string;
  value: string;
  id?: string;
}

const DC = /<dc:(creator|contributor|publisher|identifier|date|title)\b([^<>]*)>((?:(?!<dc:\1\b)[\s\S])*?)<\/dc:\1>/g;

function dcElements(opf: string): DcElement[] {
  return [...opf.matchAll(DC)].map((m) => ({ name: m[1]!, attrs: m[2]!, value: decode(m[3]!), id: attr(m[2]!, 'id') }));
}

/** The relator code of a creator or contributor, from its attribute (EPUB 2) or a refining meta (EPUB 3). */
function role(opf: string, element: DcElement): string | undefined {
  const own = attr(element.attrs, 'opf:role');
  if (own) return own;
  if (!element.id) return undefined;
  // [P0-1] Each <meta>, then its attributes: two in one pattern backtracked across a long tag.
  const refine = [...opf.matchAll(/<meta\b([^<>]*)>([^<]*)<\/meta>/g)].find((m) => attr(m[1]!, 'refines') === `#${element.id}` && attr(m[1]!, 'property') === 'role');
  return refine?.[2]?.trim();
}

function opfFindings(opf: string, path: string, derived: string): Finding[] {
  const out: Finding[] = [];
  const unique = /<package\b[^<>]*\sunique-identifier\s*=\s*"([^"]*)"/.exec(opf)?.[1];
  for (const element of dcElements(opf)) {
    if (!element.value) continue;
    const location = `${path}:dc:${element.name}`;
    const push = (label: string, kind: Finding['kind'], confidence: Finding['confidence'], value = element.value) => out.push({ kind, confidence, location, label, value });
    switch (element.name) {
      case 'creator':
        push('Author', 'identity', 'confirmed');
        break;
      case 'contributor':
        if (role(opf, element) === 'bkp') push('Producing application', 'provenance', 'informational');
        else push('Contributor', 'identity', 'confirmed');
        break;
      case 'publisher':
        push('Publisher', 'identity', 'probable');
        break;
      case 'identifier':
        if (element.id === unique && element.value === derived) break;
        push('Book identifier', 'environment', 'probable');
        break;
      case 'date':
        push('Created', 'timestamp', 'probable');
        break;
      case 'title':
        push('Title', 'identity', 'informational');
        break;
    }
  }
  // [P0-1] Each <meta>, then its property: both in one pattern backtracked across a long tag.
  const modified = [...opf.matchAll(/<meta\b([^<>]*)>([^<]*)<\/meta>/g)].find((m) => MODIFIED.test(m[1]!))?.[2]?.trim();
  if (modified && modified !== EPUB_EPOCH) out.push({ kind: 'timestamp', confidence: 'probable', location: `${path}:dcterms:modified`, label: 'Modified', value: modified });
  for (const m of opf.matchAll(/<meta\b([^<>]*)\/?>/g)) {
    const name = attr(m[1]!, 'name');
    const content = attr(m[1]!, 'content');
    if (!name || !content) continue;
    if (/^calibre:/.test(name)) out.push({ kind: 'environment', confidence: 'probable', location: `${path}:meta:${name}`, label: 'Calibre metadata', value: preview(`${name}: ${content}`, 160) });
    else if (/^(?:generator|Sigil version)$/i.test(name)) out.push({ kind: 'provenance', confidence: 'informational', location: `${path}:meta:${name}`, label: 'Producing application', value: content });
  }
  return out;
}

const prefixed = (findings: Finding[], path: string): Finding[] => findings.map((f) => ({ ...f, location: `${path}${ARCHIVE_SEPARATOR}${f.location}` }));

export async function inspectEpub(data: Uint8Array, _options: InspectOptions = {}): Promise<InspectResult> {
  const parts = unzipGuarded(data);
  const opf = opfPath(parts);
  const findings: Finding[] = [];
  const notes: Note[] = [{ code: 'scope:epub' }];

  if (opf) findings.push(...opfFindings(strFromU8(parts[opf]!), opf, await contentUuid(parts, opf)));
  for (const [path, raw] of Object.entries(parts)) {
    if (/\.ncx$/i.test(path)) {
      const author = /<docAuthor\b[^<>]*>((?:(?!<docAuthor\b)[\s\S])*?)<\/docAuthor>/.exec(strFromU8(raw))?.[1];
      if (author && decode(author)) findings.push({ kind: 'identity', confidence: 'confirmed', location: `${path}:docAuthor`, label: 'Author', value: decode(author) });
    }
  }
  if (parts['META-INF/calibre_bookmarks.txt']) {
    findings.push({ kind: 'environment', confidence: 'probable', location: 'META-INF/calibre_bookmarks.txt', label: 'Reading position saved by calibre', value: `${parts['META-INF/calibre_bookmarks.txt'].length} bytes` });
  }
  if (parts['iTunesMetadata.plist']) {
    findings.push({ kind: 'identity', confidence: 'confirmed', location: 'iTunesMetadata.plist', label: 'Purchase record (Apple Books)', value: `${parts['iTunesMetadata.plist'].length} bytes` });
  }
  const locked = encrypted(parts);
  if (locked.length) findings.push({ kind: 'environment', confidence: 'confirmed', location: 'META-INF/encryption.xml', label: 'Encrypted content (DRM)', value: preview(locked.join(', '), 200) });
  const unreadable = new Set(locked);

  for (const [path, raw] of Object.entries(parts)) {
    if (unreadable.has(path)) continue;
    if (isPage(path) || isSvg(path)) findings.push(...prefixed(inspectMarkup(strFromU8(raw), isSvg(path) ? 'svg' : 'html'), path));
    else if (detectImageKind(raw)) findings.push(...inspectImage(raw, path));
  }

  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.label}\0${f.location}\0${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { format: 'epub', findings: [...unique, ...fingerprint(unique), ...dtdFindings(parts)].sort(byConfidence), notes };
}

export interface RedactEpubOptions {
  removeHidden?: boolean;
  stripTracking?: boolean;
}

/** Remove a DC element, and the metas that refine it. */
function cleanOpf(opf: string, uid: string): string {
  const unique = /<package\b[^<>]*\sunique-identifier\s*=\s*"([^"]*)"/.exec(opf)?.[1];
  const removedIds: string[] = [];
  let out = opf.replace(DC, (full, name: string, attrs: string) => {
    const id = attr(attrs, 'id');
    if (name === 'title') return full;
    if (name === 'identifier') {
      if (id && id === unique) return `<dc:identifier${attrs}>${uid}</dc:identifier>`;
      const scheme = attr(attrs, 'opf:scheme') ?? '';
      const value = decode(full);
      // An ISBN names the edition and stays; a UUID or calibre's id names a copy.
      if (!/^(?:uuid|calibre)$/i.test(scheme) && !/^urn:uuid:/i.test(value) && !/^calibre:/i.test(value)) return full;
    }
    if (id) removedIds.push(id);
    return '';
  });
  // [P0-1] Each <meta> once, its target looked up: a pattern per id, with the id between two runs, backtracked across a long tag.
  const refined = new Set([...removedIds].map((id) => `#${id}`));
  out = out.replace(/<meta\b([^<>]*?)(?:\/>|>[^<]*<\/meta>)/g, (full, attrs: string) => (refined.has(attr(attrs, 'refines') ?? '') ? '' : full));
  let dated = false;
  out = out.replace(/(<meta\b([^<>]*)>)[^<]*(<\/meta>)/g, (full, open: string, attrs: string, close: string) => {
    if (dated || !MODIFIED.test(attrs)) return full;
    dated = true;
    return `${open}${EPUB_EPOCH}${close}`;
  });
  out = out.replace(/<meta\b([^<>]*?)(?:\/>|>\s*<\/meta>)/gi, (full, attrs: string) => (/\sname\s*=\s*"(?:calibre:[^"]*|generator|Sigil version)"/i.test(attrs) ? '' : full));
  // The lines the removed elements stood on.
  return out.replace(/\n[ \t]*(?=\n)/g, '');
}

export async function redactEpub(data: Uint8Array, options: RedactEpubOptions = {}): Promise<RedactResult> {
  const parts = unzipGuarded(data);
  const locked = encrypted(parts);
  if (locked.length) {
    throw new UnsupportedFormatError(
      `This book is encrypted (DRM): ${locked.slice(0, 5).join(', ')}. Its pages cannot be read without the key, so it is not rewritten.`,
      'epub-encrypted',
      locked.slice(0, 5).join(', '),
    );
  }
  const before = (await inspectEpub(data)).findings;
  const notes: Note[] = [{ code: 'scope:epub' }];
  const opf = opfPath(parts);
  let hidden = 0;
  let tracking = 0;

  delete parts['META-INF/calibre_bookmarks.txt'];
  delete parts['iTunesMetadata.plist'];
  for (const [path, raw] of Object.entries(parts)) {
    if (isPage(path) || isSvg(path)) {
      const counted = redactMarkupCounted(strFromU8(raw), isSvg(path) ? 'svg' : 'html', { removeHidden: options.removeHidden });
      hidden += counted.hiddenRemoved;
      const stripped = options.stripTracking ? stripTracking(counted.text) : { text: counted.text, removed: 0 };
      tracking += stripped.removed;
      parts[path] = strToU8(stripped.text);
    } else if (detectImageKind(raw)) {
      parts[path] = stripImageMetadata(raw) ?? raw;
    }
  }

  const uid = await contentUuid(parts, opf);
  if (opf) parts[opf] = strToU8(cleanOpf(strFromU8(parts[opf]!), uid));
  for (const path of Object.keys(parts).filter((p) => /\.ncx$/i.test(p))) {
    parts[path] = strToU8(
      strFromU8(parts[path]!)
        .replace(/<docAuthor\b[^<>]*>(?:(?!<docAuthor\b)[\s\S])*?<\/docAuthor>/g, '')
        .replace(/<meta\b[^<>]*/g, (tag) => (/\sname\s*=\s*"dtb:uid"/.test(tag) ? tag.replace(/(\scontent\s*=\s*")[^"]*(")/, `$1${uid}$2`) : tag)),
    );
  }
  if (hidden) notes.push({ code: 'removed:hidden-text', detail: String(hidden) });
  if (tracking) notes.push({ code: 'removed:tracking-params', detail: String(tracking) });

  // The mimetype first and stored, as OCF requires; the rest in its order.
  const ordered: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { mimetype: [parts['mimetype']!, { level: 0 }] };
  for (const [path, raw] of Object.entries(parts)) if (path !== 'mimetype') ordered[path] = raw;
  return { format: 'epub', data: zipSync(ordered, { level: 6, mtime: ZIP_EPOCH }), removed: before, notes };
}

/**
 * [F-P3 2.2] TAR and gzip, inspected only.
 *
 * A TAR keeps, for every member, who owned it and when it last changed: the
 * account name and number, the group, the date. pax records add what the
 * archiving system knew besides — on macOS, through bsdtar, the extended
 * attributes: com.apple.quarantine (the program a file was downloaded with)
 * and kMDItemWhereFroms (the address it came from); on Linux, the
 * user.xdg.origin.url a browser sets. AppleDouble members
 * ("._name") carry the same attributes for tools that do not write pax. A
 * link can point anywhere on the machine that made it.
 *
 * A gzip header keeps the original file name and its date, and the system
 * that compressed it. What it compresses is read as a member: a TAR in turn,
 * or a document.
 *
 * Neither is rewritten. Rebuilding a TAR means choosing owners, dates and
 * modes for every member, and Cirta would rather refuse than decide those
 * for the user. Extract, clean the files, archive them again — or as a ZIP,
 * which Cirta cleans.
 */

import { Gunzip } from 'fflate';
import type { Finding } from './types.js';
import { preview } from './types.js';
import { ARCHIVE_LIMITS } from './archive.js';
import { ArchiveTooLargeError, ZIP_LIMITS } from './zip.js';

const LATIN1 = new TextDecoder('latin1');
const UTF8 = new TextDecoder();

export interface TarMember {
  path: string;
  type: string;
  uid: number;
  gid: number;
  uname: string;
  gname: string;
  mtime: number;
  link: string;
  pax: Record<string, string>;
  data: Uint8Array;
}

/** A numeric field: octal text, or base-256 when its first byte has the high bit set. */
function number(block: Uint8Array, at: number, length: number): number {
  if (block[at]! & 0x80) {
    let value = block[at]! & 0x7f;
    for (let i = 1; i < length; i++) value = value * 256 + block[at + i]!;
    return value;
  }
  const text = LATIN1.decode(block.subarray(at, at + length)).replace(/[\0 ]+.*$/s, '').trim();
  return text ? parseInt(text, 8) || 0 : 0;
}

const text = (block: Uint8Array, at: number, length: number) => {
  const raw = block.subarray(at, at + length);
  const end = raw.indexOf(0);
  return UTF8.decode(end >= 0 ? raw.subarray(0, end) : raw);
};

function checksumOk(block: Uint8Array): boolean {
  const stored = number(block, 148, 8);
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < 512; i++) {
    const byte = i >= 148 && i < 156 ? 0x20 : block[i]!;
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  return stored === unsigned || stored === signed;
}

export function isTar(data: Uint8Array): boolean {
  if (data.length < 512) return false;
  const block = data.subarray(0, 512);
  if (block.every((b) => b === 0)) return false;
  const magic = LATIN1.decode(block.subarray(257, 262));
  // ustar, or an old V7 header: either way the checksum has to hold.
  return checksumOk(block) && (magic === 'ustar' || /^[\x20-\x7e]/.test(LATIN1.decode(block.subarray(0, 1))));
}

/** The records of a pax header: "<length> <key>=<value>\n". */
function paxRecords(data: Uint8Array): Record<string, string> {
  const records: Record<string, string> = {};
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space < 0) break;
    const length = parseInt(LATIN1.decode(data.subarray(at, space)), 10);
    if (!(length > 0) || at + length > data.length) break;
    const record = UTF8.decode(data.subarray(space + 1, at + length - 1));
    const equals = record.indexOf('=');
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
    at += length;
  }
  return records;
}

/** Every member of a TAR, pax and GNU long names applied. Stops, rather than guesses, at a header that does not check out. */
export function readTar(data: Uint8Array): TarMember[] {
  const members: TarMember[] = [];
  let global: Record<string, string> = {};
  let local: Record<string, string> = {};
  let longName: string | undefined;
  let longLink: string | undefined;
  let total = 0;
  let at = 0;
  while (at + 512 <= data.length) {
    const block = data.subarray(at, at + 512);
    if (block.every((b) => b === 0)) break;
    if (!checksumOk(block)) break;
    const size = number(block, 124, 12);
    const type = LATIN1.decode(block.subarray(156, 157)) || '0';
    const body = data.subarray(at + 512, Math.min(at + 512 + size, data.length));
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      local = paxRecords(body);
      continue;
    }
    if (type === 'g') {
      global = { ...global, ...paxRecords(body) };
      continue;
    }
    if (type === 'L' || type === 'K') {
      const value = text(body, 0, body.length);
      if (type === 'L') longName = value;
      else longLink = value;
      continue;
    }
    const pax = { ...global, ...local };
    // POSIX ustar ("ustar\0" "00") has a name prefix there; GNU's format ("ustar ") keeps other fields in those bytes.
    const prefix = LATIN1.decode(block.subarray(257, 263)) === 'ustar\0' ? text(block, 345, 155) : '';
    const name = text(block, 0, 100);
    const path = pax.path ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    total += body.length;
    if (members.length >= ARCHIVE_LIMITS.maxMembers || total > ARCHIVE_LIMITS.maxTotalBytes) {
      throw new ArchiveTooLargeError(`archive holds more than ${ARCHIVE_LIMITS.maxMembers} members or ${ARCHIVE_LIMITS.maxTotalBytes} bytes`, members.length >= ARCHIVE_LIMITS.maxMembers ? `members:${ARCHIVE_LIMITS.maxMembers}` : `bytes:${Math.round(ARCHIVE_LIMITS.maxTotalBytes / 1048576)}`);
    }
    members.push({
      path,
      type,
      uid: pax.uid !== undefined ? Number(pax.uid) : number(block, 108, 8),
      gid: pax.gid !== undefined ? Number(pax.gid) : number(block, 116, 8),
      uname: pax.uname ?? text(block, 265, 32),
      gname: pax.gname ?? text(block, 297, 32),
      mtime: pax.mtime !== undefined ? Math.floor(Number(pax.mtime)) : number(block, 136, 12),
      link: pax.linkpath ?? longLink ?? text(block, 157, 100),
      pax,
      data: body,
    });
    local = {};
    longName = undefined;
    longLink = undefined;
  }
  return members;
}

const isoSeconds = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.000Z$/, 'Z');
const URLS = /https?:\/\/[^\s\x00-\x1f"'<>\\]+/g;
const COMMON_GROUPS = new Set(['', 'root', 'wheel', 'staff', 'users', 'admin', 'everyone']);

/** An xattr's value: as written for SCHILY, base64 for LIBARCHIVE. */
function xattrs(pax: Record<string, string>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(pax)) {
    if (key.startsWith('SCHILY.xattr.')) out.push([key.slice('SCHILY.xattr.'.length), value]);
    else if (key.startsWith('LIBARCHIVE.xattr.')) {
      let decoded = value;
      try {
        decoded = LATIN1.decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
      } catch {
        // Kept as written.
      }
      out.push([decodeURIComponent(key.slice('LIBARCHIVE.xattr.'.length)), decoded]);
    }
  }
  return out;
}

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path;

/** What the headers of a TAR say, beside its members' content. */
export function tarFindings(members: TarMember[]): Finding[] {
  const found: Finding[] = [];
  const owners = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const m of members) {
    if (m.uname || m.uid) owners.set(`${m.uname}\0${m.uid}`, m.uname ? `${m.uname} (uid ${m.uid})` : `uid ${m.uid}`);
    if (!COMMON_GROUPS.has(m.gname)) groups.set(`${m.gname}\0${m.gid}`, `${m.gname} (gid ${m.gid})`);
  }
  for (const [key, value] of owners) {
    found.push({ kind: 'identity', confidence: key.startsWith('\0') ? 'probable' : 'confirmed', location: 'TAR headers (uname)', label: 'Owner account', value });
  }
  for (const value of groups.values()) found.push({ kind: 'identity', confidence: 'probable', location: 'TAR headers (gname)', label: 'Owner group', value });

  const dates = members.map((m) => m.mtime).filter((t) => t > 0 && t < 7258118400);
  if (dates.length) {
    const first = Math.min(...dates);
    const last = Math.max(...dates);
    found.push({ kind: 'timestamp', confidence: 'probable', location: 'TAR headers (mtime)', label: 'Member dates', value: first === last ? isoSeconds(first) : `${isoSeconds(first)} – ${isoSeconds(last)}` });
  }

  const urls = new Set<string>();
  const quarantine = new Set<string>();
  const others = new Set<string>();
  for (const m of members) {
    for (const [name, value] of xattrs(m.pax)) {
      if (name === 'com.apple.quarantine') {
        const [flags, time, agent] = value.split(';');
        quarantine.add(`${agent || '?'}, ${flags};${time}`);
      } else if (/kMDItemWhereFroms|^user\.xdg\.(?:origin|referrer)\.url$/.test(name)) for (const url of value.match(URLS) ?? []) urls.add(url);
      else others.add(name);
    }
    if (m.pax.comment) found.push({ kind: 'identity', confidence: 'probable', location: `TAR headers (pax comment)`, label: 'Comment', value: preview(m.pax.comment, 120) });
    // AppleDouble: the attributes of "name", for tools that do not write pax.
    if (baseName(m.path).startsWith('._')) for (const url of LATIN1.decode(m.data).match(URLS) ?? []) urls.add(url);
    if ((m.type === '1' || m.type === '2') && m.link) {
      if (/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(m.link)) found.push({ kind: 'environment', confidence: 'probable', location: 'TAR headers (link)', label: 'Link to an absolute path', value: preview(`${m.path} → ${m.link}`, 160) });
      else if (m.link.split('/').reduce((depth, part) => (depth < 0 ? depth : part === '..' ? depth - 1 : part && part !== '.' ? depth + 1 : depth), m.path.split('/').length - 1) < 0) {
        found.push({ kind: 'deceptive-name', confidence: 'confirmed', location: 'TAR headers (link)', label: 'Link out of the archive', value: preview(`${m.path} → ${m.link}`, 160) });
      }
    }
  }
  for (const value of quarantine) found.push({ kind: 'environment', confidence: 'probable', location: 'TAR headers (pax xattr)', label: 'Quarantine attribute (macOS)', value: preview(value, 120) });
  for (const url of urls) found.push({ kind: 'environment', confidence: 'confirmed', location: 'TAR headers (pax xattr)', label: 'Download address', value: preview(url, 160) });
  if (others.size) found.push({ kind: 'environment', confidence: 'informational', location: 'TAR headers (pax xattr)', label: 'Extended attributes', value: preview([...others].sort().join(', '), 160) });
  return found;
}

/** The members whose content is read: regular files, AppleDouble files aside. */
export const contentMembers = (members: TarMember[]) =>
  members.filter((m) => (m.type === '0' || m.type === '7' || m.type === '\0') && m.data.length > 0 && !baseName(m.path).startsWith('._'));

/* ----------------------------------------------------------------- gzip -- */

export const isGzip = (data: Uint8Array) => data.length >= 18 && data[0] === 0x1f && data[1] === 0x8b && data[2] === 8;

const OPERATING_SYSTEMS: Record<number, string> = { 0: 'FAT (MS-DOS, Windows)', 3: 'Unix', 7: 'Macintosh', 10: 'TOPS-20', 11: 'NTFS (Windows)', 13: 'Acorn RISC OS', 255: '' };

export interface GzipHeader {
  name?: string;
  comment?: string;
  mtime: number;
  os: number;
}

export function gzipHeader(data: Uint8Array): GzipHeader {
  const flags = data[3]!;
  const mtime = data[4]! | (data[5]! << 8) | (data[6]! << 16) | (data[7]! << 24);
  let at = 10;
  if (flags & 4) at += 2 + (data[at]! | (data[at + 1]! << 8));
  const zstring = () => {
    const end = data.indexOf(0, at);
    if (end < 0) return undefined;
    const value = LATIN1.decode(data.subarray(at, end));
    at = end + 1;
    return value;
  };
  const name = flags & 8 ? zstring() : undefined;
  const comment = flags & 16 ? zstring() : undefined;
  return { name, comment, mtime: mtime >>> 0, os: data[9]! };
}

export function gzipFindings(header: GzipHeader): Finding[] {
  const found: Finding[] = [];
  const location = 'gzip header';
  if (header.name) found.push({ kind: 'environment', confidence: 'probable', location, label: 'Original file name', value: preview(header.name, 160) });
  if (header.mtime) found.push({ kind: 'timestamp', confidence: 'probable', location, label: 'Date modified', value: isoSeconds(header.mtime) });
  if (header.comment) found.push({ kind: 'identity', confidence: 'probable', location, label: 'Comment', value: preview(header.comment, 160) });
  const system = OPERATING_SYSTEMS[header.os];
  if (system) found.push({ kind: 'environment', confidence: 'informational', location, label: 'Operating system', value: system });
  return found;
}

/**
 * The content, inflated as a stream and refused past the archive's size
 * limit, or — like a ZIP member — past a thousand times its compressed size
 * once it is larger than 16 MB: a compression bomb, not a file.
 */
export function gunzipGuarded(data: Uint8Array, name: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Gunzip((chunk) => {
    total += chunk.length;
    if (total > ARCHIVE_LIMITS.maxTotalBytes) {
      throw new ArchiveTooLargeError(`gzip content larger than ${ARCHIVE_LIMITS.maxTotalBytes} bytes`, `bytes:${Math.round(ARCHIVE_LIMITS.maxTotalBytes / 1048576)}`);
    }
    if (total > ZIP_LIMITS.ratioFloorBytes && total > ZIP_LIMITS.maxRatio * data.length) {
      throw new ArchiveTooLargeError(`"${name}" inflates more than ${ZIP_LIMITS.maxRatio} times its size`, `ratio:${name}`);
    }
    chunks.push(chunk);
  });
  stream.push(data, true);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * The name the content goes by: the header's, else the archive's without .gz
 * (a .tgz holds a .tar), else what it is — a word that reads the same in
 * English and French.
 */
export function gzipContentName(header: GzipHeader, content: Uint8Array, hint?: string): string {
  if (header.name) return header.name;
  const base = (hint ?? '').split(/[\\/]/).pop() ?? '';
  if (/\.tgz$/i.test(base)) return base.replace(/\.tgz$/i, '.tar');
  if (/\.gz$/i.test(base) && base.length > 3) return base.replace(/\.gz$/i, '');
  return isTar(content) ? 'archive.tar' : 'archive';
}

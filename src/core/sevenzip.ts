/**
 * [F-P3 2.2] 7z, inspected only.
 *
 * A 7z ends with a header that lists its files — names, dates, attributes —
 * and the "folders" (compressed streams) their content is in. 7-Zip
 * compresses that header too, with LZMA, by default; and the content with
 * LZMA2. Both are decoded here (lzma.ts), every stream the archive gives a
 * CRC for is checked against it, and a mismatch is a refusal: a decoding
 * error must not become a misread file.
 *
 * Read: the names (each checked like any archive member's), the dates, and
 * the content of each file compressed with Copy, LZMA or LZMA2, inspected as
 * it would be on its own. Not read, and said so in a note: content behind
 * another coder (BCJ filters, BZip2, PPMd, Deflate) or encrypted (AES); an
 * encrypted header hides the names themselves.
 *
 * Never rewritten (archive-inspect-only), for the reasons tar.ts gives.
 */

import type { Finding } from './types.js';
import { ARCHIVE_LIMITS } from './archive.js';
import { ArchiveTooLargeError } from './zip.js';
import { decodeLzma, decodeLzma2, LzmaError } from './lzma.js';

const SIGNATURE = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];
export const is7z = (data: Uint8Array) => data.length >= 32 && SIGNATURE.every((b, i) => data[i] === b);

export class SevenZipError extends Error {}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Reads 7z's numbers and properties from a header. */
class Reader {
  constructor(
    private readonly data: Uint8Array,
    public at = 0,
  ) {}

  byte(): number {
    if (this.at >= this.data.length) throw new SevenZipError('header ends early');
    return this.data[this.at++]!;
  }

  bytes(n: number): Uint8Array {
    if (n < 0 || this.at + n > this.data.length) throw new SevenZipError('header ends early');
    const out = this.data.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }

  /** 7z's variable-length number: the first byte's leading ones say how many bytes follow. */
  number(): number {
    const first = this.byte();
    let mask = 0x80;
    let value = 0;
    for (let i = 0; i < 8; i++) {
      if ((first & mask) === 0) {
        const high = first & (mask - 1);
        return value + high * 2 ** (8 * i);
      }
      value += this.byte() * 2 ** (8 * i);
      mask >>= 1;
    }
    return value;
  }

  u32(): number {
    const b = this.bytes(4);
    return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
  }

  u64(): number {
    const low = this.u32();
    const high = this.u32();
    return high * 2 ** 32 + low;
  }

  bits(count: number): boolean[] {
    const out: boolean[] = [];
    let mask = 0;
    let byte = 0;
    for (let i = 0; i < count; i++) {
      if (mask === 0) {
        byte = this.byte();
        mask = 0x80;
      }
      out.push((byte & mask) !== 0);
      mask >>= 1;
    }
    return out;
  }

  /** "All defined" byte, else a bit vector. */
  defined(count: number): boolean[] {
    return this.byte() ? new Array<boolean>(count).fill(true) : this.bits(count);
  }
}

interface Coder {
  id: string;
  inStreams: number;
  outStreams: number;
  properties: Uint8Array;
}

interface Folder {
  coders: Coder[];
  bindPairs: Array<[number, number]>;
  packedStreams: number[];
  unpackSizes: number[];
  crc?: number;
}

interface StreamsInfo {
  packPos: number;
  packSizes: number[];
  folders: Folder[];
  /** Per folder, how many files it holds, and their sizes and CRCs in order. */
  substreams: Array<{ sizes: number[]; crcs: Array<number | undefined> }>;
}

const CODER_NAMES: Record<string, string> = {
  '00': 'Copy',
  '030101': 'LZMA',
  '21': 'LZMA2',
  '030401': 'PPMd',
  '03030103': 'BCJ (x86)',
  '0303011b': 'BCJ2',
  '03030501': 'ARM',
  '03030401': 'PowerPC',
  '03030805': 'SPARC',
  '0a': 'ARM64',
  '03': 'Delta',
  '040108': 'Deflate',
  '040109': 'Deflate64',
  '040202': 'BZip2',
  '06f10701': 'AES',
};

export const coderName = (id: string) => CODER_NAMES[id] ?? `coder ${id}`;

function readDigests(r: Reader, count: number): Array<number | undefined> {
  const defined = r.defined(count);
  return defined.map((d) => (d ? r.u32() : undefined));
}

function readFolder(r: Reader): Folder {
  const coders: Coder[] = [];
  const count = r.number();
  if (count < 1 || count > 64) throw new SevenZipError('bad coder count');
  for (let i = 0; i < count; i++) {
    const flags = r.byte();
    const id = [...r.bytes(flags & 0x0f)].map((b) => b.toString(16).padStart(2, '0')).join('');
    let inStreams = 1;
    let outStreams = 1;
    if (flags & 0x10) {
      inStreams = r.number();
      outStreams = r.number();
    }
    const properties = flags & 0x20 ? r.bytes(r.number()) : new Uint8Array(0);
    coders.push({ id, inStreams, outStreams, properties });
  }
  const totalOut = coders.reduce((n, c) => n + c.outStreams, 0);
  const totalIn = coders.reduce((n, c) => n + c.inStreams, 0);
  if (totalOut > 64 || totalIn > 64) throw new SevenZipError('bad stream count');
  const bindPairs: Array<[number, number]> = [];
  for (let i = 0; i < totalOut - 1; i++) bindPairs.push([r.number(), r.number()]);
  const packedCount = totalIn - bindPairs.length;
  const packedStreams: number[] = [];
  if (packedCount === 1) {
    for (let i = 0; i < totalIn; i++) if (!bindPairs.some(([input]) => input === i)) packedStreams.push(i);
  } else for (let i = 0; i < packedCount; i++) packedStreams.push(r.number());
  return { coders, bindPairs, packedStreams, unpackSizes: [] };
}

function readStreamsInfo(r: Reader): StreamsInfo {
  const info: StreamsInfo = { packPos: 0, packSizes: [], folders: [], substreams: [] };
  for (;;) {
    const id = r.number();
    if (id === 0x00) break;
    if (id === 0x06) {
      info.packPos = r.number();
      const count = r.number();
      for (;;) {
        const property = r.number();
        if (property === 0x00) break;
        if (property === 0x09) for (let i = 0; i < count; i++) info.packSizes.push(r.number());
        else if (property === 0x0a) readDigests(r, count);
        else throw new SevenZipError('unexpected property in pack info');
      }
    } else if (id === 0x07) {
      if (r.number() !== 0x0b) throw new SevenZipError('expected folders');
      const count = r.number();
      if (count > ARCHIVE_LIMITS.maxMembers) throw new SevenZipError('too many folders');
      if (r.byte() !== 0) throw new SevenZipError('external folders are not supported');
      for (let i = 0; i < count; i++) info.folders.push(readFolder(r));
      if (r.number() !== 0x0c) throw new SevenZipError('expected unpack sizes');
      for (const folder of info.folders) {
        const outs = folder.coders.reduce((n, c) => n + c.outStreams, 0);
        for (let i = 0; i < outs; i++) folder.unpackSizes.push(r.number());
      }
      for (;;) {
        const property = r.number();
        if (property === 0x00) break;
        if (property === 0x0a) readDigests(r, info.folders.length).forEach((crc, i) => (info.folders[i]!.crc = crc));
        else throw new SevenZipError('unexpected property in coders info');
      }
    } else if (id === 0x08) {
      const counts = info.folders.map(() => 1);
      let property = r.number();
      if (property === 0x0d) {
        for (let i = 0; i < counts.length; i++) counts[i] = r.number();
        property = r.number();
      }
      const sizes: number[][] = info.folders.map(() => []);
      if (property === 0x09) {
        info.folders.forEach((folder, i) => {
          let sum = 0;
          for (let k = 1; k < counts[i]!; k++) {
            const size = r.number();
            sizes[i]!.push(size);
            sum += size;
          }
          if (counts[i]! > 0) sizes[i]!.push(folderSize(folder) - sum);
        });
        property = r.number();
      } else {
        info.folders.forEach((folder, i) => {
          if (counts[i]! === 1) sizes[i]!.push(folderSize(folder));
        });
      }
      // CRCs: those of single-file folders come from the folder; the others are listed here.
      const crcs: Array<Array<number | undefined>> = info.folders.map((folder, i) => (counts[i] === 1 && folder.crc !== undefined ? [folder.crc] : new Array(counts[i]).fill(undefined)));
      while (property !== 0x00) {
        if (property === 0x0a) {
          const missing = info.folders.reduce((n, folder, i) => n + (counts[i] === 1 && folder.crc !== undefined ? 0 : counts[i]!), 0);
          const digests = readDigests(r, missing);
          let k = 0;
          info.folders.forEach((folder, i) => {
            if (counts[i] === 1 && folder.crc !== undefined) return;
            for (let j = 0; j < counts[i]!; j++) crcs[i]![j] = digests[k++];
          });
        } else throw new SevenZipError('unexpected property in substreams info');
        property = r.number();
      }
      info.substreams = info.folders.map((_, i) => ({ sizes: sizes[i]!, crcs: crcs[i]! }));
    } else throw new SevenZipError('unexpected property in streams info');
  }
  if (!info.substreams.length) info.substreams = info.folders.map((folder) => ({ sizes: [folderSize(folder)], crcs: [folder.crc] }));
  return info;
}

/** The size of what a folder unpacks to: the output of its last coder, the one nothing is bound to. */
function folderSize(folder: Folder): number {
  for (let i = folder.unpackSizes.length - 1; i >= 0; i--) if (!folder.bindPairs.some(([, out]) => out === i)) return folder.unpackSizes[i]!;
  return 0;
}

/** Why a folder is not decoded here, or undefined if it is. */
export function unreadable(folder: Folder): string | undefined {
  // AES first: an encrypted folder is unread for that reason, whatever else it uses.
  if (folder.coders.some((c) => c.id === '06f10701')) return 'AES';
  if (folder.coders.length !== 1 || folder.packedStreams.length !== 1) return folder.coders.map((c) => coderName(c.id)).join(' + ');
  const coder = folder.coders[0]!;
  return ['00', '030101', '21'].includes(coder.id) ? undefined : coderName(coder.id);
}

function decodeFolder(data: Uint8Array, start: number, info: StreamsInfo, index: number): Uint8Array {
  const folder = info.folders[index]!;
  let packStart = start;
  let packIndex = 0;
  for (let i = 0; i < index; i++) {
    for (let k = 0; k < info.folders[i]!.packedStreams.length; k++) packStart += info.packSizes[packIndex++] ?? 0;
  }
  const packed = data.subarray(packStart, packStart + (info.packSizes[packIndex] ?? 0));
  if (packed.length !== info.packSizes[packIndex]) throw new SevenZipError('packed stream past the end of the file');
  const size = folderSize(folder);
  if (size > ARCHIVE_LIMITS.maxTotalBytes) throw new ArchiveTooLargeError(`folder unpacks to more than ${ARCHIVE_LIMITS.maxTotalBytes} bytes`, `bytes:${Math.round(ARCHIVE_LIMITS.maxTotalBytes / 1048576)}`);
  const coder = folder.coders[0]!;
  let out: Uint8Array;
  try {
    if (coder.id === '00') out = packed.slice(0, size);
    else if (coder.id === '030101') out = decodeLzma(coder.properties, packed, size);
    else out = decodeLzma2(packed, size);
  } catch (error) {
    if (error instanceof LzmaError) throw new SevenZipError(`folder ${index}: ${error.message}`);
    throw error;
  }
  if (out.length !== size) throw new SevenZipError('folder shorter than its declared size');
  if (folder.crc !== undefined && crc32(out) !== folder.crc) throw new SevenZipError(`folder ${index}: CRC mismatch`);
  return out;
}

export interface SevenZipEntry {
  path: string;
  directory: boolean;
  mtime?: number;
  ctime?: number;
  /** A Unix mode, when 7-Zip kept one (in the attributes' high 16 bits). */
  mode?: number;
  data?: Uint8Array;
  /** Why the content was not read: the coders it is behind (AES for an encrypted one). */
  unread?: string;
}

export interface SevenZip {
  entries: SevenZipEntry[];
  headerEncrypted: boolean;
  comment?: string;
}

const FILETIME_EPOCH = 11644473600;
const filetime = (value: number) => value / 1e7 - FILETIME_EPOCH;

function readTimes(r: Reader, count: number): Array<number | undefined> {
  const defined = r.defined(count);
  if (r.byte() !== 0) throw new SevenZipError('external times are not supported');
  return defined.map((d) => (d ? filetime(r.u64()) : undefined));
}

export function read7z(data: Uint8Array): SevenZip {
  if (!is7z(data)) throw new SevenZipError('not a 7z archive');
  const start = new Reader(data, 8);
  const startCrc = start.u32();
  if (crc32(data.subarray(12, 32)) !== startCrc) throw new SevenZipError('start header CRC mismatch');
  const offset = start.u64();
  const size = start.u64();
  const crc = start.u32();
  if (32 + offset + size > data.length) throw new SevenZipError('header past the end of the file');
  let header = data.subarray(32 + offset, 32 + offset + size);
  if (crc32(header) !== crc) throw new SevenZipError('header CRC mismatch');
  if (!header.length) return { entries: [], headerEncrypted: false };

  // An encoded header: its own streams info, then the header itself, unpacked.
  let r = new Reader(header);
  let guard = 0;
  while (r.number() === 0x17) {
    if (++guard > 4) throw new SevenZipError('nested encoded headers');
    const info = readStreamsInfo(r);
    const folder = info.folders[0];
    if (!folder) throw new SevenZipError('encoded header without a folder');
    const why = unreadable(folder);
    if (why === 'AES') return { entries: [], headerEncrypted: true };
    if (why) throw new SevenZipError(`header compressed with ${why}`);
    header = decodeFolder(data, 32 + info.packPos, info, 0);
    r = new Reader(header);
  }
  r.at = 0;
  if (r.number() !== 0x01) throw new SevenZipError('expected a header');

  let streams: StreamsInfo = { packPos: 0, packSizes: [], folders: [], substreams: [] };
  let comment: string | undefined;
  const entries: SevenZipEntry[] = [];
  for (;;) {
    const id = r.number();
    if (id === 0x00) break;
    if (id === 0x02) {
      // Archive properties: type and size, skipped.
      for (let type = r.number(); type !== 0; type = r.number()) r.bytes(r.number());
    } else if (id === 0x03) readStreamsInfo(r);
    else if (id === 0x04) streams = readStreamsInfo(r);
    else if (id === 0x05) {
      const count = r.number();
      if (count > ARCHIVE_LIMITS.maxMembers) throw new ArchiveTooLargeError(`archive declares more than ${ARCHIVE_LIMITS.maxMembers} members`, `members:${ARCHIVE_LIMITS.maxMembers}`);
      let empty: boolean[] = new Array<boolean>(count).fill(false);
      let emptyFile: boolean[] = [];
      let names: string[] = [];
      let mtimes: Array<number | undefined> = [];
      let ctimes: Array<number | undefined> = [];
      let attributes: Array<number | undefined> = [];
      for (;;) {
        const property = r.number();
        if (property === 0x00) break;
        const length = r.number();
        const end = r.at + length;
        if (property === 0x0e) empty = r.bits(count);
        else if (property === 0x0f) emptyFile = r.bits(empty.filter(Boolean).length);
        else if (property === 0x11) {
          if (r.byte() !== 0) throw new SevenZipError('external names are not supported');
          const text = new TextDecoder('utf-16le').decode(r.bytes(end - r.at));
          names = text.split('\0').slice(0, count);
        } else if (property === 0x14) mtimes = readTimes(r, count);
        else if (property === 0x12) ctimes = readTimes(r, count);
        else if (property === 0x15) {
          const defined = r.defined(count);
          if (r.byte() !== 0) throw new SevenZipError('external attributes are not supported');
          attributes = defined.map((d) => (d ? r.u32() : undefined));
        }
        else if (property === 0x16 && length > 1) {
          if (r.byte() === 0) comment = new TextDecoder('utf-16le').decode(r.bytes(end - r.at)).replace(/\0+$/, '');
        }
        r.at = end;
      }
      let emptyIndex = 0;
      for (let i = 0; i < count; i++) {
        const isEmpty = empty[i] ?? false;
        const directory = isEmpty && !(emptyFile[emptyIndex] ?? false);
        if (isEmpty) emptyIndex++;
        const attribute = attributes[i];
        // FILE_ATTRIBUTE_UNIX_EXTENSION: the high 16 bits are a Unix mode.
        const mode = attribute !== undefined && attribute & 0x8000 ? attribute >>> 16 : undefined;
        entries.push({ path: names[i] ?? `file ${i + 1}`, directory, mtime: mtimes[i], ctime: ctimes[i], mode, data: isEmpty ? (directory ? undefined : new Uint8Array(0)) : undefined });
      }
    } else throw new SevenZipError(`unexpected property ${id} in header`);
  }

  // Hand each file with content its substream, folder by folder.
  const withContent = entries.filter((e) => !e.directory && e.data === undefined);
  let file = 0;
  let total = 0;
  streams.folders.forEach((folder, index) => {
    const sub = streams.substreams[index] ?? { sizes: [folderSize(folder)], crcs: [folder.crc] };
    const owners = withContent.slice(file, file + sub.sizes.length);
    file += sub.sizes.length;
    const why = unreadable(folder);
    if (why) {
      for (const owner of owners) owner.unread = why;
      return;
    }
    total += folderSize(folder);
    if (total > ARCHIVE_LIMITS.maxTotalBytes) throw new ArchiveTooLargeError(`archive unpacks to more than ${ARCHIVE_LIMITS.maxTotalBytes} bytes`, `bytes:${Math.round(ARCHIVE_LIMITS.maxTotalBytes / 1048576)}`);
    const unpacked = decodeFolder(data, 32 + streams.packPos, streams, index);
    let at = 0;
    owners.forEach((owner, k) => {
      const content = unpacked.subarray(at, at + sub.sizes[k]!);
      at += sub.sizes[k]!;
      const expected = sub.crcs[k];
      if (expected !== undefined && crc32(content) !== expected) throw new SevenZipError(`"${owner.path}": CRC mismatch`);
      owner.data = content;
    });
  });
  return { entries, headerEncrypted: false, comment };
}

const iso = (seconds: number) => new Date(Math.round(seconds) * 1000).toISOString().replace(/\.000Z$/, 'Z');

/** What a 7z says beside its members' content: the dates, a comment. */
export function sevenZipFindings(archive: SevenZip): Finding[] {
  const found: Finding[] = [];
  const dates = archive.entries.flatMap((e) => [e.mtime, e.ctime]).filter((t): t is number => t !== undefined && t > 0 && t < 7258118400);
  if (dates.length) {
    const first = Math.min(...dates);
    const last = Math.max(...dates);
    found.push({ kind: 'timestamp', confidence: 'probable', location: '7z header', label: 'Member dates', value: first === last ? iso(first) : `${iso(first)} – ${iso(last)}` });
  }
  if (archive.comment) found.push({ kind: 'identity', confidence: 'probable', location: '7z header', label: 'Comment', value: archive.comment.slice(0, 160) });
  // A symbolic link is stored as its target.
  for (const entry of archive.entries) {
    if (entry.mode === undefined || (entry.mode & 0xf000) !== 0xa000 || !entry.data) continue;
    const target = new TextDecoder().decode(entry.data);
    if (/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(target)) found.push({ kind: 'environment', confidence: 'probable', location: '7z header', label: 'Link to an absolute path', value: `${entry.path} → ${target}`.slice(0, 160) });
  }
  return found;
}

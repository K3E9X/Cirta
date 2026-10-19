/**
 * [F-P3 2.2] 7z archives built byte by byte: the signature header and its
 * CRCs, a main header with streams and files info, optionally encoded. The
 * content goes in one solid folder, stored (Copy) or as LZMA2 made of
 * uncompressed chunks — valid LZMA2 an encoder would not choose, which is
 * what can be written without one. The LZMA path is tested against xz-utils'
 * own output (test/sevenzip.test.ts) and against 7-Zip (scripts/real-files.mjs).
 */

import { crc32 } from '../../src/core/sevenzip.js';

const concat = (...parts: Array<Uint8Array | number[]>) => {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
};

/** 7z's variable-length number. */
export function number(n: number): number[] {
  for (let k = 0; k < 8; k++) {
    const low = n % 256 ** k;
    const high = Math.floor(n / 256 ** k);
    if (high < 2 ** (7 - k)) {
      const first = ((0xff << (8 - k)) & 0xff) | high;
      const bytes = [first];
      for (let i = 0; i < k; i++) bytes.push(Math.floor(low / 256 ** i) % 256);
      return bytes;
    }
  }
  const bytes = [0xff];
  for (let i = 0; i < 8; i++) bytes.push(Math.floor(n / 256 ** i) % 256);
  return bytes;
}
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u64 = (n: number) => [...u32(n % 2 ** 32), ...u32(Math.floor(n / 2 ** 32))];
const bitVector = (bits: boolean[]) => {
  const out: number[] = [];
  bits.forEach((bit, i) => {
    if (i % 8 === 0) out.push(0);
    if (bit) out[out.length - 1]! |= 0x80 >> i % 8;
  });
  return out;
};
const utf16 = (text: string) => {
  const out: number[] = [];
  for (const c of text) {
    const code = c.charCodeAt(0);
    out.push(code & 0xff, code >> 8);
  }
  return out;
};

/** LZMA2 holding `data` in uncompressed chunks of at most 64 KiB. */
export function lzma2Stored(data: Uint8Array): Uint8Array {
  const parts: Array<number[] | Uint8Array> = [];
  for (let at = 0, first = true; at < data.length || first; first = false) {
    const length = Math.min(65536, data.length - at);
    if (length === 0) break;
    parts.push([first ? 0x01 : 0x02, (length - 1) >> 8, (length - 1) & 0xff], data.subarray(at, at + length));
    at += length;
  }
  parts.push([0x00]);
  return concat(...parts);
}

export interface SevenZipFile {
  name: string;
  data?: Uint8Array;
  directory?: boolean;
  mtime?: number;
}

export interface SevenZipOptions {
  coder?: 'copy' | 'lzma2' | 'bzip2' | 'aes';
  encodeHeader?: boolean;
}

const CODERS = { copy: [0x00], lzma2: [0x21], bzip2: [0x04, 0x02, 0x02], aes: [0x06, 0xf1, 0x07, 0x01] };

/** One folder of one coder. As 7-Zip does, the folder's CRC is given for an encoded header, the files' CRCs otherwise. */
function folder(coder: keyof typeof CODERS, unpacked: number, crc?: number): number[] {
  const id = CODERS[coder];
  const properties = coder === 'lzma2' ? [0x10] : [];
  const flags = id.length | (properties.length ? 0x20 : 0);
  return [0x0b, ...number(1), 0, ...number(1), flags, ...id, ...(properties.length ? [...number(properties.length), ...properties] : []), 0x0c, ...number(unpacked), ...(crc === undefined ? [] : [0x0a, 1, ...u32(crc)]), 0x00];
}

const FILETIME = (seconds: number) => (seconds + 11644473600) * 1e7;

export function sevenZip(files: SevenZipFile[], options: SevenZipOptions = {}): Uint8Array {
  const coder = options.coder ?? 'copy';
  const streams = files.filter((f) => !f.directory && f.data && f.data.length);
  const unpacked = concat(...streams.map((f) => f.data!));
  const packed = coder === 'lzma2' ? lzma2Stored(unpacked) : unpacked;
  const header: number[] = [0x01];
  if (streams.length) {
    header.push(0x04, 0x06, ...number(0), ...number(1), 0x09, ...number(packed.length), 0x00);
    header.push(0x07, ...folder(coder, unpacked.length));
    header.push(0x08, 0x0d, ...number(streams.length));
    if (streams.length > 1) header.push(0x09, ...streams.slice(0, -1).flatMap((f) => number(f.data!.length)));
    header.push(0x0a, 1, ...streams.flatMap((f) => u32(crc32(f.data!))), 0x00, 0x00);
  }
  header.push(0x05, ...number(files.length));
  const empty = files.map((f) => !streams.includes(f));
  if (empty.some(Boolean)) {
    const vector = bitVector(empty);
    header.push(0x0e, ...number(vector.length), ...vector);
    const emptyFiles = bitVector(files.filter((_, i) => empty[i]).map((f) => !f.directory));
    header.push(0x0f, ...number(emptyFiles.length), ...emptyFiles);
  }
  const names = [0, ...files.flatMap((f) => [...utf16(f.name), 0, 0])];
  header.push(0x11, ...number(names.length), ...names);
  if (files.some((f) => f.mtime !== undefined)) {
    const times = [1, 0, ...files.flatMap((f) => u64(FILETIME(f.mtime ?? 0)))];
    header.push(0x14, ...number(times.length), ...times);
  }
  header.push(0x00, 0x00);

  let body = packed;
  let next = new Uint8Array(header);
  if (options.encodeHeader) {
    const plain = new Uint8Array(header);
    const stored = lzma2Stored(plain);
    body = concat(packed, stored);
    next = new Uint8Array([0x17, 0x06, ...number(packed.length), ...number(1), 0x09, ...number(stored.length), 0x00, 0x07, ...folder('lzma2', plain.length, crc32(plain)), 0x00]);
  }
  const start = new Uint8Array([...u64(body.length), ...u64(next.length), ...u32(crc32(next))]);
  return concat([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4], u32(crc32(start)), start, body, next);
}

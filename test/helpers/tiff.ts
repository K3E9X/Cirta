/**
 * Exif built field by field: a little-endian TIFF block with IFD0, the Exif
 * sub-IFD and the GPS IFD, every offset computed rather than typed in, then
 * wrapped as a JPEG APP1 segment or a PNG eXIf chunk. PNG text chunks too.
 */

import { crc32, deflateSync } from 'node:zlib';

export type Field =
  | { tag: number; ascii: string }
  | { tag: number; rational: Array<[number, number]> }
  | { tag: number; short: number }
  | { tag: number; long: number }
  | { tag: number; byte: number };

const enc = new TextEncoder();
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

function payload(field: Field): { type: number; count: number; bytes: number[] } {
  if ('ascii' in field) {
    const bytes = [...enc.encode(field.ascii), 0];
    return { type: 2, count: bytes.length, bytes };
  }
  if ('rational' in field) return { type: 5, count: field.rational.length, bytes: field.rational.flatMap(([n, d]) => [...u32(n), ...u32(d)]) };
  if ('short' in field) return { type: 3, count: 1, bytes: [...u16(field.short), 0, 0] };
  if ('byte' in field) return { type: 1, count: 1, bytes: [field.byte, 0, 0, 0] };
  return { type: 4, count: 1, bytes: u32(field.long) };
}

/** One IFD at `at`: entries, a zero next-pointer, then values too large for their slot. */
function ifd(fields: Field[], at: number): number[] {
  const sorted = [...fields].sort((a, b) => a.tag - b.tag);
  let overflowAt = at + 2 + sorted.length * 12 + 4;
  const entries: number[] = [];
  const overflow: number[] = [];
  for (const field of sorted) {
    const { type, count, bytes } = payload(field);
    entries.push(...u16(field.tag), ...u16(type), ...u32(count));
    if (bytes.length <= 4) {
      entries.push(...bytes, ...new Array(4 - bytes.length).fill(0));
    } else {
      entries.push(...u32(overflowAt));
      overflow.push(...bytes);
      if (bytes.length % 2) overflow.push(0);
      overflowAt += bytes.length + (bytes.length % 2);
    }
  }
  return [...u16(sorted.length), ...entries, ...u32(0), ...overflow];
}

const size = (fields: Field[]) => ifd(fields, 0).length;

export function tiff(ifd0: Field[], exif?: Field[], gps?: Field[]): Uint8Array {
  const pointers: Field[] = [];
  // IFD0's size depends on how many pointers it carries, not on their values.
  const ifd0Size = size([...ifd0, ...(exif ? [{ tag: 0x8769, long: 0 }] : []), ...(gps ? [{ tag: 0x8825, long: 0 }] : [])]);
  let next = 8 + ifd0Size;
  const exifAt = next;
  if (exif) {
    pointers.push({ tag: 0x8769, long: exifAt });
    next += size(exif);
  }
  const gpsAt = next;
  if (gps) pointers.push({ tag: 0x8825, long: gpsAt });
  return new Uint8Array([
    0x49, 0x49, 0x2a, 0x00, ...u32(8),
    ...ifd([...ifd0, ...pointers], 8),
    ...(exif ? ifd(exif, exifAt) : []),
    ...(gps ? ifd(gps, gpsAt) : []),
  ]);
}

/** A tiny but well-formed JPEG carrying `block` as its Exif APP1, and any further APP1 bodies (XMP). */
export function jpegWith(block: Uint8Array | undefined, ...app1: Uint8Array[]): Uint8Array {
  const segment = (body: number[]) => [0xff, 0xe1, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body];
  const exif = block ? segment([0x45, 0x78, 0x69, 0x66, 0, 0, ...block]) : [];
  const more = app1.flatMap((body) => segment([...body]));
  const sof = [0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 0x11, 0];
  return new Uint8Array([0xff, 0xd8, ...exif, ...more, ...sof, 0xff, 0xd9]);
}

export const xmpApp1 = (xmp: string) => enc.encode(`http://ns.adobe.com/xap/1.0/\0${xmp}`);

export type PngChunk = { type: string; data: Uint8Array };

export const tEXt = (keyword: string, text: string): PngChunk => ({ type: 'tEXt', data: enc.encode(`${keyword}\0${text}`) });
export const zTXt = (keyword: string, text: string): PngChunk => ({
  type: 'zTXt',
  data: new Uint8Array([...enc.encode(keyword), 0, 0, ...deflateSync(enc.encode(text))]),
});
export const iTXt = (keyword: string, text: string, compressed = false): PngChunk => ({
  type: 'iTXt',
  data: new Uint8Array([...enc.encode(keyword), 0, compressed ? 1 : 0, 0, 0, 0, ...(compressed ? deflateSync(enc.encode(text)) : enc.encode(text))]),
});

export function png(...chunks: PngChunk[]): Uint8Array {
  const chunk = ({ type, data }: PngChunk) => {
    const typed = new Uint8Array([...enc.encode(type), ...data]);
    const crc = crc32(typed);
    return [(data.length >>> 24) & 0xff, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff, ...typed, (crc >>> 24) & 0xff, (crc >> 16) & 0xff, (crc >> 8) & 0xff, crc & 0xff];
  };
  const ihdr = { type: 'IHDR', data: new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]) };
  const idat = { type: 'IDAT', data: new Uint8Array(deflateSync(new Uint8Array([0, 0, 0, 0]))) };
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk(ihdr), ...chunks.flatMap(chunk), ...chunk(idat), ...chunk({ type: 'IEND', data: new Uint8Array() })]);
}

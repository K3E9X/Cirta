/**
 * [F-P2 2.2] WebP, GIF, TIFF, HEIC and AVIF: where each keeps EXIF and XMP.
 *
 *   WebP  RIFF chunks: EXIF (a TIFF block) and "XMP ", announced by flags in
 *         VP8X. Cleaned: the chunks go, the flags are cleared, the RIFF size
 *         is written again.
 *   GIF   extension blocks: comments (0xFE), and application blocks — XMP
 *         ("XMP DataXMP"), Photoshop resources. Cleaned: those blocks go;
 *         the loop count (NETSCAPE2.0) and the colour profile stay.
 *   TIFF  the file is the EXIF: IFD0 and its Exif and GPS directories, XMP in
 *         tag 700. Inspected only: every value is placed by an offset, and
 *         rewriting the directories without damaging the picture is a TIFF
 *         writer's job, not this one's.
 *   HEIF  (HEIC, AVIF) ISO-BMFF items: an "Exif" item and an XMP "mime" item,
 *         listed in iinf and placed by iloc. Inspected only, for the same
 *         reason: the item locations are absolute, and moving one means
 *         rewriting the box tree.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';
import { exifFindings, parseExif } from './exif.js';
import { imageXmpFindings } from './xmp.js';
import { findSourceTypes } from './sourcetype.js';

export type PictureKind = 'webp' | 'gif' | 'tiff' | 'heic' | 'avif';

/** The kinds whose metadata can be taken out without rewriting the picture's structure. */
export const REWRITABLE_PICTURES: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp', 'gif']);

const ASCII = new TextDecoder('latin1');
const UTF8 = new TextDecoder();
const fourcc = (data: Uint8Array, at: number) => ASCII.decode(data.subarray(at, at + 4));

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

export function detectPictureKind(data: Uint8Array): PictureKind | undefined {
  // A WebP opens with its image chunk: a RIFF header alone is not a picture.
  if (data.length >= 20 && fourcc(data, 0) === 'RIFF' && fourcc(data, 8) === 'WEBP' && /^VP8[ LX]$/.test(fourcc(data, 12))) return 'webp';
  if (data.length >= 6 && /^GIF8[79]a$/.test(ASCII.decode(data.subarray(0, 6)))) return 'gif';
  if (data.length >= 8 && ((data[0] === 0x49 && data[1] === 0x49 && data[2] === 42 && data[3] === 0) || (data[0] === 0x4d && data[1] === 0x4d && data[2] === 0 && data[3] === 42))) return 'tiff';
  if (data.length >= 16 && fourcc(data, 4) === 'ftyp') {
    const size = Math.min(new DataView(data.buffer, data.byteOffset).getUint32(0), data.length, 256);
    const brands = [fourcc(data, 8)];
    for (let at = 16; at + 4 <= size; at += 4) brands.push(fourcc(data, at));
    if (brands.some((b) => AVIF_BRANDS.has(b))) return 'avif';
    if (brands.some((b) => HEIC_BRANDS.has(b))) return 'heic';
  }
  return undefined;
}

export const PICTURE_LOCATION: Record<PictureKind, string> = {
  webp: 'WebP chunks',
  gif: 'GIF blocks',
  tiff: 'TIFF directory',
  heic: 'HEIF items',
  avif: 'HEIF items',
};

/** The findings of a TIFF block: the EXIF fields when they read, its size when not. */
function exifBlock(tiff: Uint8Array, location: string): Finding[] {
  const exif = parseExif(tiff);
  const fields = exif ? exifFindings(exif, location) : [];
  return [
    ...fields,
    { kind: 'identity', confidence: fields.length ? 'informational' : 'probable', location, label: 'Exif camera data', value: `${tiff.length} bytes` },
  ];
}

const xmpBlock = (xmp: string, location: string): Finding[] => [
  ...findSourceTypes(xmp, location),
  ...imageXmpFindings(xmp, `${location} (XMP)`),
  { kind: 'identity', confidence: 'informational', location, label: 'XMP metadata', value: `${xmp.length} bytes` },
];

const afterEnd = (location: string, bytes: number): Finding => ({ kind: 'environment', confidence: 'probable', location, label: 'Data after the end of the image', value: `${bytes} bytes after the image ends` });

/* ------------------------------------------------------------------ WebP -- */

interface Chunk {
  type: string;
  start: number;
  /** End of the chunk, its padding byte included. */
  end: number;
  body: Uint8Array;
}

/** Chunks a WebP reader knows; anything else is somebody's private data. */
const WEBP_STANDARD = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

function webpChunks(data: Uint8Array): { chunks: Chunk[]; end: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = Math.min(data.length, 8 + view.getUint32(4, true));
  const chunks: Chunk[] = [];
  let at = 12;
  while (at + 8 <= end) {
    const size = view.getUint32(at + 4, true);
    const bodyEnd = at + 8 + size;
    if (bodyEnd > end) throw new Error('WebP chunk runs past the end of the file');
    chunks.push({ type: fourcc(data, at), start: at, end: Math.min(end, bodyEnd + (size % 2)), body: data.subarray(at + 8, bodyEnd) });
    at = bodyEnd + (size % 2);
  }
  return { chunks, end };
}

/** A WebP EXIF chunk is a TIFF block; some writers put JPEG's "Exif\0\0" before it. */
const webpTiff = (body: Uint8Array) => (ASCII.decode(body.subarray(0, 6)) === 'Exif\0\0' ? body.subarray(6) : body);

function inspectWebp(data: Uint8Array, location: string): Finding[] {
  const { chunks, end } = webpChunks(data);
  const findings: Finding[] = [];
  for (const chunk of chunks) {
    if (chunk.type === 'EXIF') findings.push(...exifBlock(webpTiff(chunk.body), location));
    else if (chunk.type === 'XMP ') findings.push(...xmpBlock(UTF8.decode(chunk.body), location));
    else if (!WEBP_STANDARD.has(chunk.type)) findings.push({ kind: 'environment', confidence: 'probable', location, label: 'Private chunk', value: `${chunk.type.trim()} — ${chunk.body.length} bytes` });
  }
  if (end < data.length && data.subarray(end).some((b) => b !== 0)) findings.push(afterEnd(location, data.length - end));
  return findings;
}

function stripWebp(data: Uint8Array): Uint8Array<ArrayBuffer> | undefined {
  const { chunks, end } = webpChunks(data);
  const keep = chunks.filter((c) => WEBP_STANDARD.has(c.type));
  if (keep.length === chunks.length && end === data.length) return undefined;
  const size = 12 + keep.reduce((n, c) => n + c.end - c.start, 0);
  const out = new Uint8Array(size);
  out.set(data.subarray(0, 12));
  let at = 12;
  for (const chunk of keep) {
    out.set(data.subarray(chunk.start, chunk.end), at);
    // What VP8X announces must be there: EXIF and XMP are not any more.
    if (chunk.type === 'VP8X') out[at + 8] = out[at + 8]! & ~0x0c;
    at += chunk.end - chunk.start;
  }
  new DataView(out.buffer).setUint32(4, size - 8, true);
  return out;
}

/* ------------------------------------------------------------------- GIF -- */

interface GifBlock {
  start: number;
  end: number;
  /** For an extension, its label; for an application extension, its identifier. */
  label: number;
  application?: string;
  /** The sub-blocks' data, joined. */
  data: Uint8Array;
}

/** Application blocks a GIF needs: the loop count, its colour profile. */
const GIF_KEPT_APPLICATIONS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0', 'ICCRGBG1012']);

function gifSubBlocks(data: Uint8Array, at: number): { end: number; data: Uint8Array } {
  const parts: Uint8Array[] = [];
  while (at < data.length) {
    const size = data[at]!;
    if (size === 0) return { end: at + 1, data: concat(parts) };
    if (at + 1 + size > data.length) break;
    parts.push(data.subarray(at + 1, at + 1 + size));
    at += 1 + size;
  }
  throw new Error('GIF block runs past the end of the file');
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** GIF89a: the header, the colour table, then extensions and images to the trailer. */
function gifBlocks(data: Uint8Array): { extensions: GifBlock[]; end: number } {
  if (data.length < 13) throw new Error('GIF too short');
  const packed = data[10]!;
  let at = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
  const extensions: GifBlock[] = [];
  while (at < data.length) {
    const introducer = data[at]!;
    if (introducer === 0x3b) return { extensions, end: at + 1 };
    if (introducer === 0x21) {
      const label = data[at + 1]!;
      let application: string | undefined;
      let next = at + 2;
      if (label === 0xff && data[next] === 11) {
        application = ASCII.decode(data.subarray(next + 1, next + 12));
        // XMP is written raw, its "magic trailer" making it read as sub-blocks.
        next += 12;
      }
      const sub = gifSubBlocks(data, next);
      extensions.push({ start: at, end: sub.end, label, application, data: application === 'XMP DataXMP' ? data.subarray(at + 14, sub.end) : sub.data });
      at = sub.end;
    } else if (introducer === 0x2c) {
      if (at + 10 > data.length) break;
      const local = data[at + 9]!;
      at += 10 + (local & 0x80 ? 3 * 2 ** ((local & 7) + 1) : 0) + 1;
      at = gifSubBlocks(data, at).end;
    } else {
      throw new Error(`GIF block of unknown type 0x${introducer.toString(16)}`);
    }
  }
  throw new Error('GIF has no trailer');
}

const gifRemoved = (block: GifBlock) => block.label === 0xfe || (block.label === 0xff && !GIF_KEPT_APPLICATIONS.has(block.application ?? ''));

function inspectGif(data: Uint8Array, location: string): Finding[] {
  const { extensions, end } = gifBlocks(data);
  const findings: Finding[] = [];
  for (const block of extensions) {
    if (block.label === 0xfe) {
      const text = UTF8.decode(block.data);
      findings.push(...findSourceTypes(text, location), { kind: 'identity', confidence: 'probable', location, label: 'Embedded comment', value: preview(text, 200) });
    } else if (block.application === 'XMP DataXMP') {
      // [P0-1] From the first opening to the last closing, as the greedy pattern took it, without retrying from every opening.
      const decoded = UTF8.decode(block.data);
      const start = decoded.indexOf('<x:xmpmeta');
      const end = decoded.lastIndexOf('</x:xmpmeta>');
      const xmp = start >= 0 && end > start ? decoded.slice(start, end + '</x:xmpmeta>'.length) : '';
      findings.push(...xmpBlock(xmp, location));
    } else if (gifRemoved(block)) {
      findings.push({ kind: 'environment', confidence: 'probable', location, label: 'Application metadata', value: `${(block.application ?? '').trim() || '?'} — ${block.end - block.start} bytes` });
    }
  }
  if (end < data.length && data.subarray(end).some((b) => b !== 0)) findings.push(afterEnd(location, data.length - end));
  return findings;
}

function stripGif(data: Uint8Array): Uint8Array<ArrayBuffer> | undefined {
  const { extensions, end } = gifBlocks(data);
  const drop = extensions.filter(gifRemoved);
  if (!drop.length && end === data.length) return undefined;
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const block of drop) {
    parts.push(data.subarray(at, block.start));
    at = block.end;
  }
  parts.push(data.subarray(at, end));
  return concat(parts) as Uint8Array<ArrayBuffer>;
}

/* ------------------------------------------------------------------ TIFF -- */

/** The raw bytes of one IFD0 tag, whatever its type: XMP is tag 700, IPTC 33723. */
function ifd0Tag(data: Uint8Array, tag: number): Uint8Array | undefined {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const little = data[0] === 0x49;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  const first = u32(4);
  if (first + 2 > data.length) return undefined;
  const count = Math.min(u16(first), 512);
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  for (let i = 0; i < count; i++) {
    const entry = first + 2 + i * 12;
    if (entry + 12 > data.length) return undefined;
    if (u16(entry) !== tag) continue;
    const length = (sizes[u16(entry + 2)] ?? 1) * u32(entry + 4);
    const at = length <= 4 ? entry + 8 : u32(entry + 8);
    return at + length <= data.length ? data.subarray(at, at + length) : undefined;
  }
  return undefined;
}

function inspectTiff(data: Uint8Array, location: string): Finding[] {
  const exif = parseExif(data);
  const findings = exif ? exifFindings(exif, location) : [];
  const xmp = ifd0Tag(data, 700);
  if (xmp) findings.push(...xmpBlock(UTF8.decode(xmp).replace(/(?<!\0)\0+$/, ''), location));
  const iptc = ifd0Tag(data, 33723);
  if (iptc) findings.push({ kind: 'identity', confidence: 'probable', location, label: 'IPTC/Photoshop metadata', value: `${iptc.length} bytes` });
  return findings;
}

/* ------------------------------------------------------------------ HEIF -- */

interface Box {
  type: string;
  /** Start of the content, after the header. */
  body: number;
  end: number;
}

function boxes(data: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end && out.length < 10_000) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) break;
    out.push({ type: fourcc(data, at + 4), body: at + header, end: at + size });
    at += size;
  }
  return out;
}

/** ISO/IEC 23008-12: the items an iinf lists and the extents an iloc gives them. */
function heifItems(data: Uint8Array): Array<{ type: string; contentType?: string; bytes: Uint8Array }> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const meta = boxes(data, 0, data.length).find((b) => b.type === 'meta');
  if (!meta) return [];
  const children = boxes(data, meta.body + 4, meta.end);
  const iinf = children.find((b) => b.type === 'iinf');
  const iloc = children.find((b) => b.type === 'iloc');
  const idat = children.find((b) => b.type === 'idat');
  if (!iinf || !iloc) return [];

  const infos = new Map<number, { type: string; contentType?: string }>();
  const iinfVersion = data[iinf.body]!;
  for (const infe of boxes(data, iinf.body + 4 + (iinfVersion === 0 ? 2 : 4), iinf.end).filter((b) => b.type === 'infe')) {
    const version = data[infe.body]!;
    if (version < 2 || infe.end - infe.body < 12) continue;
    let at = infe.body + 4;
    const id = version === 2 ? view.getUint16(at) : view.getUint32(at);
    at += (version === 2 ? 2 : 4) + 2;
    const type = fourcc(data, at);
    at += 4;
    const zString = () => {
      const stop = data.indexOf(0, at);
      const end = stop < 0 || stop > infe.end ? infe.end : stop;
      const value = UTF8.decode(data.subarray(at, end));
      at = end + 1;
      return value;
    };
    zString(); // item name
    infos.set(id, { type, contentType: type === 'mime' ? zString() : undefined });
  }

  const version = data[iloc.body]!;
  let at = iloc.body + 4;
  const offsetSize = data[at]! >> 4;
  const lengthSize = data[at]! & 0x0f;
  const baseSize = data[at + 1]! >> 4;
  const indexSize = version >= 1 ? data[at + 1]! & 0x0f : 0;
  at += 2;
  const read = (size: number) => {
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + data[at + i]!;
    at += size;
    return value;
  };
  const count = version < 2 ? read(2) : read(4);
  const out: Array<{ type: string; contentType?: string; bytes: Uint8Array }> = [];
  for (let i = 0; i < count && at < iloc.end; i++) {
    const id = version < 2 ? read(2) : read(4);
    const method = version >= 1 ? read(2) & 0x0f : 0;
    read(2); // data reference index
    const base = read(baseSize);
    const extents = read(2);
    const parts: Uint8Array[] = [];
    for (let e = 0; e < extents && at < iloc.end; e++) {
      read(indexSize);
      const offset = base + read(offsetSize);
      const length = read(lengthSize);
      const origin = method === 1 && idat ? idat.body : 0;
      const from = origin + offset;
      const to = length === 0 ? (method === 1 && idat ? idat.end : data.length) : from + length;
      if (method <= 1 && from <= to && to <= data.length) parts.push(data.subarray(from, to));
    }
    const info = infos.get(id);
    if (info && (info.type === 'Exif' || info.type === 'mime')) out.push({ ...info, bytes: concat(parts) });
  }
  return out;
}

function inspectHeif(data: Uint8Array, location: string): Finding[] {
  const findings: Finding[] = [];
  for (const item of heifItems(data)) {
    if (item.type === 'Exif' && item.bytes.length > 4) {
      // The item opens with the offset of the TIFF header within it.
      const skip = 4 + new DataView(item.bytes.buffer, item.bytes.byteOffset).getUint32(0);
      if (skip < item.bytes.length) findings.push(...exifBlock(item.bytes.subarray(skip), location));
    } else if (item.contentType === 'application/rdf+xml') {
      findings.push(...xmpBlock(UTF8.decode(item.bytes), location));
    }
  }
  return findings;
}

/* ---------------------------------------------------------------- public -- */

export function inspectPicture(data: Uint8Array, kind: PictureKind, location: string): Finding[] {
  switch (kind) {
    case 'webp':
      return inspectWebp(data, location);
    case 'gif':
      return inspectGif(data, location);
    case 'tiff':
      return inspectTiff(data, location);
    case 'heic':
    case 'avif':
      return inspectHeif(data, location);
  }
}

/** A copy without its metadata, undefined when there was none — or when this kind is not rewritten here. */
export function stripPicture(data: Uint8Array, kind: PictureKind): Uint8Array<ArrayBuffer> | undefined {
  if (kind === 'webp') return stripWebp(data);
  if (kind === 'gif') return stripGif(data);
  return undefined;
}

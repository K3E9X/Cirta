import { createCanvas } from '@napi-rs/canvas';
import { tiff, type Field } from './tiff.js';

const enc = new TextEncoder();
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];

export const ARTIST: Field[] = [{ tag: 0x013b, ascii: 'Jeanne Dupont' }];
export const GPS: Field[] = [
  { tag: 1, ascii: 'N' },
  { tag: 2, rational: [[48, 1], [51, 1], [0, 1]] },
  { tag: 3, ascii: 'E' },
  { tag: 4, rational: [[2, 1], [21, 1], [0, 1]] },
];
export const XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Marc Leroy</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>';

/** A real picture from the canvas encoder, 12×8, red on the left, blue on the right. */
export async function encoded(format: 'webp' | 'gif' | 'avif'): Promise<Uint8Array> {
  const canvas = createCanvas(12, 8);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 6, 8);
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(6, 0, 6, 8);
  return new Uint8Array(await canvas.encode(format as 'webp'));
}

/** A WebP with EXIF and XMP chunks added, and the VP8X flags that announce them. */
export async function webpWithMetadata(): Promise<Uint8Array> {
  const base = await encoded('webp');
  const chunk = (fourcc: string, body: Uint8Array | number[]) => {
    const bytes = [...body];
    return [...enc.encode(fourcc), ...u32le(bytes.length), ...bytes, ...(bytes.length % 2 ? [0] : [])];
  };
  const chunks = [...base.subarray(12)];
  // VP8X comes first in the encoder's output: set its EXIF (0x08) and XMP (0x04) flags.
  if (String.fromCharCode(...chunks.slice(0, 4)) !== 'VP8X') throw new Error('expected VP8X first');
  chunks[8] = chunks[8]! | 0x0c;
  const body = [...chunks, ...chunk('EXIF', tiff(ARTIST, undefined, GPS)), ...chunk('XMP ', enc.encode(XMP))];
  return new Uint8Array([...enc.encode('RIFF'), ...u32le(body.length + 4), ...enc.encode('WEBP'), ...body]);
}

/** A GIF with a comment extension and an XMP application extension before the image. */
export async function gifWithMetadata(): Promise<Uint8Array> {
  const base = await encoded('gif');
  const packed = base[10]!;
  const start = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
  const text = enc.encode('Retouché par Jeanne Dupont');
  const comment = [0x21, 0xfe, text.length, ...text, 0];
  // XMP in GIF: the packet raw, then a 258-byte "magic trailer" so that a sub-block reader skips it.
  const trailer = [1, ...Array.from({ length: 256 }, (_, i) => 255 - i), 0];
  const xmp = [0x21, 0xff, 11, ...enc.encode('XMP DataXMP'), ...enc.encode(XMP), ...trailer];
  return new Uint8Array([...base.subarray(0, start), ...comment, ...xmp, ...base.subarray(start)]);
}

/** A TIFF whose IFD0 names the artist and carries an XMP packet (tag 700), with a GPS directory. */
export function tiffWithMetadata(): Uint8Array {
  return tiff([...ARTIST, { tag: 700, ascii: XMP }], undefined, GPS);
}

const box = (type: string, body: number[]) => [...u32be(body.length + 8), ...enc.encode(type), ...body];
const full = (type: string, version: number, body: number[]) => box(type, [version, 0, 0, 0, ...body]);

/**
 * A HEIF file reduced to what metadata reading needs: ftyp, then a meta box
 * whose iinf names an Exif item and an XMP item, whose iloc places them in mdat.
 */
export function heifWithMetadata(brand: 'heic' | 'avif'): Uint8Array {
  const exif = [0, 0, 0, 6, ...enc.encode('Exif\0\0'), ...tiff(ARTIST, undefined, GPS)];
  const xmp = [...enc.encode(XMP)];
  const infe = (id: number, type: string, extra: number[] = []) => full('infe', 2, [...u16be(id), 0, 0, ...enc.encode(type), 0, ...extra]);
  const iinf = full('iinf', 0, [...u16be(2), ...infe(1, 'Exif'), ...infe(2, 'mime', [...enc.encode('application/rdf+xml'), 0])]);
  const ftyp = box('ftyp', [...enc.encode(brand), 0, 0, 0, 0, ...enc.encode('mif1'), ...enc.encode(brand)]);
  const hdlr = full('hdlr', 0, [0, 0, 0, 0, ...enc.encode('pict'), ...new Array(12).fill(0), 0]);
  // iloc v0: offset_size 4, length_size 4, base_offset_size 0; offsets patched once the layout is known.
  // Per item: id, data reference index 0, one extent.
  const item = (id: number, at: number, length: number) => [...u16be(id), 0, 0, ...u16be(1), ...u32be(at), ...u32be(length)];
  const iloc = (exifAt: number, xmpAt: number) => full('iloc', 0, [0x44, 0x00, ...u16be(2), ...item(1, exifAt, exif.length), ...item(2, xmpAt, xmp.length)]);
  const meta = (exifAt: number, xmpAt: number) => full('meta', 0, [...hdlr, ...iinf, ...iloc(exifAt, xmpAt)]);
  const head = ftyp.length + meta(0, 0).length + 8;
  return new Uint8Array([...ftyp, ...meta(head, head + exif.length), ...box('mdat', [...exif, ...xmp])]);
}

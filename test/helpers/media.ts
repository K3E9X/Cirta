/**
 * [F-P3 2.2] Media files built byte by byte: ISO BMFF / QuickTime boxes, ID3
 * tags around MPEG audio frames, RIFF/WAVE chunks. No binary fixture.
 */

const enc = new TextEncoder();
const bytes = (...parts: Array<Uint8Array | number[] | string>) => {
  const arrays = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
};
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const latin1 = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

/** A box: size, type (latin1, so ©xyz is one byte 0xA9 then xyz), payload. */
export function box(type: string, ...payload: Array<Uint8Array | number[] | string>): Uint8Array {
  const body = bytes(...payload);
  return bytes(u32be(8 + body.length), latin1(type), body);
}

/** QuickTime's text atom in udta: [length][language][text]. */
const qtText = (text: string) => {
  const t = enc.encode(text);
  return bytes(u16be(t.length), u16be(0x55c4), t);
};

/** An iTunes-style or mdta item value. */
const dataBox = (text: string) => box('data', u32be(1), u32be(0), text);

export const SECONDS_1904 = 2082844800;
/** 2024-03-01T10:00:00Z, in QuickTime's seconds since 1904. */
export const MOVIE_TIME = Date.UTC(2024, 2, 1, 10) / 1000 + SECONDS_1904;
const XMP_UUID = [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac];

export interface MovieOptions {
  brand?: string;
  gps?: string;
  encoder?: string;
  apple?: Record<string, string>;
  xmpCreator?: string;
  mdat?: Uint8Array;
}

/** A movie: ftyp, moov (mvhd with dates, a track, udta, Apple metadata), a top-level XMP uuid, mdat. */
export function movie(options: MovieOptions = {}): Uint8Array {
  const mvhd = box('mvhd', [0, 0, 0, 0], u32be(MOVIE_TIME), u32be(MOVIE_TIME + 60), u32be(600), u32be(6000), new Uint8Array(80));
  const tkhd = box('tkhd', [0, 0, 0, 3], u32be(MOVIE_TIME), u32be(MOVIE_TIME), u32be(1), new Uint8Array(72));
  const mdhd = box('mdhd', [0, 0, 0, 0], u32be(MOVIE_TIME), u32be(MOVIE_TIME), u32be(600), u32be(6000), [0x55, 0xc4, 0, 0]);
  const trak = box('trak', tkhd, box('mdia', mdhd));
  const udtaItems: Uint8Array[] = [];
  if (options.gps) udtaItems.push(box('©xyz', qtText(options.gps)));
  if (options.encoder) udtaItems.push(box('©too', qtText(options.encoder)));
  const moovItems = [mvhd, trak];
  if (udtaItems.length) moovItems.push(box('udta', ...udtaItems));
  if (options.apple) {
    const entries = Object.entries(options.apple);
    const keys = box('keys', [0, 0, 0, 0], u32be(entries.length), ...entries.map(([key]) => box('mdta', key)));
    const ilst = box('ilst', ...entries.map(([, value], i) => bytes(u32be(8 + 8 + 8 + enc.encode(value).length), u32be(i + 1), dataBox(value))));
    moovItems.push(box('meta', box('hdlr', [0, 0, 0, 0], u32be(0), 'mdta', new Uint8Array(13)), keys, ilst));
  }
  const parts = [box('ftyp', options.brand ?? 'isom', u32be(512), options.brand ?? 'isom', 'iso2', 'mp41'), box('moov', ...moovItems)];
  if (options.xmpCreator) {
    parts.push(box('uuid', XMP_UUID, `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>${options.xmpCreator}</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`));
  }
  parts.push(box('mdat', options.mdat ?? new Uint8Array(64).fill(0x5a)));
  return bytes(...parts);
}

export { bytes, u32be, u32le, u16be, latin1 };

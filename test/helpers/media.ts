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

/* ------------------------------------------------------------- MP3 / ID3 -- */

const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];

/** One MPEG-1 Layer III frame, 128 kbit/s, 44.1 kHz, no padding: 417 bytes. `fill` marks it. */
export const mpegFrame = (fill = 0x55, payload?: Uint8Array) => {
  const frame = new Uint8Array(417).fill(fill);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  if (payload) frame.set(payload, 4 + 32);
  return frame;
};

/** A first frame carrying a Xing/Info header and a LAME version string, as LAME writes it. */
export const lameFrame = () => mpegFrame(0, bytes('Info', [0, 0, 0, 0x0f], new Uint8Array(112), 'LAME3.100'));

export type Id3Frame = [id: string, body: Uint8Array];

/** An ID3 text frame body: encoding 0 (Latin-1), 1 (UTF-16 with BOM) or 3 (UTF-8). */
export function id3Text(text: string, encoding: 0 | 1 | 3 = 0): Uint8Array {
  if (encoding === 1) {
    const units = [0xff, 0xfe];
    for (const c of text) {
      const code = c.charCodeAt(0);
      units.push(code & 0xff, code >> 8);
    }
    return bytes([1], units, [0, 0]);
  }
  return bytes([encoding], encoding === 0 ? latin1(text) : text, [0]);
}

/** An ID3v2 tag, version 2, 3 or 4. */
export function id3v2(version: 2 | 3 | 4, frames: Id3Frame[]): Uint8Array {
  const body = bytes(
    ...frames.map(([id, data]) =>
      version === 2
        ? bytes(id, [(data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff], data)
        : bytes(id, version === 4 ? syncsafe(data.length) : u32be(data.length), [0, 0], data),
    ),
    new Uint8Array(16), // padding
  );
  return bytes('ID3', [version, 0, 0], syncsafe(body.length), body);
}

/** An ID3v1 tag: the last 128 bytes. */
export function id3v1(title: string, artist: string, album: string, year: string, comment: string): Uint8Array {
  const field = (text: string, size: number) => {
    const out = new Uint8Array(size);
    out.set(latin1(text).subarray(0, size));
    return out;
  };
  return bytes('TAG', field(title, 30), field(artist, 30), field(album, 30), field(year, 4), field(comment, 30), [12]);
}

/** An APEv2 tag with its footer (and header), as foobar2000 and Monkey's Audio write it. */
export function apev2(items: Record<string, string>): Uint8Array {
  const entries = Object.entries(items).map(([key, value]) => {
    const v = enc.encode(value);
    return bytes(u32le(v.length), u32le(0), key, [0], v);
  });
  const body = bytes(...entries);
  const footer = (header: boolean) => bytes('APETAGEX', u32le(2000), u32le(body.length + 32), u32le(entries.length), u32le(header ? 0xa0000000 : 0x80000000), new Uint8Array(8));
  return bytes(footer(true), body, footer(false));
}

/* ------------------------------------------------------------------- WAV -- */

/** A RIFF chunk, padded to an even length. */
export const chunk = (id: string, ...payload: Array<Uint8Array | number[] | string>) => {
  const body = bytes(...payload);
  return bytes(latin1(id), u32le(body.length), body, body.length % 2 ? [0] : []);
};
const fixed = (text: string, size: number) => {
  const out = new Uint8Array(size);
  out.set(latin1(text).subarray(0, size));
  return out;
};

/** The samples of a 1-channel, 8 kHz, 16-bit PCM sound: odd-sized on purpose, so the pad byte is exercised. */
export const SAMPLES = new Uint8Array(1001).map((_, i) => (i * 7) & 0xff);

export interface WavOptions {
  info?: Record<string, string>;
  bext?: { description: string; originator: string; reference: string; date: string; time: string; history: string };
  ixml?: string;
  xmpCreator?: string;
  id3Artist?: string;
  cueLabel?: string;
  rf64?: boolean;
}

export function wav(options: WavOptions = {}): Uint8Array {
  const parts: Uint8Array[] = [chunk('fmt ', [1, 0], [1, 0], u32le(8000), u32le(16000), [2, 0], [16, 0])];
  if (options.info) parts.push(chunk('LIST', 'INFO', ...Object.entries(options.info).map(([id, text]) => chunk(id, latin1(text), [0]))));
  if (options.bext) {
    const b = options.bext;
    parts.push(chunk('bext', fixed(b.description, 256), fixed(b.originator, 32), fixed(b.reference, 32), fixed(b.date, 10), fixed(b.time, 8), new Uint8Array(8), [1, 0], new Uint8Array(64 + 10 + 180), latin1(b.history)));
  }
  if (options.ixml) parts.push(chunk('iXML', options.ixml));
  if (options.xmpCreator) parts.push(chunk('_PMX', `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>${options.xmpCreator}</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`));
  if (options.id3Artist) parts.push(chunk('id3 ', id3v2(3, [['TPE1', id3Text(options.id3Artist)]])));
  if (options.cueLabel) {
    parts.push(chunk('cue ', u32le(1), u32le(1), u32le(0), 'data', u32le(0), u32le(0), u32le(100)));
    parts.push(chunk('LIST', 'adtl', chunk('labl', u32le(1), latin1(options.cueLabel), [0])));
  }
  parts.push(chunk('data', SAMPLES));
  const body = bytes('WAVE', ...parts);
  if (options.rf64) return bytes('RF64', u32le(0xffffffff), body);
  return bytes('RIFF', u32le(body.length), body);
}

/**
 * [F-P3 2.2] Audio tags: ID3 (in an MP3, and in a WAV's id3 chunk), ID3v1
 * and APEv2 at the end of an MP3.
 *
 *   ID3v2  in front of the audio, versions 2.2, 2.3 and 2.4: text frames
 *          (artist, title, encoded by, file owner, dates), comments,
 *          user-defined text, the e-mail address a rating (POPM) was made
 *          under, private frames, unique identifiers, links, and the cover
 *          picture — itself read for EXIF, which a phone puts there.
 *   ID3v1  the last 128 bytes: title, artist, album, year, comment.
 *   APEv2  before ID3v1, written by foobar2000 and Monkey's Audio.
 *
 * Cleaning an MP3 keeps the frames between the tags, byte for byte, and
 * drops the tags. The encoder's header in the first frame (Xing/Info, then
 * "LAME3.100") is part of the audio stream — a player reads it for gapless
 * playback — so it is reported as informational and kept.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';
import { detectImageKind, inspectImage } from './image.js';
import { imageXmpFindings } from './xmp.js';

const LATIN1 = new TextDecoder('latin1');
const UTF8 = new TextDecoder();
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });
const UTF16LE = new TextDecoder('utf-16le');
const UTF16BE = new TextDecoder('utf-16be');

interface Field {
  label: string;
  kind: Finding['kind'];
  confidence: Finding['confidence'];
}

const person = (label: string): Field => ({ label, kind: 'identity', confidence: 'confirmed' });
const detail = (label: string): Field => ({ label, kind: 'identity', confidence: 'probable' });
const when = (label: string): Field => ({ label, kind: 'timestamp', confidence: 'probable' });
const tool: Field = { label: 'Software', kind: 'provenance', confidence: 'informational' };

/** Text frames, by their 2.3/2.4 identifier. */
const TEXT_FRAMES: Record<string, Field> = {
  TPE1: person('Artist'),
  TPE2: person('Album artist'),
  TPE3: person('Artist'),
  TPE4: person('Artist'),
  TCOM: person('Composer'),
  TEXT: person('Lyricist'),
  TOWN: person('File owner'),
  TOPE: detail('Original artist'),
  TOLY: detail('Lyricist'),
  TENC: detail('Encoded by'),
  TIT1: detail('Title'),
  TIT2: detail('Title'),
  TIT3: detail('Title'),
  TALB: detail('Album'),
  TOAL: detail('Album'),
  TCOP: detail('Copyright'),
  TPUB: detail('Publisher'),
  TSRC: detail('Recording code (ISRC)'),
  TYER: when('Recording date'),
  TDAT: when('Recording date'),
  TIME: when('Recording date'),
  TDRC: when('Recording date'),
  TDRL: when('Recording date'),
  TORY: when('Recording date'),
  TDOR: when('Recording date'),
  TDEN: when('Encoding time'),
  TDTG: when('Tagging time'),
  TSSE: tool,
};

/** ID3v2.2's three-letter frames, as their 2.3 equivalents. */
const V22: Record<string, string> = {
  TP1: 'TPE1', TP2: 'TPE2', TP3: 'TPE3', TP4: 'TPE4', TCM: 'TCOM', TXT: 'TEXT', TOA: 'TOPE', TOL: 'TOLY', TEN: 'TENC',
  TT1: 'TIT1', TT2: 'TIT2', TT3: 'TIT3', TAL: 'TALB', TOT: 'TOAL', TCR: 'TCOP', TPB: 'TPUB', TRC: 'TSRC', TYE: 'TYER',
  TDA: 'TDAT', TIM: 'TIME', TOR: 'TORY', TSS: 'TSSE', COM: 'COMM', TXX: 'TXXX', WXX: 'WXXX', UFI: 'UFID', POP: 'POPM',
  PIC: 'APIC', GEO: 'GEOB', ULT: 'USLT',
};

/** A string in one of ID3's four encodings, up to its terminator; and where the next one starts. */
function id3String(data: Uint8Array, from: number, end: number, encoding: number): { text: string; next: number } {
  if (encoding === 1 || encoding === 2) {
    let stop = from;
    while (stop + 1 < end && (data[stop] !== 0 || data[stop + 1] !== 0)) stop += 2;
    let raw = data.subarray(from, Math.min(stop, end));
    let decoder = encoding === 2 ? UTF16BE : UTF16LE;
    if (raw[0] === 0xff && raw[1] === 0xfe) raw = raw.subarray(2);
    else if (raw[0] === 0xfe && raw[1] === 0xff) {
      raw = raw.subarray(2);
      decoder = UTF16BE;
    }
    return { text: decoder.decode(raw), next: stop + 2 };
  }
  let stop = from;
  while (stop < end && data[stop] !== 0) stop++;
  return { text: (encoding === 3 ? UTF8 : LATIN1).decode(data.subarray(from, stop)), next: stop + 1 };
}

/** Every string of a text frame (2.4 separates several values with a terminator). */
function textValues(body: Uint8Array): string[] {
  const encoding = body[0] ?? 0;
  const values: string[] = [];
  let at = 1;
  while (at < body.length) {
    const { text, next } = id3String(body, at, body.length, encoding);
    if (text.trim()) values.push(text.trim());
    if (next <= at) break;
    at = next;
  }
  return values;
}

/** Undo unsynchronisation: every 0xFF 0x00 was a lone 0xFF. */
function resync(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    out.push(data[i]!);
    if (data[i] === 0xff && data[i + 1] === 0x00) i++;
  }
  return new Uint8Array(out);
}

const syncsafe = (data: Uint8Array, at: number) => ((data[at]! & 0x7f) << 21) | ((data[at + 1]! & 0x7f) << 14) | ((data[at + 2]! & 0x7f) << 7) | (data[at + 3]! & 0x7f);
const u32 = (data: Uint8Array, at: number) => ((data[at]! << 24) >>> 0) + (data[at + 1]! << 16) + (data[at + 2]! << 8) + data[at + 3]!;

/** The length of the ID3v2 tag at `at` (header and footer included), or 0 if there is none. */
export function id3v2Length(data: Uint8Array, at = 0): number {
  if (data.length < at + 10 || data[at] !== 0x49 || data[at + 1] !== 0x44 || data[at + 2] !== 0x33) return 0;
  const major = data[at + 3]!;
  if (major < 2 || major > 4 || [6, 7, 8, 9].some((i) => data[at + i]! & 0x80)) return 0;
  const footer = major === 4 && data[at + 5]! & 0x10 ? 10 : 0;
  return 10 + syncsafe(data, at + 6) + footer;
}

/** What an ID3v2 tag says, every finding placed in `place`. */
export function id3v2Findings(data: Uint8Array, place = 'ID3v2 tag'): Finding[] {
  const length = id3v2Length(data);
  if (!length) return [];
  const major = data[3]!;
  const flags = data[5]!;
  let tag = data.subarray(10, Math.min(length, data.length));
  if (major < 4 && flags & 0x80) tag = resync(tag);
  let at = 0;
  if (flags & 0x40) {
    // An extended header: 2.3 counts its size without itself, 2.4 with, as a syncsafe integer.
    at = major === 4 ? syncsafe(tag, 0) : u32(tag, 0) + 4;
  }
  const found: Finding[] = [];
  const add = (field: Field, id: string, value: string) => {
    if (value) found.push({ kind: field.kind, confidence: field.confidence, location: `${place} (${id})`, label: field.label, value: preview(value, 120) });
  };
  const head = major === 2 ? 6 : 10;
  while (at + head <= tag.length) {
    if (tag[at] === 0) break; // padding
    const rawId = LATIN1.decode(tag.subarray(at, at + (major === 2 ? 3 : 4)));
    if (!/^[A-Z0-9]{3,4}$/.test(rawId)) break;
    const size = major === 2 ? (tag[at + 3]! << 16) | (tag[at + 4]! << 8) | tag[at + 5]! : major === 4 ? syncsafe(tag, at + 4) : u32(tag, at + 4);
    const frameFlags = major === 2 ? 0 : tag[at + 9]!;
    const start = at + head;
    const end = Math.min(start + size, tag.length);
    at = start + size;
    if (size <= 0) continue;
    // Compressed or encrypted frames are listed by their identifier only.
    if (major === 3 ? frameFlags & 0xc0 : major === 4 ? frameFlags & 0x0c : false) continue;
    let body = tag.subarray(start, end);
    if (major === 4) {
      if (frameFlags & 0x01) body = body.subarray(4); // data length indicator
      if (frameFlags & 0x02) body = resync(body);
    }
    const id = major === 2 ? V22[rawId] ?? rawId : rawId;
    const textField = TEXT_FRAMES[id];
    if (textField) {
      for (const value of textValues(body)) add(textField, rawId, value);
      continue;
    }
    switch (id) {
      case 'COMM':
      case 'USLT': {
        const encoding = body[0] ?? 0;
        const description = id3String(body, 4, body.length, encoding);
        const text = id3String(body, description.next, body.length, encoding).text.trim();
        // iTunes keeps its loudness and gapless figures in comments: numbers about the audio, not about anyone.
        const technical = /^iTun(?:NORM|SMPB|PGAP)$/.test(description.text);
        if (id === 'USLT') add({ label: 'Lyrics', kind: 'identity', confidence: 'probable' }, rawId, `${text.length} characters`);
        else if (text) add(technical ? { label: 'Comment', kind: 'provenance', confidence: 'informational' } : detail('Comment'), rawId, text);
        break;
      }
      case 'TXXX': {
        const encoding = body[0] ?? 0;
        const description = id3String(body, 1, body.length, encoding);
        const value = id3String(body, description.next, body.length, encoding).text.trim();
        if (value) add(detail('User-defined text'), rawId, `${description.text}: ${value}`);
        break;
      }
      case 'POPM': {
        const email = id3String(body, 0, body.length, 0).text.trim();
        if (email) add(person('Listener’s e-mail address'), rawId, email);
        break;
      }
      case 'PRIV': {
        const owner = id3String(body, 0, body.length, 0);
        const payload = body.subarray(owner.next);
        if (owner.text === 'XMP') found.push(...imageXmpFindings(UTF8.decode(payload), `${place} (PRIV XMP)`));
        add(detail('Private data'), rawId, `${owner.text}, ${payload.length} bytes`);
        break;
      }
      case 'UFID': {
        const owner = id3String(body, 0, body.length, 0);
        const identifier = body.subarray(owner.next);
        const printable = /^[\x20-\x7e]+$/.test(LATIN1.decode(identifier)) ? LATIN1.decode(identifier) : [...identifier].map((b) => b.toString(16).padStart(2, '0')).join('');
        add(detail('Unique file identifier'), rawId, `${owner.text}: ${printable}`);
        break;
      }
      case 'WXXX': {
        const encoding = body[0] ?? 0;
        const description = id3String(body, 1, body.length, encoding);
        add(detail('Linked address'), rawId, id3String(body, description.next, body.length, 0).text.trim());
        break;
      }
      case 'APIC': {
        // 2.2: a three-letter format; 2.3/2.4: a MIME type. Then the picture type, a description, the bytes.
        const encoding = body[0] ?? 0;
        let p = 1;
        if (major === 2) p += 3;
        else p = id3String(body, 1, body.length, 0).next;
        const description = id3String(body, p + 1, body.length, encoding);
        const picture = body.subarray(description.next);
        found.push({ kind: 'identity', confidence: 'informational', location: `${place} (${rawId})`, label: 'Embedded picture', value: `${picture.length} bytes` });
        if (detectImageKind(picture)) found.push(...inspectImage(picture, `${place} (${rawId})`).filter((f) => f.confidence !== 'informational'));
        break;
      }
      case 'GEOB': {
        const encoding = body[0] ?? 0;
        const mime = id3String(body, 1, body.length, 0);
        const name = id3String(body, mime.next, body.length, encoding);
        add(detail('Embedded file'), rawId, name.text || mime.text);
        break;
      }
      default:
        if (/^W[A-Z0-9]{3}$/.test(id)) add(detail('Linked address'), rawId, LATIN1.decode(body).replace(/\0.*$/s, '').trim());
        else if (/^T[A-Z0-9]{2,3}$/.test(id)) for (const value of textValues(body)) add(detail('Audio tag field'), rawId, `${rawId}: ${value}`);
    }
  }
  return found;
}

/* -------------------------------------------------------------- MPEG audio -- */

const BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** The length of the MPEG audio frame at `at`, or 0 if no valid frame header is there. */
export function mpegFrameLength(data: Uint8Array, at: number): number {
  if (at + 4 > data.length || data[at] !== 0xff || (data[at + 1]! & 0xe0) !== 0xe0) return 0;
  const version = (data[at + 1]! >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = 4 - ((data[at + 1]! >> 1) & 3); // 1, 2, 3
  const bitrateIndex = data[at + 2]! >> 4;
  const rateIndex = (data[at + 2]! >> 2) & 3;
  const padding = (data[at + 2]! >> 1) & 1;
  if (version === 1 || layer === 4 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return 0;
  const table = BITRATES[`${version === 3 ? 1 : 2}-${version === 3 ? layer : layer === 1 ? 1 : 2}`]!;
  const bitrate = table[bitrateIndex]! * 1000;
  const rate = RATES[version]![rateIndex]!;
  if (layer === 1) return (Math.floor((12 * bitrate) / rate) + padding) * 4;
  const perFrame = layer === 3 && version !== 3 ? 72 : 144;
  return Math.floor((perFrame * bitrate) / rate) + padding;
}

/** An MP3: an ID3v2 tag followed by a frame, or two valid frames in a row. */
export function isMp3(data: Uint8Array): boolean {
  const tag = id3v2Length(data);
  if (tag) return mpegFrameLength(data, tag) > 0 || data.length === tag;
  const first = mpegFrameLength(data, 0);
  return first > 0 && mpegFrameLength(data, first) > 0;
}

/** Where the trailing tags begin: APEv2, then ID3v1 (with its "TAG+" extension). */
function trailer(data: Uint8Array): { audioEnd: number; v1?: number; ape?: { start: number; end: number } } {
  let end = data.length;
  let v1: number | undefined;
  if (end >= 128 && LATIN1.decode(data.subarray(end - 128, end - 125)) === 'TAG') {
    v1 = end - 128;
    end -= 128;
    if (end >= 227 && LATIN1.decode(data.subarray(end - 227, end - 223)) === 'TAG+') end -= 227;
  }
  let ape: { start: number; end: number } | undefined;
  if (end >= 32 && LATIN1.decode(data.subarray(end - 32, end - 24)) === 'APETAGEX') {
    const size = data[end - 20]! | (data[end - 19]! << 8) | (data[end - 18]! << 16) | (data[end - 17]! << 24);
    const flags = data[end - 9]!;
    const withHeader = flags & 0x80 ? 32 : 0;
    const start = end - size - withHeader;
    if (size >= 32 && start >= 0) {
      ape = { start, end };
      end = start;
    }
  }
  return { audioEnd: end, v1, ape };
}

const APE_FIELDS: Record<string, Field> = {
  artist: person('Artist'),
  'album artist': person('Album artist'),
  composer: person('Composer'),
  title: detail('Title'),
  album: detail('Album'),
  comment: detail('Comment'),
  year: when('Recording date'),
  copyright: detail('Copyright'),
  'encoded by': detail('Encoded by'),
  tool: tool,
};

function apeFindings(data: Uint8Array, start: number, end: number): Finding[] {
  const found: Finding[] = [];
  let at = start + (LATIN1.decode(data.subarray(start, start + 8)) === 'APETAGEX' ? 32 : 0);
  const stop = end - 32;
  while (at + 8 < stop) {
    const size = data[at]! | (data[at + 1]! << 8) | (data[at + 2]! << 16) | (data[at + 3]! << 24);
    const flags = data[at + 4]!;
    let key = at + 8;
    while (key < stop && data[key] !== 0) key++;
    const name = LATIN1.decode(data.subarray(at + 8, key));
    const valueStart = key + 1;
    if (size < 0 || valueStart + size > stop) break;
    // Binary items (bit 1 of the flags) are pictures or other data: named only.
    const value = (flags >> 1) & 3 ? `${size} bytes` : UTF8.decode(data.subarray(valueStart, valueStart + size)).replace(/\0/g, ' / ').trim();
    const field = APE_FIELDS[name.toLowerCase()] ?? detail('Audio tag field');
    if (value) found.push({ kind: field.kind, confidence: field.confidence, location: `APEv2 tag (${name})`, label: field.label, value: preview(field.label === 'Audio tag field' ? `${name}: ${value}` : value, 120) });
    at = valueStart + size;
  }
  return found;
}

function id3v1Findings(data: Uint8Array, at: number): Finding[] {
  // Latin-1 by the specification; some writers (ffmpeg among them) put UTF-8 there.
  const text = (from: number, size: number) => {
    const raw = data.subarray(at + from, at + from + size);
    const end = raw.indexOf(0);
    const field = end >= 0 ? raw.subarray(0, end) : raw;
    try {
      return STRICT_UTF8.decode(field).trim();
    } catch {
      return LATIN1.decode(field).trim();
    }
  };
  const found: Finding[] = [];
  const add = (field: Field, name: string, value: string) => {
    if (value) found.push({ kind: field.kind, confidence: field.confidence, location: `ID3v1 tag (${name})`, label: field.label, value });
  };
  add(detail('Title'), 'title', text(3, 30));
  add(person('Artist'), 'artist', text(33, 30));
  add(detail('Album'), 'album', text(63, 30));
  add(when('Recording date'), 'year', text(93, 4));
  add(detail('Comment'), 'comment', text(97, 28 + (data[at + 125] === 0 ? 0 : 2)));
  return found;
}

/** The encoder an MP3's first frame names (Xing/Info, then LAME's or libavcodec's version). */
function encoderOf(data: Uint8Array, first: number): Finding[] {
  const length = mpegFrameLength(data, first);
  if (!length) return [];
  const frame = LATIN1.decode(data.subarray(first, Math.min(first + length, data.length)));
  if (!/Xing|Info|VBRI/.test(frame)) return [];
  const encoder = /(LAME\d+\.\d+\w*|Lav[cf]\d+(?:\.\d+){1,2}|GOGO\S*)/.exec(frame)?.[1];
  return encoder ? [{ kind: 'provenance', confidence: 'informational', location: 'MPEG audio (encoder header)', label: 'Software', value: encoder }] : [];
}

export function inspectMp3(data: Uint8Array): Finding[] {
  const tag = id3v2Length(data);
  const { v1, ape } = trailer(data);
  return [
    ...id3v2Findings(data),
    ...encoderOf(data, tag),
    ...(ape ? apeFindings(data, ape.start, ape.end) : []),
    ...(v1 !== undefined ? id3v1Findings(data, v1) : []),
  ];
}

/** The audio frames alone: every tag in front and behind removed. */
export function stripMp3(data: Uint8Array): Uint8Array {
  let start = 0;
  // Some files carry more than one ID3v2 tag in a row.
  for (let length = id3v2Length(data, start); length; length = id3v2Length(data, start)) start += length;
  return data.slice(start, Math.max(start, trailer(data).audioEnd));
}

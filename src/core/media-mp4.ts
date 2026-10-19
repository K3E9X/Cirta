/**
 * [F-P3 2.2] MP4, QuickTime and M4A: the ISO base media file format and the
 * QuickTime file it comes from, a tree of boxes ("atoms").
 *
 * Where a camera or a phone leaves what it knows:
 *
 *   moov/mvhd, trak/tkhd, mdia/mdhd   creation and modification dates
 *   moov/udta, trak/udta              QuickTime text atoms: ©xyz (the place,
 *                                     ISO 6709), ©mak, ©mod, ©swr, ©too (the
 *                                     encoder), ©nam, ©ART, ©day, ©cmt…; and
 *                                     iTunes tags in udta/meta/ilst (M4A)
 *   moov/meta (handler mdta)          the keys an iPhone or Android writes:
 *                                     com.apple.quicktime.location.ISO6709,
 *                                     .make, .model, .software, .creationdate…
 *   uuid BE7ACFCB-…, udta/XMP_        XMP
 *
 * Cleaning moves nothing. Each of those boxes keeps its size and becomes a
 * `free` box, zero-filled — a box every reader skips — and the dates in the
 * movie, track and media headers are set to zero, which the format reads as
 * "unknown". The media data and every chunk offset that points into it stay
 * exactly where they were, so the copy plays as the original did.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';
import { inspectImage, detectImageKind } from './image.js';
import { imageXmpFindings } from './xmp.js';
import { findSourceTypes } from './sourcetype.js';

export type MovieKind = 'mp4' | 'mov' | 'm4a';

const LATIN1 = new TextDecoder('latin1');
const UTF8 = new TextDecoder();
const UTF16 = new TextDecoder('utf-16be');

/** Types that are only containers of other boxes, as far as metadata goes. */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'udta', 'ilst', 'edts', 'dinf', 'stbl']);
const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';
const QUICKTIME_LEADING = new Set(['moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);

export interface Box {
  type: string;
  /** Where the box starts (its size field). */
  start: number;
  /** Where its payload starts. */
  body: number;
  end: number;
}

/** The boxes between `start` and `end`, stopping at the first that does not fit. */
export function boxes(data: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = LATIN1.decode(data.subarray(at + 4, at + 8));
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      const high = view.getUint32(at + 8);
      const low = view.getUint32(at + 12);
      size = high * 2 ** 32 + low;
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    out.push({ type, start: at, body: at + header, end: at + size });
    at += size;
  }
  return out;
}

/** The kind of movie, from its first box, or undefined. HEIF pictures are told apart by the caller first. */
export function detectMovieKind(data: Uint8Array): MovieKind | undefined {
  if (data.length < 8) return undefined;
  const [first] = boxes(data, 0, Math.min(data.length, 1 << 20));
  if (!first) return undefined;
  if (first.type === 'ftyp') {
    if (first.end - first.body < 8) return undefined;
    const brands = [LATIN1.decode(data.subarray(first.body, first.body + 4))];
    for (let at = first.body + 8; at + 4 <= first.end; at += 4) brands.push(LATIN1.decode(data.subarray(at, at + 4)));
    if (brands[0] === 'qt  ') return 'mov';
    if (/^M4[ABP] $/.test(brands[0]!)) return 'm4a';
    return 'mp4';
  }
  // An older QuickTime movie opens directly with a movie, media or padding atom.
  if (QUICKTIME_LEADING.has(first.type) && boxes(data, 0, data.length).some((b) => b.type === 'moov')) return 'mov';
  return undefined;
}

/* ---------------------------------------------------------------- values -- */

const at = (path: string) => `MP4 boxes (${path})`;

/** Seconds since 1904, as QuickTime counts them, to an ISO date; undefined for "unknown". */
function quicktimeDate(seconds: number): string | undefined {
  if (!seconds) return undefined;
  const ms = (seconds - 2082844800) * 1000;
  if (ms < 0 || ms > Date.UTC(2200, 0, 1)) return undefined;
  return new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
}

/** ISO 6709 ("+48.8584+002.2945+035.000/") as the EXIF reader writes a position. */
function iso6709(value: string): string | undefined {
  const match = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(value.trim());
  if (!match) return undefined;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/** QuickTime's text atom: [length][language][text], perhaps several. */
function quicktimeText(data: Uint8Array, box: Box): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const texts: string[] = [];
  let p = box.body;
  while (p + 4 <= box.end) {
    const length = view.getUint16(p);
    const language = view.getUint16(p + 2);
    if (p + 4 + length > box.end) break;
    const raw = data.subarray(p + 4, p + 4 + length);
    // A packed ISO 639 language means UTF-8; a Macintosh language code, Mac Roman — read as Latin-1, near enough for names.
    texts.push((language >= 0x400 ? UTF8 : LATIN1).decode(raw).replace(/\0+$/, ''));
    p += 4 + length;
  }
  if (!texts.length) return UTF8.decode(data.subarray(box.body, box.end)).replace(/\0+$/, '');
  return texts.join(' / ');
}

/** An iTunes or mdta item's value: its `data` box, typed. */
function itemValue(data: Uint8Array, item: Box): { text?: string; bytes?: Uint8Array } {
  const value = boxes(data, item.body, item.end).find((b) => b.type === 'data');
  if (!value || value.end - value.body < 8) return {};
  const type = (data[value.body + 1]! << 16) | (data[value.body + 2]! << 8) | data[value.body + 3]!;
  const payload = data.subarray(value.body + 8, value.end);
  if (type === 1) return { text: UTF8.decode(payload) };
  if (type === 2) return { text: UTF16.decode(payload) };
  if (type === 13 || type === 14 || type === 27) return { bytes: payload };
  return {};
}

interface Field {
  label: string;
  kind: Finding['kind'];
  confidence: Finding['confidence'];
  gps?: boolean;
}

/** The QuickTime and iTunes four-character keys, ©-prefixed. */
const ATOMS: Record<string, Field> = {
  '©xyz': { label: 'GPS position', kind: 'identity', confidence: 'confirmed', gps: true },
  '©mak': { label: 'Camera make and model', kind: 'identity', confidence: 'probable' },
  '©mod': { label: 'Camera make and model', kind: 'identity', confidence: 'probable' },
  '©swr': { label: 'Software', kind: 'provenance', confidence: 'informational' },
  '©too': { label: 'Software', kind: 'provenance', confidence: 'informational' },
  '©enc': { label: 'Encoded by', kind: 'identity', confidence: 'probable' },
  '©nam': { label: 'Title', kind: 'identity', confidence: 'probable' },
  '©ART': { label: 'Artist', kind: 'identity', confidence: 'confirmed' },
  '©aut': { label: 'Author', kind: 'identity', confidence: 'confirmed' },
  '©wrt': { label: 'Composer', kind: 'identity', confidence: 'confirmed' },
  aART: { label: 'Album artist', kind: 'identity', confidence: 'confirmed' },
  '©alb': { label: 'Album', kind: 'identity', confidence: 'probable' },
  '©day': { label: 'Creation time', kind: 'timestamp', confidence: 'probable' },
  '©cmt': { label: 'Comment', kind: 'identity', confidence: 'probable' },
  '©des': { label: 'Comment', kind: 'identity', confidence: 'probable' },
  desc: { label: 'Comment', kind: 'identity', confidence: 'probable' },
  '©inf': { label: 'Comment', kind: 'identity', confidence: 'probable' },
  cprt: { label: 'Copyright', kind: 'identity', confidence: 'probable' },
  '©cpy': { label: 'Copyright', kind: 'identity', confidence: 'probable' },
  ownr: { label: 'File owner', kind: 'identity', confidence: 'confirmed' },
  apID: { label: 'Store account', kind: 'identity', confidence: 'confirmed' },
};

/**
 * The keys a phone or a muxer writes under moov/meta (handler mdta), named
 * without their com.apple.quicktime. or com.android. prefix and without a
 * language suffix (location-eng).
 */
const KEYS: Record<string, Field> = {
  'location.iso6709': { label: 'GPS position', kind: 'identity', confidence: 'confirmed', gps: true },
  location: { label: 'GPS position', kind: 'identity', confidence: 'confirmed', gps: true },
  'location.name': { label: 'Place name', kind: 'identity', confidence: 'confirmed' },
  make: { label: 'Camera make and model', kind: 'identity', confidence: 'probable' },
  model: { label: 'Camera make and model', kind: 'identity', confidence: 'probable' },
  manufacturer: { label: 'Camera make and model', kind: 'identity', confidence: 'probable' },
  software: { label: 'Software', kind: 'provenance', confidence: 'informational' },
  version: { label: 'Software', kind: 'provenance', confidence: 'informational' },
  encoder: { label: 'Software', kind: 'provenance', confidence: 'informational' },
  creationdate: { label: 'Creation time', kind: 'timestamp', confidence: 'probable' },
  creation_time: { label: 'Creation time', kind: 'timestamp', confidence: 'probable' },
  date: { label: 'Creation time', kind: 'timestamp', confidence: 'probable' },
  author: { label: 'Author', kind: 'identity', confidence: 'confirmed' },
  artist: { label: 'Artist', kind: 'identity', confidence: 'confirmed' },
  album_artist: { label: 'Album artist', kind: 'identity', confidence: 'confirmed' },
  composer: { label: 'Composer', kind: 'identity', confidence: 'confirmed' },
  album: { label: 'Album', kind: 'identity', confidence: 'probable' },
  displayname: { label: 'Title', kind: 'identity', confidence: 'probable' },
  title: { label: 'Title', kind: 'identity', confidence: 'probable' },
  comment: { label: 'Comment', kind: 'identity', confidence: 'probable' },
  description: { label: 'Comment', kind: 'identity', confidence: 'probable' },
  copyright: { label: 'Copyright', kind: 'identity', confidence: 'probable' },
  'content.identifier': { label: 'Capture identifier', kind: 'identity', confidence: 'probable' },
};

/** What a muxer copies from its input and says nothing about anyone: not listed. */
const TECHNICAL_KEYS = new Set(['major_brand', 'minor_version', 'compatible_brands', 'handler_name', 'vendor_id', 'capture.fps', 'full-frame-rate-playback-intent']);

const keyName = (key: string) =>
  key
    .toLowerCase()
    .replace(/^com\.apple\.quicktime\.|^com\.android\./, '')
    .replace(/-[a-z]{3}$/, '');

/** 3GPP's text boxes in udta: a full box, a language, a UTF-8 or UTF-16 string. */
const THREE_GPP: Record<string, Field> = {
  auth: { label: 'Author', kind: 'identity', confidence: 'confirmed' },
  perf: { label: 'Artist', kind: 'identity', confidence: 'confirmed' },
  titl: { label: 'Title', kind: 'identity', confidence: 'probable' },
  dscp: { label: 'Comment', kind: 'identity', confidence: 'probable' },
  albm: { label: 'Album', kind: 'identity', confidence: 'probable' },
  kywd: { label: 'Keywords', kind: 'identity', confidence: 'probable' },
};

/** A 3GPP string: UTF-16 when it opens with a byte-order mark, UTF-8 otherwise; up to its terminator. */
function gppString(data: Uint8Array, from: number, end: number): { text: string; next: number } {
  if (data[from] === 0xfe && data[from + 1] === 0xff) {
    let stop = from + 2;
    while (stop + 1 < end && (data[stop] !== 0 || data[stop + 1] !== 0)) stop += 2;
    return { text: UTF16.decode(data.subarray(from + 2, stop)), next: stop + 2 };
  }
  let stop = from;
  while (stop < end && data[stop] !== 0) stop++;
  return { text: UTF8.decode(data.subarray(from, stop)), next: stop + 1 };
}

/** 3GPP's location box: a name, a role, then longitude, latitude and altitude in 16.16 fixed point. */
function loci(data: Uint8Array, box: Box): { name: string; position?: string } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const name = gppString(data, box.body + 6, box.end);
  const p = name.next + 1; // past the role
  if (p + 12 > box.end) return { name: name.text };
  const longitude = view.getInt32(p) / 65536;
  const latitude = view.getInt32(p + 4) / 65536;
  const valid = Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0);
  return { name: name.text, position: valid ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : undefined };
}

function field(found: Finding[], spec: Field | undefined, path: string, key: string, text: string): void {
  const value = text.trim();
  if (!value) return;
  if (!spec) {
    found.push({ kind: 'identity', confidence: 'probable', location: at(path), label: 'Media metadata field', value: preview(`${key}: ${value}`, 120) });
    return;
  }
  if (spec.gps) {
    const position = iso6709(value);
    if (position) found.push({ kind: spec.kind, confidence: spec.confidence, location: at(path), label: spec.label, value: position });
    return;
  }
  found.push({ kind: spec.kind, confidence: spec.confidence, location: at(path), label: spec.label, value: preview(value, 120) });
}

function xmp(text: string, path: string): Finding[] {
  return [...findSourceTypes(text, at(path)), ...imageXmpFindings(text, `${at(path)} (XMP)`), { kind: 'identity', confidence: 'informational', location: at(path), label: 'XMP metadata', value: `${text.length} bytes` }];
}

function picture(data: Uint8Array, path: string): Finding[] {
  const found: Finding[] = [{ kind: 'identity', confidence: 'informational', location: at(path), label: 'Embedded picture', value: `${data.length} bytes` }];
  if (detectImageKind(data)) found.push(...inspectImage(data, `${at(path)} picture`).filter((f) => f.confidence !== 'informational'));
  return found;
}

/** A meta box's children: ISO's meta is a full box (four bytes of version and flags first); QuickTime's is not. */
function metaChildren(data: Uint8Array, meta: Box): Box[] {
  const plain = boxes(data, meta.body, meta.end);
  if (plain[0]?.type === 'hdlr') return plain;
  return boxes(data, meta.body + 4, meta.end);
}

/** The mdta key names of a moov/meta, in order (item n names key n, from 1). */
function keyNames(data: Uint8Array, keys: Box): string[] {
  const names: string[] = [];
  for (const entry of boxes(data, keys.body + 8, keys.end)) names.push(UTF8.decode(data.subarray(entry.body, entry.end)));
  return names;
}

function readMeta(data: Uint8Array, meta: Box, path: string, found: Finding[]): void {
  const children = metaChildren(data, meta);
  const keys = children.find((b) => b.type === 'keys');
  const names = keys ? keyNames(data, keys) : [];
  const ilst = children.find((b) => b.type === 'ilst');
  if (!ilst) return;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (const item of boxes(data, ilst.body, ilst.end)) {
    // An mdta item's type is the 1-based index of its key; an iTunes item's, a four-character code.
    const index = view.getUint32(item.start + 4);
    const keyed = names.length && index >= 1 && index <= names.length ? names[index - 1]! : undefined;
    const { text, bytes } = itemValue(data, item);
    if (keyed) {
      const name = keyName(keyed);
      if (text !== undefined && !TECHNICAL_KEYS.has(name)) field(found, KEYS[name], `${path}/${keyed}`, keyed, text);
      continue;
    }
    if (item.type === 'covr' && bytes) {
      found.push(...picture(bytes, `${path}/ilst/covr`));
      continue;
    }
    if (item.type === '----') {
      // A freeform iTunes item: mean, name, data.
      const parts = boxes(data, item.body, item.end);
      const name = parts.find((b) => b.type === 'name');
      const label = name && name.end - name.body > 4 ? UTF8.decode(data.subarray(name.body + 4, name.end)) : 'freeform';
      if (text !== undefined) field(found, undefined, `${path}/ilst/----`, label, text);
      continue;
    }
    if (text !== undefined) field(found, ATOMS[item.type], `${path}/ilst/${item.type}`, item.type, text);
  }
}

function readUdta(data: Uint8Array, udta: Box, path: string, found: Finding[]): void {
  for (const atom of boxes(data, udta.body, udta.end)) {
    const here = `${path}/${atom.type}`;
    if (atom.type === 'meta') readMeta(data, atom, here, found);
    else if (atom.type === 'XMP_') found.push(...xmp(UTF8.decode(data.subarray(atom.body, atom.end)), here));
    else if (atom.type === 'loci') {
      const place = loci(data, atom);
      if (place.position) found.push({ kind: 'identity', confidence: 'confirmed', location: at(here), label: 'GPS position', value: place.position });
      if (place.name.trim()) found.push({ kind: 'identity', confidence: 'confirmed', location: at(here), label: 'Place name', value: preview(place.name, 120) });
    } else if (THREE_GPP[atom.type]) field(found, THREE_GPP[atom.type], here, atom.type, gppString(data, atom.body + 6, atom.end).text);
    else if (atom.type.startsWith('©') || ATOMS[atom.type]) field(found, ATOMS[atom.type], here, atom.type, quicktimeText(data, atom));
  }
}

/** The creation and modification dates of an mvhd, tkhd or mdhd: where they sit and what they say. */
function headerDates(data: Uint8Array, header: Box): Array<{ offset: number; size: 4 | 8; seconds: number }> {
  if (header.end - header.body < 12) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = data[header.body]!;
  if (version === 1) {
    if (header.end - header.body < 20) return [];
    const read = (o: number) => view.getUint32(o) * 2 ** 32 + view.getUint32(o + 4);
    return [
      { offset: header.body + 4, size: 8, seconds: read(header.body + 4) },
      { offset: header.body + 12, size: 8, seconds: read(header.body + 12) },
    ];
  }
  return [
    { offset: header.body + 4, size: 4, seconds: view.getUint32(header.body + 4) },
    { offset: header.body + 8, size: 4, seconds: view.getUint32(header.body + 8) },
  ];
}

/** Everything a movie says about where, who, with what and when. */
export function inspectMovie(data: Uint8Array): Finding[] {
  const found: Finding[] = [];
  const top = boxes(data, 0, data.length);
  for (const box of top) {
    if (box.type === 'uuid' && box.end - box.body >= 16) {
      const id = [...data.subarray(box.body, box.body + 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (id === XMP_UUID) found.push(...xmp(UTF8.decode(data.subarray(box.body + 16, box.end)), 'uuid XMP'));
    }
    if (box.type !== 'moov') continue;
    const walk = (parent: Box, path: string, depth: number) => {
      if (depth > 8) return;
      for (const child of boxes(data, parent.body, parent.end)) {
        const here = `${path}/${child.type}`;
        if (child.type === 'mvhd') {
          const [created, modified] = headerDates(data, child);
          const createdText = created && quicktimeDate(created.seconds);
          const modifiedText = modified && quicktimeDate(modified.seconds);
          if (createdText) found.push({ kind: 'timestamp', confidence: 'probable', location: at(here), label: 'Creation time', value: createdText });
          if (modifiedText && modifiedText !== createdText) found.push({ kind: 'timestamp', confidence: 'probable', location: at(here), label: 'Date modified', value: modifiedText });
        } else if (child.type === 'stsd') {
          // A video track's sample description names its compressor: the encoder, part of the track, kept.
          for (const entry of boxes(data, child.body + 8, child.end)) {
            const name = entry.body + 42;
            if (name + 1 > entry.end || !/^(?:avc[13]|hvc1|hev1|mp4v|av01|vp09|jpeg|apcn|apch|apcs|apco|ap4h)$/.test(entry.type)) continue;
            const length = Math.min(data[name]!, 31, entry.end - name - 1);
            const compressor = LATIN1.decode(data.subarray(name + 1, name + 1 + length)).trim();
            if (compressor) found.push({ kind: 'provenance', confidence: 'informational', location: at(`${here}/${entry.type}`), label: 'Software', value: preview(compressor, 80) });
          }
        } else if (child.type === 'udta') readUdta(data, child, here, found);
        else if (child.type === 'meta') readMeta(data, child, here, found);
        else if (CONTAINERS.has(child.type)) walk(child, here, depth + 1);
      }
    };
    walk(box, 'moov', 0);
  }
  // The same value under two keys (location, location-eng) is said once.
  const seen = new Set<string>();
  const unique = found.filter((f) => {
    const key = `${f.label}\u0000${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Make and model come as two fields; a reader wants one.
  const devices = unique.filter((f) => f.label === 'Camera make and model');
  if (devices.length > 1) {
    const byPlace = new Map<string, string[]>();
    for (const f of devices) byPlace.set(f.location.replace(/\/[^/)]*\)$/, ')'), [...(byPlace.get(f.location.replace(/\/[^/)]*\)$/, ')')) ?? []), f.value]);
    const merged: Finding[] = [...byPlace].map(([location, values]) => {
      const [make, model] = values;
      const joined = make && model && !model.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${model}` : values.join(' ');
      return { kind: 'identity', confidence: 'probable', location, label: 'Camera make and model', value: preview(joined, 120) };
    });
    return [...unique.filter((f) => f.label !== 'Camera make and model'), ...merged];
  }
  return unique;
}

/**
 * The same movie with its metadata boxes turned into free space and its dates
 * set to unknown. Same length; the media data and its offsets untouched.
 */
export function stripMovie(data: Uint8Array): Uint8Array {
  const out = data.slice();
  const free = (box: Box) => {
    out.set([0x66, 0x72, 0x65, 0x65], box.start + 4); // "free"
    out.fill(0, box.body, box.end);
  };
  for (const box of boxes(data, 0, data.length)) {
    if (box.type === 'uuid' && box.end - box.body >= 16) {
      const id = [...data.subarray(box.body, box.body + 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (id === XMP_UUID) free(box);
    }
    if (box.type !== 'moov') continue;
    const walk = (parent: Box, depth: number) => {
      if (depth > 8) return;
      for (const child of boxes(data, parent.body, parent.end)) {
        if (child.type === 'udta' || child.type === 'meta') free(child);
        else if (child.type === 'mvhd' || child.type === 'tkhd' || child.type === 'mdhd') {
          for (const date of headerDates(data, child)) out.fill(0, date.offset, date.offset + date.size);
        } else if (CONTAINERS.has(child.type)) walk(child, depth + 1);
      }
    };
    walk(box, 0);
  }
  return out;
}

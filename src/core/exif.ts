/**
 * The fields of an Exif block, read one by one.
 *
 * [C7] A photograph's Exif used to be reported as "Exif with GPS coordinates,
 * 226 bytes". Cleaning removed it whole, so nothing leaked — but whoever only
 * looked learned nothing about what the file gives away: where the picture
 * was taken, by whom, with which phone, on which computer it was edited. The
 * report names those, with their values.
 *
 * The block is a TIFF structure: directories of 12-byte entries, values that
 * do not fit four bytes stored elsewhere by offset. Every offset is checked
 * against the block and every directory is visited once, so a block that
 * points into itself or past its end yields what it can and stops.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';

const MAX_IFD_ENTRIES = 512;
const MAX_STRING = 1024;

type Value = string | number[];

interface Field {
  tag: number;
  label: string;
  kind: Finding['kind'];
  confidence: Finding['confidence'];
}

/** IFD0: the picture's own directory. */
const IFD0: Field[] = [
  { tag: 0x0131, label: 'Software', kind: 'provenance', confidence: 'informational' },
  { tag: 0x013b, label: 'Artist', kind: 'identity', confidence: 'confirmed' },
  { tag: 0x8298, label: 'Copyright', kind: 'identity', confidence: 'probable' },
  { tag: 0x0132, label: 'Date modified', kind: 'timestamp', confidence: 'probable' },
  { tag: 0x013c, label: 'Computer name', kind: 'environment', confidence: 'probable' },
  { tag: 0x010e, label: 'Image description', kind: 'identity', confidence: 'probable' },
];

/** The Exif sub-directory: capture details. */
const EXIF: Field[] = [
  { tag: 0x9003, label: 'Date taken', kind: 'timestamp', confidence: 'probable' },
  { tag: 0xa434, label: 'Lens', kind: 'identity', confidence: 'probable' },
  { tag: 0xa431, label: 'Camera serial number', kind: 'identity', confidence: 'confirmed' },
  { tag: 0xa435, label: 'Lens serial number', kind: 'identity', confidence: 'confirmed' },
  { tag: 0xa430, label: 'Camera owner', kind: 'identity', confidence: 'confirmed' },
];

const POINTER_EXIF = 0x8769;
const POINTER_GPS = 0x8825;

/** Bytes per component, by TIFF type. */
const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function reader(tiff: Uint8Array) {
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const valid = little || (tiff[0] === 0x4d && tiff[1] === 0x4d);
  const u16 = (at: number): number | undefined => {
    if (at < 0 || at + 2 > tiff.length) return undefined;
    return little ? tiff[at]! | (tiff[at + 1]! << 8) : (tiff[at]! << 8) | tiff[at + 1]!;
  };
  const u32 = (at: number): number | undefined => {
    if (at < 0 || at + 4 > tiff.length) return undefined;
    return little
      ? (tiff[at]! | (tiff[at + 1]! << 8) | (tiff[at + 2]! << 16) | (tiff[at + 3]! << 24)) >>> 0
      : ((tiff[at]! << 24) | (tiff[at + 1]! << 16) | (tiff[at + 2]! << 8) | tiff[at + 3]!) >>> 0;
  };
  return { valid, u16, u32 };
}

function text(bytes: Uint8Array): string {
  // Exif says ASCII; phones write UTF-8 and old Windows tools Latin-1.
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    decoded = new TextDecoder('latin1').decode(bytes);
  }
  // A NUL ends a string, but Copyright keeps photographer and editor apart with one.
  return decoded
    .replace(/(?<!\0)\0+$/, '')
    .split('\0')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' / ');
}

/** One directory's entries, by tag. */
function readIfd(tiff: Uint8Array, at: number): { values: Map<number, Value>; next: number | undefined } | undefined {
  const { u16, u32 } = reader(tiff);
  const count = u16(at);
  if (count === undefined || count > MAX_IFD_ENTRIES) return undefined;
  const values = new Map<number, Value>();
  for (let index = 0; index < count; index++) {
    const entry = at + 2 + index * 12;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const components = u32(entry + 4);
    if (tag === undefined || type === undefined || components === undefined) break;
    const size = SIZES[type];
    if (!size) continue;
    const length = size * components;
    if (length > MAX_STRING * 8) continue;
    const start = length <= 4 ? entry + 8 : u32(entry + 8);
    if (start === undefined || start + length > tiff.length) continue;
    const bytes = tiff.subarray(start, start + length);
    if (type === 2) {
      values.set(tag, text(bytes.subarray(0, MAX_STRING)));
    } else if (type === 3) {
      values.set(tag, Array.from({ length: components }, (_, i) => u16(start + i * 2) ?? 0));
    } else if (type === 4) {
      values.set(tag, Array.from({ length: components }, (_, i) => u32(start + i * 4) ?? 0));
    } else if (type === 5) {
      values.set(
        tag,
        Array.from({ length: components }, (_, i) => {
          const denominator = u32(start + i * 8 + 4) ?? 0;
          return denominator ? (u32(start + i * 8) ?? 0) / denominator : Number.NaN;
        }),
      );
    } else if (type === 1) {
      values.set(tag, Array.from(bytes));
    }
  }
  return { values, next: u32(at + 2 + count * 12) };
}

export interface Exif {
  ifd0: Map<number, Value>;
  exif: Map<number, Value>;
  gps: Map<number, Value>;
}

/** Parse a TIFF block — what follows "Exif\0\0" in a JPEG, or a PNG eXIf chunk. */
export function parseExif(tiff: Uint8Array): Exif | undefined {
  if (tiff.length < 8) return undefined;
  const { valid, u16, u32 } = reader(tiff);
  if (!valid || u16(2) !== 42) return undefined;
  const visited = new Set<number>();
  const directory = (at: number | undefined) => {
    if (at === undefined || at < 8 || visited.has(at)) return undefined;
    visited.add(at);
    return readIfd(tiff, at);
  };
  const first = directory(u32(4));
  if (!first) return undefined;
  const pointer = (tag: number) => {
    const value = first.values.get(tag);
    return Array.isArray(value) ? value[0] : undefined;
  };
  return {
    ifd0: first.values,
    exif: directory(pointer(POINTER_EXIF))?.values ?? new Map(),
    gps: directory(pointer(POINTER_GPS))?.values ?? new Map(),
  };
}

const str = (value: Value | undefined): string | undefined => (typeof value === 'string' && value ? value : undefined);

/** Degrees, minutes, seconds and a hemisphere letter, as one signed number. */
function degrees(value: Value | undefined, reference: Value | undefined, limit: number): number | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.some((n) => !Number.isFinite(n))) return undefined;
  const [d = 0, m = 0, s = 0] = value;
  const result = d + m / 60 + s / 3600;
  if (result > limit) return undefined;
  return /^[SW]/i.test(str(reference) ?? '') ? -result : result;
}

const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');

/** The findings an Exif block gives, each field with its value. */
export function exifFindings(exif: Exif, location: string): Finding[] {
  const findings: Finding[] = [];
  const at = (ifd: string) => `${location} (Exif ${ifd})`;

  const make = str(exif.ifd0.get(0x010f));
  const model = str(exif.ifd0.get(0x0110));
  if (make || model) {
    const camera = make && model && !model.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${model}` : (model ?? make)!;
    findings.push({ kind: 'identity', confidence: 'probable', location: at('IFD0'), label: 'Camera make and model', value: preview(camera, 120) });
  }

  for (const [ifd, fields, values] of [
    ['IFD0', IFD0, exif.ifd0],
    ['Exif', EXIF, exif.exif],
  ] as const) {
    for (const field of fields) {
      const value = str(values.get(field.tag));
      if (value) findings.push({ kind: field.kind, confidence: field.confidence, location: at(ifd), label: field.label, value: preview(value, 200) });
    }
  }

  const offset = str(exif.exif.get(0x9011)) ?? str(exif.exif.get(0x9010));
  if (offset) findings.push({ kind: 'timestamp', confidence: 'probable', location: at('Exif'), label: 'Time zone offset', value: preview(offset, 20) });

  const latitude = degrees(exif.gps.get(2), exif.gps.get(1), 90);
  const longitude = degrees(exif.gps.get(4), exif.gps.get(3), 180);
  if (latitude !== undefined && longitude !== undefined) {
    findings.push({
      kind: 'identity',
      confidence: 'confirmed',
      location: at('GPS'),
      label: 'GPS position',
      value: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
    });
  }
  const altitude = exif.gps.get(6);
  if (Array.isArray(altitude) && Number.isFinite(altitude[0])) {
    const below = Array.isArray(exif.gps.get(5)) && (exif.gps.get(5) as number[])[0] === 1;
    findings.push({ kind: 'identity', confidence: 'probable', location: at('GPS'), label: 'GPS altitude', value: `${below ? '-' : ''}${Math.round(altitude[0]!)} m` });
  }
  const date = str(exif.gps.get(29));
  const time = exif.gps.get(7);
  if (date) {
    const clock = Array.isArray(time) && time.length === 3 && time.every(Number.isFinite) ? ` ${time.map(pad).join(':')} UTC` : '';
    findings.push({ kind: 'timestamp', confidence: 'probable', location: at('GPS'), label: 'GPS date and time', value: `${preview(date, 20)}${clock}` });
  }
  return findings;
}

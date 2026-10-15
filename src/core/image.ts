/**
 * Metadata carried by images, including images embedded inside Office documents.
 *
 * A photograph dropped into a slide keeps everything the camera wrote: GPS
 * coordinates, device serial, owner name, capture time. Clearing the document's
 * own properties does nothing about it, which makes `ppt/media/` one of the
 * places identifying data most reliably survives a "cleaned" file.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';
import { describeC2pa } from './c2pa.js';
import { findSourceTypes } from './sourcetype.js';

const JPEG_SOI = 0xffd8;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type ImageKind = 'jpeg' | 'png';

export function detectImageKind(data: Uint8Array): ImageKind | undefined {
  if (data.length > 2 && ((data[0]! << 8) | data[1]!) === JPEG_SOI) return 'jpeg';
  if (PNG_SIGNATURE.every((byte, i) => data[i] === byte)) return 'png';
  return undefined;
}

/* ------------------------------------------------------------------ JPEG -- */

/**
 * JPEG application segments that carry authorship or capture data.
 * APP0 (JFIF) and APP2 (ICC colour profile) are deliberately absent: removing
 * them changes how the image renders.
 */
const JPEG_STRIP_MARKERS = new Set([
  0xffe1, // APP1  — Exif and XMP
  0xffe3, // APP3  — Meta/PictureInfo
  0xffec, // APP12 — Ducky/PictureInfo
  0xffed, // APP13 — Photoshop IRB, holds IPTC
  0xfffe, // COM   — free-text comment
]);

/**
 * APP11 is where C2PA stores its signed manifest, wrapped in JUMBF boxes.
 * It is handled separately from the list above because the same marker also
 * carries JPEG XT extension data, which is picture information rather than
 * provenance — stripping that unconditionally would degrade HDR images.
 */
const JPEG_APP11 = 0xffeb;

function isJumbf(segment: JpegSegment): boolean {
  // A C2PA APP11 body opens with the "JP" common identifier, then box headers.
  const head = ASCII.decode(segment.body.subarray(0, 64));
  return head.startsWith('JP') && /jumb|jumd|c2pa/i.test(head);
}

interface JpegSegment {
  marker: number;
  start: number;
  end: number;
  body: Uint8Array;
}

/** Walk the marker segments preceding compressed scan data. */
function jpegSegments(data: Uint8Array): { segments: JpegSegment[]; scanStart: number } {
  const segments: JpegSegment[] = [];
  let offset = 2; // Skip SOI.

  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) break;
    const marker = (data[offset]! << 8) | data[offset + 1]!;
    // Start of scan: everything after this is entropy-coded image data.
    if (marker === 0xffda) return { segments, scanStart: offset };
    const length = (data[offset + 2]! << 8) | data[offset + 3]!;
    if (length < 2) break;
    const end = offset + 2 + length;
    if (end > data.length) break;
    segments.push({ marker, start: offset, end, body: data.subarray(offset + 4, end) });
    offset = end;
  }
  return { segments, scanStart: offset };
}

const ASCII = new TextDecoder('latin1');

function describeJpegSegment(
  segment: JpegSegment,
): { label: string; hasGps: boolean; isC2pa?: boolean } | undefined {
  const head = ASCII.decode(segment.body.subarray(0, 32));
  if (segment.marker === 0xffe1) {
    if (head.startsWith('Exif')) {
      // "GPS " appears as an IFD tag name only in the raw TIFF structure, so
      // look for the GPSInfo tag id (0x8825) instead.
      const hasGps = containsUint16(segment.body, 0x8825);
      return { label: hasGps ? 'Exif with GPS coordinates' : 'Exif camera data', hasGps };
    }
    if (head.includes('http://ns.adobe.com/xap')) return { label: 'XMP metadata', hasGps: false };
    return { label: 'APP1 metadata', hasGps: false };
  }
  if (segment.marker === 0xffed) return { label: 'IPTC/Photoshop metadata', hasGps: false };
  if (segment.marker === 0xfffe) return { label: 'Embedded comment', hasGps: false };
  if (segment.marker === JPEG_APP11 && isJumbf(segment)) {
    return { label: 'C2PA content credentials', hasGps: false, isC2pa: true };
  }
  if (JPEG_STRIP_MARKERS.has(segment.marker)) return { label: 'Application metadata', hasGps: false };
  return undefined;
}

/** Segments removed by {@link stripImageMetadata}. */
function shouldStrip(segment: JpegSegment): boolean {
  if (JPEG_STRIP_MARKERS.has(segment.marker)) return true;
  return segment.marker === JPEG_APP11 && isJumbf(segment);
}

/** Scan for a 16-bit value in both byte orders, since TIFF headers vary. */
function containsUint16(data: Uint8Array, value: number): boolean {
  const hi = (value >> 8) & 0xff;
  const lo = value & 0xff;
  for (let i = 0; i + 1 < data.length; i++) {
    if ((data[i] === hi && data[i + 1] === lo) || (data[i] === lo && data[i + 1] === hi)) return true;
  }
  return false;
}

function stripJpeg(data: Uint8Array): Uint8Array<ArrayBuffer> | undefined {
  const { segments, scanStart } = jpegSegments(data);
  const keep = segments.filter((s) => !shouldStrip(s));
  if (keep.length === segments.length) return undefined;

  let size = 2 + (data.length - scanStart);
  for (const segment of keep) size += segment.end - segment.start;

  const out = new Uint8Array(size);
  out[0] = 0xff;
  out[1] = 0xd8;
  let cursor = 2;
  for (const segment of keep) {
    out.set(data.subarray(segment.start, segment.end), cursor);
    cursor += segment.end - segment.start;
  }
  out.set(data.subarray(scanStart), cursor);
  return out;
}

/* ------------------------------------------------------------------- PNG -- */

/** PNG ancillary chunks holding text, timestamps, Exif or a C2PA manifest. */
const PNG_STRIP_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME', 'caBX']);

interface PngChunk {
  type: string;
  start: number;
  end: number;
}

function pngChunks(data: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8; // Skip signature.

  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset);
    const type = ASCII.decode(data.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (end > data.length) break;
    chunks.push({ type, start: offset, end });
    if (type === 'IEND') break;
    offset = end;
  }
  return chunks;
}

function stripPng(data: Uint8Array): Uint8Array<ArrayBuffer> | undefined {
  const chunks = pngChunks(data);
  const keep = chunks.filter((c) => !PNG_STRIP_CHUNKS.has(c.type));
  if (keep.length === chunks.length) return undefined;
  let size = 8;
  for (const chunk of keep) size += chunk.end - chunk.start;

  const out = new Uint8Array(size);
  out.set(data.subarray(0, 8), 0);
  let cursor = 8;
  for (const chunk of keep) {
    out.set(data.subarray(chunk.start, chunk.end), cursor);
    cursor += chunk.end - chunk.start;
  }
  return out;
}

/**
 * Image generators that write their own settings into a text chunk.
 *
 * Every one of these stores the prompt in clear. That is the leak: a prompt is
 * the author's working notes, often naming the client, the person depicted, the
 * style being imitated or the model and LoRA used, and it travels with the file
 * to anyone who opens it in a metadata viewer. The chunk is also what proves
 * the picture was generated at all, which is the other half of why it matters.
 *
 * Matched on the keyword rather than on the body, because the keyword is what
 * each tool fixes and the body is free text.
 */
const GENERATOR_KEYWORDS = new Map<string, string>([
  ['parameters', 'Stable Diffusion web UI (AUTOMATIC1111)'],
  ['prompt', 'ComfyUI'],
  ['workflow', 'ComfyUI'],
  ['sd-metadata', 'InvokeAI'],
  ['invokeai_metadata', 'InvokeAI'],
  ['invokeai_graph', 'InvokeAI'],
  ['dream', 'InvokeAI (legacy)'],
  ['comfy', 'ComfyUI'],
  ['aiart', 'AI image generator'],
]);

/**
 * The keyword of a PNG text chunk, and the text after it.
 *
 * tEXt is `keyword\0text`. iTXt adds a compression flag, a method byte and two
 * language fields between them; zTXt compresses the text, so only its keyword
 * is readable here, which is enough to name the tool.
 */
function pngTextKeyword(type: string, body: Uint8Array): { keyword: string; text: string } {
  const nul = body.indexOf(0);
  if (nul < 0) return { keyword: '', text: '' };
  const keyword = ASCII.decode(body.subarray(0, nul));
  if (type === 'tEXt') return { keyword, text: ASCII.decode(body.subarray(nul + 1)) };
  if (type === 'iTXt') {
    // keyword \0 flag method langTag \0 translatedKeyword \0 text
    let cursor = nul + 3;
    for (let seen = 0; seen < 2 && cursor < body.length; cursor++) {
      if (body[cursor] === 0) seen++;
    }
    return { keyword, text: ASCII.decode(body.subarray(cursor)) };
  }
  return { keyword, text: '' };
}

/** A generation chunk, reported with the tool named and the prompt called out. */
function describeGenerator(
  type: string,
  body: Uint8Array,
  location: string,
): Finding | undefined {
  const { keyword, text } = pngTextKeyword(type, body);
  const tool = GENERATOR_KEYWORDS.get(keyword.toLowerCase());
  if (!tool) return undefined;

  // The first line of an AUTOMATIC1111 "parameters" block is the prompt itself;
  // ComfyUI stores a JSON graph. Either way the opening is the useful preview.
  const opening = text.trim().split('\n')[0] ?? '';
  return {
    kind: 'provenance',
    confidence: 'confirmed',
    location: `${location} (${type}:${keyword})`,
    label: 'Image generation settings, including the prompt',
    value:
      `written by ${tool}` +
      (opening ? ` — begins "${preview(opening, 70)}"` : '') +
      '. The prompt, the model and the seed travel with the file',
  };
}

/* ---------------------------------------------------------------- public -- */

/**
 * Report the metadata an image carries. `location` prefixes the part path when
 * the image is embedded in a document.
 */
export function inspectImage(data: Uint8Array, location: string): Finding[] {
  const kind = detectImageKind(data);
  if (!kind) return [];
  const findings: Finding[] = [];

  if (kind === 'jpeg') {
    for (const segment of jpegSegments(data).segments) {
      const described = describeJpegSegment(segment);
      if (!described) continue;
      if (described.isC2pa) {
        findings.push(...describeC2pa(ASCII.decode(segment.body), location, segment.body));
        continue;
      }
      // A generator that declares itself does it here, in the XMP packet.
      findings.push(...findSourceTypes(ASCII.decode(segment.body), location));
      findings.push({
        kind: 'identity',
        // GPS coordinates place the author somewhere specific; the rest is
        // device and capture data that is identifying but less pointed.
        confidence: described.hasGps ? 'confirmed' : 'probable',
        location,
        label: described.label,
        value: `${segment.end - segment.start} bytes`,
      });
    }
    return findings;
  }

  for (const chunk of pngChunks(data)) {
    if (!PNG_STRIP_CHUNKS.has(chunk.type)) continue;
    if (chunk.type === 'caBX') {
      const body = data.subarray(chunk.start + 8, chunk.end - 4);
      findings.push(...describeC2pa(ASCII.decode(body), location, body));
      continue;
    }
    const body = data.subarray(chunk.start + 8, chunk.end - 4);
    findings.push(...findSourceTypes(ASCII.decode(body), location));
    const generator = describeGenerator(chunk.type, body, location);
    if (generator) {
      findings.push(generator);
      continue;
    }
    findings.push({
      kind: chunk.type === 'tIME' ? 'timestamp' : 'identity',
      confidence: chunk.type === 'eXIf' ? 'confirmed' : 'probable',
      location,
      label: chunk.type === 'eXIf' ? 'Exif camera data' : `PNG ${chunk.type} chunk`,
      value: `${chunk.end - chunk.start} bytes`,
    });
  }
  return findings;
}

/**
 * Return a stripped copy of the image, or `undefined` when there was nothing to
 * remove. Reporting "unchanged" explicitly is more reliable than having the
 * caller compare lengths, since a removal can coincidentally preserve size.
 */
export function stripImageMetadata(data: Uint8Array): Uint8Array<ArrayBuffer> | undefined {
  const kind = detectImageKind(data);
  if (kind === 'jpeg') return stripJpeg(data);
  if (kind === 'png') return stripPng(data);
  return undefined;
}


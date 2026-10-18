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
import { exifFindings, parseExif } from './exif.js';
import { imageXmpFindings } from './xmp.js';
import { Unzlib } from 'fflate';

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

/*
 * The embedded preview, and why it is worth a finding of its own.
 *
 * Exif keeps a second, small copy of the picture in its own directory (IFD1).
 * Editors are inconsistent about regenerating it: crop a photograph, save, and
 * a surprising number of tools leave the preview showing the picture as it was
 * before the crop. People have published photographs cropped to hide something
 * and shipped the uncropped version inside the same file.
 *
 * Cleaning already removes it — APP1 goes whole, and the preview goes with it —
 * so this exists to tell someone who is only looking.
 */

/** Start-of-frame markers, which is where a JPEG states its size. */
const SOF_MARKERS = new Set([
  0xffc0, 0xffc1, 0xffc2, 0xffc3, 0xffc5, 0xffc6, 0xffc7,
  0xffc9, 0xffca, 0xffcb, 0xffcd, 0xffce, 0xffcf,
]);

interface Size {
  width: number;
  height: number;
}

function jpegSize(data: Uint8Array): Size | undefined {
  for (const segment of jpegSegments(data).segments) {
    if (!SOF_MARKERS.has(segment.marker)) continue;
    // Body is precision, then height and width, each 16-bit big-endian.
    if (segment.body.length < 5) continue;
    const height = (segment.body[1]! << 8) | segment.body[2]!;
    const width = (segment.body[3]! << 8) | segment.body[4]!;
    if (width > 0 && height > 0) return { width, height };
  }
  return undefined;
}

/*
 * A fixed-size preview is not evidence of anything. Cameras have written
 * 160x120 for decades regardless of the sensor's shape, so a 3:2 photograph
 * from an untouched DSLR carries a 4:3 preview and always has. Flagging that
 * would put a warning on a large share of ordinary holiday photographs, which
 * is how a check like this gets switched off. A preview at any other size was
 * generated for this picture, and then its shape means something.
 */
const STANDARD_PREVIEW: ReadonlyArray<Size> = [
  { width: 160, height: 120 },
  { width: 120, height: 160 },
];

const RATIO_TOLERANCE = 0.05;
const MAX_IFD_ENTRIES = 512;

/** The preview image an Exif APP1 segment carries, if it carries one. */
function exifPreview(body: Uint8Array): { size?: Size; bytes: number } | undefined {
  if (ASCII.decode(body.subarray(0, 4)) !== 'Exif') return undefined;
  const tiff = body.subarray(6); // past "Exif\0\0"
  if (tiff.length < 8) return undefined;

  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return undefined;

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

  if (u16(2) !== 42) return undefined;

  const ifd0 = u32(4);
  const entries0 = ifd0 === undefined ? undefined : u16(ifd0);
  if (ifd0 === undefined || entries0 === undefined || entries0 > MAX_IFD_ENTRIES) return undefined;

  // The pointer to the next directory sits immediately past IFD0's entries.
  const ifd1 = u32(ifd0 + 2 + entries0 * 12);
  const entries1 = ifd1 === undefined || ifd1 === 0 ? undefined : u16(ifd1);
  if (ifd1 === undefined || entries1 === undefined || entries1 > MAX_IFD_ENTRIES) return undefined;

  let offset: number | undefined;
  let length: number | undefined;
  let width: number | undefined;
  let height: number | undefined;

  for (let index = 0; index < entries1; index++) {
    const at = ifd1 + 2 + index * 12;
    const tag = u16(at);
    const type = u16(at + 2);
    if (tag === undefined || type === undefined) break;
    // A SHORT is left-justified in the 4-byte value field in both byte orders,
    // so it reads from the same place a LONG does.
    const value = type === 3 ? u16(at + 8) : u32(at + 8);
    if (value === undefined) break;
    if (tag === 0x0100) width = value;
    else if (tag === 0x0101) height = value;
    else if (tag === 0x0201) offset = value;
    else if (tag === 0x0202) length = value;
  }

  if (offset !== undefined && length !== undefined && length > 0) {
    if (offset + length > tiff.length) return undefined;
    const jpeg = tiff.subarray(offset, offset + length);
    return { size: jpegSize(jpeg), bytes: length };
  }
  if (width !== undefined && height !== undefined && width > 0 && height > 0) {
    return { size: { width, height }, bytes: 0 };
  }
  return undefined;
}

function isStandardPreview(size: Size): boolean {
  return STANDARD_PREVIEW.some((s) => s.width === size.width && s.height === size.height);
}

function previewFindings(data: Uint8Array, body: Uint8Array, location: string): Finding[] {
  const preview_ = exifPreview(body);
  if (!preview_) return [];

  const picture = jpegSize(data);
  const size = preview_.size;
  const described = size ? `${size.width}\u00d7${size.height}` : 'of unknown size';
  const weight = preview_.bytes ? `, ${preview_.bytes} bytes` : '';

  if (size && picture && !isStandardPreview(size)) {
    const previewRatio = size.width / size.height;
    const pictureRatio = picture.width / picture.height;
    const drift = Math.abs(previewRatio - pictureRatio) / pictureRatio;
    if (drift > RATIO_TOLERANCE) {
      return [
        {
          kind: 'identity',
          confidence: 'probable',
          location,
          label: 'Embedded preview is a different shape from the picture',
          value:
            `preview ${described}${weight}, picture ${picture.width}\u00d7${picture.height} — ` +
            `cropping changes the picture and not always the preview, so this one may still show ` +
            `what was cropped away`,
        },
      ];
    }
  }

  return [
    {
      kind: 'identity',
      confidence: 'informational',
      location,
      label: 'Embedded preview image',
      value:
        `${described}${weight} — a second copy of the picture, which not every editor regenerates ` +
        `when the original is cropped or retouched`,
    },
  ];
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

/** Text as a tool wrote it: the spec says Latin-1 for tEXt, tools often write UTF-8. */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return ASCII.decode(bytes);
  }
}

/** Decompressed text is capped: a few kilobytes of zeros inflate to gigabytes. */
const MAX_INFLATED = 1024 * 1024;

function inflate(bytes: Uint8Array): Uint8Array | undefined {
  const pieces: Uint8Array[] = [];
  let total = 0;
  let over = false;
  const stream = new Unzlib((chunk) => {
    total += chunk.length;
    if (total > MAX_INFLATED) over = true;
    else pieces.push(chunk);
  });
  try {
    // Fed in small slices so no single push can expand past the cap by much.
    for (let at = 0; at < bytes.length && !over; at += 1024) {
      stream.push(bytes.subarray(at, at + 1024), at + 1024 >= bytes.length);
    }
  } catch {
    return undefined;
  }
  if (over) return undefined;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const piece of pieces) {
    out.set(piece, cursor);
    cursor += piece.length;
  }
  return out;
}

/**
 * The keyword of a PNG text chunk, and the text after it.
 *
 * tEXt is `keyword\0text`. iTXt adds a compression flag, a method byte and two
 * language fields between them; zTXt compresses the text. Compressed text is
 * inflated under a cap; past it, only the keyword is known.
 */
function pngTextKeyword(type: string, body: Uint8Array): { keyword: string; text: string } {
  const nul = body.indexOf(0);
  if (nul < 0) return { keyword: '', text: '' };
  const keyword = ASCII.decode(body.subarray(0, nul));
  if (type === 'tEXt') return { keyword, text: decodeText(body.subarray(nul + 1)) };
  if (type === 'zTXt') {
    // keyword \0 method compressed-text
    const inflated = inflate(body.subarray(nul + 2));
    return { keyword, text: inflated ? decodeText(inflated) : '' };
  }
  if (type === 'iTXt') {
    // keyword \0 flag method langTag \0 translatedKeyword \0 text
    const compressed = body[nul + 1] === 1;
    let cursor = nul + 3;
    for (let seen = 0; seen < 2 && cursor < body.length; cursor++) {
      if (body[cursor] === 0) seen++;
    }
    const raw = body.subarray(cursor);
    const bytes = compressed ? inflate(raw) : raw;
    return { keyword, text: bytes ? new TextDecoder().decode(bytes) : '' };
  }
  return { keyword, text: '' };
}

/**
 * [C7] The keywords the PNG specification defines, each reported with its
 * value. Anything else a tool writes is shown too, under its own keyword.
 */
const PNG_TEXT_FIELDS = new Map<string, { label: string; kind: Finding['kind']; confidence: Finding['confidence'] }>([
  ['author', { label: 'Author', kind: 'identity', confidence: 'confirmed' }],
  ['copyright', { label: 'Copyright', kind: 'identity', confidence: 'probable' }],
  ['title', { label: 'Title', kind: 'identity', confidence: 'probable' }],
  ['description', { label: 'Description', kind: 'identity', confidence: 'probable' }],
  ['comment', { label: 'Comment', kind: 'identity', confidence: 'probable' }],
  ['source', { label: 'Source device', kind: 'identity', confidence: 'probable' }],
  ['software', { label: 'Software', kind: 'provenance', confidence: 'informational' }],
  ['creation time', { label: 'Creation time', kind: 'timestamp', confidence: 'probable' }],
  ['disclaimer', { label: 'Disclaimer', kind: 'identity', confidence: 'informational' }],
  ['warning', { label: 'Warning', kind: 'identity', confidence: 'informational' }],
]);

const XMP_KEYWORD = 'XML:com.adobe.xmp';

/** A text chunk's findings: its XMP packet's fields, or the field it is. */
function pngTextFindings(type: string, body: Uint8Array, location: string): Finding[] {
  const { keyword, text } = pngTextKeyword(type, body);
  const where = `${location} (${type}:${keyword})`;
  if (keyword === XMP_KEYWORD) return text ? imageXmpFindings(text, where) : [];
  const value = text.trim();
  if (!keyword || !value) return [];
  const field = PNG_TEXT_FIELDS.get(keyword.toLowerCase());
  if (field) return [{ ...field, location: where, value: preview(value, 200) }];
  return [{ kind: 'identity', confidence: 'probable', location: where, label: 'PNG text field', value: preview(`${keyword}: ${value}`, 200) }];
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

/** The fields an APP1 segment carries: Exif, or an XMP packet. */
function app1Fields(body: Uint8Array, location: string): Finding[] {
  if (ASCII.decode(body.subarray(0, 6)) === 'Exif\0\0') {
    const exif = parseExif(body.subarray(6));
    return exif ? exifFindings(exif, location) : [];
  }
  const nul = body.indexOf(0);
  if (nul > 0 && ASCII.decode(body.subarray(0, nul)).startsWith('http://ns.adobe.com/xap/')) {
    return imageXmpFindings(new TextDecoder().decode(body.subarray(nul + 1)), `${location} (XMP)`);
  }
  return [];
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
      const fields = segment.marker === 0xffe1 ? app1Fields(segment.body, location) : [];
      if (segment.marker === 0xffe1) {
        findings.push(...fields, ...previewFindings(data, segment.body, location));
      }
      findings.push({
        kind: 'identity',
        // GPS coordinates place the author somewhere specific; the rest is
        // device and capture data that is identifying but less pointed. Once
        // the fields are read and reported on their own, the segment is only
        // the size of what cleaning removes.
        confidence: fields.length ? 'informational' : described.hasGps ? 'confirmed' : 'probable',
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
    if (chunk.type === 'eXIf') {
      const exif = parseExif(body);
      const fields = exif ? exifFindings(exif, location) : [];
      findings.push(...fields, {
        kind: 'identity',
        confidence: fields.length ? 'informational' : 'confirmed',
        location,
        label: 'Exif camera data',
        value: `${chunk.end - chunk.start} bytes`,
      });
      continue;
    }
    if (chunk.type !== 'tIME') {
      const fields = pngTextFindings(chunk.type, body, location);
      if (fields.length) {
        findings.push(...fields);
        continue;
      }
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


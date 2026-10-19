/**
 * [F-P2 2.4] Re-encoding a picture from its decoded pixels.
 *
 * Stripping metadata removes the segments and chunks Cirta knows about.
 * Re-encoding goes further: the picture is decoded and written again, so
 * whatever is not pixels is gone — data after the end of the image, private
 * segments and chunks, comments, thumbnails. The EXIF orientation is applied
 * to the pixels (the decoder does it), so the picture looks the same without
 * the tag. The ICC profile is copied back, or colours would shift.
 *
 * What it does not do: a lossless PNG keeps every pixel value, so a message
 * hidden in their low bits survives. A JPEG is quantised again, which
 * disturbs such a message without guaranteeing it is gone.
 *
 * The decoder comes from outside, as the PDF renderer does: a native canvas
 * on the command line, the browser's in the page.
 */

import type { ImageKind } from './image.js';

export interface ImageCodec {
  /** Decode with the EXIF orientation applied, encode again with no metadata. */
  reencode(data: Uint8Array, kind: ImageKind): Promise<Uint8Array>;
}

const ICC_HEADER = new TextEncoder().encode('ICC_PROFILE\0');

/** The APP2 segments that carry an ICC profile, as they are. */
function jpegIcc(data: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 2;
  while (at + 4 <= data.length && data[at] === 0xff) {
    const marker = data[at + 1]!;
    if (marker === 0xda || marker === 0xd9) break;
    const end = at + 2 + ((data[at + 2]! << 8) | data[at + 3]!);
    if (end > data.length) break;
    if (marker === 0xe2 && ICC_HEADER.every((b, i) => data[at + 4 + i] === b)) out.push(data.subarray(at, end));
    at = end;
  }
  return out;
}

/** The iCCP chunk, as it is. */
function pngIcc(data: Uint8Array): Uint8Array[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 8;
  while (at + 12 <= data.length) {
    const end = at + 12 + view.getUint32(at);
    if (end > data.length) break;
    const type = String.fromCharCode(...data.subarray(at + 4, at + 8));
    if (type === 'iCCP') return [data.subarray(at, end)];
    if (type === 'IDAT' || type === 'IEND') break;
    at = end;
  }
  return [];
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

/** The profile goes back where a reader looks for it: right after SOI (JPEG), right after IHDR (PNG). */
function withIcc(encoded: Uint8Array, kind: ImageKind, icc: Uint8Array[]): Uint8Array {
  if (!icc.length) return encoded;
  if (kind === 'jpeg') {
    // After the JFIF APP0 an encoder writes first, if any.
    let at = 2;
    if (encoded[2] === 0xff && encoded[3] === 0xe0) at = 4 + ((encoded[4]! << 8) | encoded[5]!);
    return concat([encoded.subarray(0, at), ...icc, encoded.subarray(at)]);
  }
  const ihdrEnd = 8 + 12 + new DataView(encoded.buffer, encoded.byteOffset).getUint32(8);
  // An encoder that wrote its own profile (sRGB, gAMA…) keeps it; the original's goes first.
  return concat([encoded.subarray(0, ihdrEnd), ...icc, encoded.subarray(ihdrEnd)]);
}

export async function reencodeImage(data: Uint8Array, kind: ImageKind, codec: ImageCodec): Promise<Uint8Array> {
  const icc = kind === 'jpeg' ? jpegIcc(data) : pngIcc(data);
  return withIcc(await codec.reencode(data, kind), kind, icc);
}

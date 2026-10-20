import { describe, expect, it } from 'vitest';
import { inspectFile, redactFile } from '../src/core/index.js';
import { parseExif } from '../src/core/exif.js';

/*
 * A phone stores a photo as the sensor saw it and says in Exif how to turn
 * it. Cleaning took the whole Exif block, orientation included, so a portrait
 * came out lying on its side. The orientation is now written back, alone:
 * it changes how the picture is drawn and says nothing about anyone.
 */

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

/** A JPEG whose Exif names the photographer and says "rotate 90° clockwise" (6). */
function photo(orientation: number): Uint8Array {
  const artist = [...new TextEncoder().encode('Camille Durand'), 0];
  // TIFF, big-endian: header, IFD0 with two entries, then the artist's name.
  const ifdOffset = 8;
  const count = 2;
  const dataOffset = ifdOffset + 2 + count * 12 + 4;
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, ...be32(ifdOffset),
    ...be16(count),
    ...be16(0x0112), ...be16(3), ...be32(1), ...be16(orientation), 0, 0,
    ...be16(0x013b), ...be16(2), ...be32(artist.length), ...be32(dataOffset),
    ...be32(0),
    ...artist,
  ];
  const exif = [...new TextEncoder().encode('Exif'), 0, 0, ...tiff];
  const app1 = [0xff, 0xe1, ...be16(exif.length + 2), ...exif];
  const sof = [0xff, 0xc0, ...be16(11), 8, ...be16(10), ...be16(20), 1, 0x11, 0x00];
  const sos = [0xff, 0xda, ...be16(8), 1, 1, 0x00, 0x00, 0x3f, 0x00, 0x00];
  return new Uint8Array([0xff, 0xd8, ...app1, ...sof, ...sos, 0x00, 0xff, 0xd9]);
}

/** The orientation the cleaned file's Exif gives, if it has one. */
function orientationOf(jpeg: Uint8Array): number | undefined {
  for (let at = 2; at + 4 < jpeg.length; ) {
    const marker = (jpeg[at]! << 8) | jpeg[at + 1]!;
    if (marker === 0xffda) return undefined;
    const length = (jpeg[at + 2]! << 8) | jpeg[at + 3]!;
    const body = jpeg.subarray(at + 4, at + 2 + length);
    if (marker === 0xffe1 && new TextDecoder('latin1').decode(body.subarray(0, 6)) === 'Exif\0\0') {
      const value = parseExif(body.subarray(6))?.ifd0.get(0x0112);
      return Array.isArray(value) ? value[0] : undefined;
    }
    at += 2 + length;
  }
  return undefined;
}

describe('cleaning a JPEG keeps the way it is turned', () => {
  it('a photo to turn 90° keeps that orientation, and nothing else of its Exif', async () => {
    const before = photo(6);
    expect((await inspectFile(before, 'photo.jpg')).findings.some((f) => f.value.includes('Camille Durand'))).toBe(true);
    const cleaned = await redactFile(before, 'photo.jpg');
    expect(orientationOf(cleaned.data)).toBe(6);
    expect(new TextDecoder('latin1').decode(cleaned.data)).not.toContain('Camille');
    const after = await inspectFile(cleaned.data, 'photo.jpg');
    expect(after.findings.filter((f) => f.kind === 'identity' || f.kind === 'location' || f.kind === 'device')).toEqual([]);
  });

  it('a photo already upright gets no Exif back', async () => {
    const cleaned = await redactFile(photo(1), 'photo.jpg');
    expect(orientationOf(cleaned.data)).toBeUndefined();
  });

  it('cleaning twice gives the same bytes', async () => {
    const once = await redactFile(photo(8), 'photo.jpg');
    const twice = await redactFile(once.data, 'photo.jpg');
    expect(Buffer.from(twice.data).equals(Buffer.from(once.data))).toBe(true);
  });
});

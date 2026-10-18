import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { inspectFile, redactFile, UnsupportedFormatError } from '../src/core/index.js';
import { encodePng } from '../src/core/png.js';
import { nodeImageCodec } from '../src/cli/image-codec.js';
import { png, tEXt } from './helpers/tiff.js';
import { deflateSync } from 'node:zlib';

/*
 * [F-P2 2.4] Re-encoding a picture from its decoded pixels: whatever is not
 * pixels goes — data after the end of the image, unknown segments, comments —
 * the EXIF orientation is applied to the pixels, and the ICC profile stays.
 */

const enc = (s: string) => [...new TextEncoder().encode(s)];
const segment = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];

/** A fake but well-formed ICC payload: what matters here is that the bytes come back. */
const ICC = [...new Uint8Array(132).map((_, i) => (i * 7) & 0xff)];

async function orientedJpeg(): Promise<Uint8Array> {
  const canvas = createCanvas(40, 20);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 20, 20);
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(20, 0, 20, 20);
  const base = new Uint8Array(await canvas.encode('jpeg', 95));
  const tiff = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0];
  return new Uint8Array([
    0xff, 0xd8,
    ...segment(0xe1, [...enc('Exif\0\0'), ...tiff]),
    ...segment(0xe2, [...enc('ICC_PROFILE\0'), 1, 1, ...ICC]),
    ...segment(0xfe, enc('secret de fabrication')),
    ...segment(0xeb, enc('JP\0\0private')),
    ...base.subarray(2),
    ...enc('PK\x03\x04 une archive collée après la fin'),
  ]);
}

describe('[F-P2 2.4] data after the end of a picture', () => {
  it('is reported, and taken out by an ordinary clean', async () => {
    const jpeg = await orientedJpeg();
    const found = (await inspectFile(jpeg, 'a.jpg')).findings;
    expect(found.find((f) => f.label === 'Data after the end of the image')?.value).toBe(`${enc('PK\x03\x04 une archive collée après la fin').length} bytes after the image ends`);
    const cleaned = (await redactFile(jpeg, 'a.jpg')).data!;
    expect(Buffer.from(cleaned).includes(Buffer.from('collée'))).toBe(false);
    expect((await inspectFile(cleaned, 'a.jpg')).findings.some((f) => f.label === 'Data after the end of the image')).toBe(false);

    const png = encodePng(new Uint8Array(4 * 4 * 4).fill(200), 4, 4);
    const tail = new Uint8Array([...png, ...enc('caché après IEND')]);
    expect((await inspectFile(tail, 'a.png')).findings.find((f) => f.label === 'Data after the end of the image')?.value).toBe(`${enc('caché après IEND').length} bytes after the image ends`);
  });
});

describe('[F-P2 2.4] re-encoding pictures', () => {
  it('rebuilds a JPEG from its pixels: orientation applied, ICC kept, everything else gone', async () => {
    const result = await redactFile(await orientedJpeg(), 'a.jpg', { reencodeImages: true, imageCodec: await nodeImageCodec() });
    const out = Buffer.from(result.data!);
    expect(out.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(out.includes(Buffer.from('ICC_PROFILE\0'))).toBe(true);
    expect(out.includes(Buffer.from(ICC))).toBe(true);
    for (const gone of ['Exif\0\0', 'secret de fabrication', 'JP\0\0private', 'collée']) expect(out.includes(Buffer.from(gone)), gone).toBe(false);
    // Orientation 6 turns the 40×20 picture into a 20×40 one; red ends up on top.
    const image = await loadImage(out);
    expect([image.width, image.height]).toEqual([20, 40]);
    const ctx = createCanvas(20, 40).getContext('2d');
    ctx.drawImage(image, 0, 0);
    const [r, , b] = ctx.getImageData(10, 5, 1, 1).data;
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(60);
    expect(result.notes).toContainEqual({ code: 'reencoded:image' });
  });

  it('rebuilds a PNG and keeps its colour profile chunk, nothing else', async () => {
    const profile = new Uint8Array([...enc('sRGB\0'), 0, ...deflateSync(new Uint8Array(ICC))]);
    const source = png({ type: 'iCCP', data: profile }, tEXt('Comment', 'secret de fabrication'));
    const result = await redactFile(source, 'a.png', { reencodeImages: true, imageCodec: await nodeImageCodec() });
    const out = Buffer.from(result.data!);
    expect(out.subarray(1, 4).toString()).toBe('PNG');
    expect(out.includes(Buffer.concat([Buffer.from('iCCP'), Buffer.from(profile)]))).toBe(true);
    expect(out.includes(Buffer.from('secret de fabrication'))).toBe(false);
    expect(result.notes).toContainEqual({ code: 'reencoded:image' });
  });

  it('refuses rather than skip the re-encoding when no codec is available', async () => {
    const error = await redactFile(await orientedJpeg(), 'a.jpg', { reencodeImages: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedFormatError);
    expect((error as UnsupportedFormatError).code).toBe('reencode-unavailable');
  });
});

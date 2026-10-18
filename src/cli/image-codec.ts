/**
 * [F-P2 2.4] The picture codec for Node: the same native canvas as the PDF
 * renderer. It decodes with the EXIF orientation applied and encodes with no
 * metadata at all. Missing — the canvas is an optional dependency — and
 * re-encoding is refused rather than skipped.
 */

import type { ImageCodec } from '../core/reencode.js';

let cached: Promise<ImageCodec | undefined> | undefined;

export function nodeImageCodec(): Promise<ImageCodec | undefined> {
  cached ??= build().catch(() => undefined);
  return cached;
}

async function build(): Promise<ImageCodec> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  return {
    async reencode(data, kind) {
      const image = await loadImage(Buffer.from(data));
      const canvas = createCanvas(image.width, image.height);
      canvas.getContext('2d').drawImage(image, 0, 0);
      return new Uint8Array(kind === 'jpeg' ? await canvas.encode('jpeg', 92) : await canvas.encode('png'));
    },
  };
}

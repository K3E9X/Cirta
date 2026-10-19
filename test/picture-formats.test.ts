import { describe, expect, it } from 'vitest';
import { loadImage } from '@napi-rs/canvas';
import { detectFormat, inspectFile, redactFile, UnsupportedFormatError } from '../src/core/index.js';
import { encoded, gifWithMetadata, heifWithMetadata, tiffWithMetadata, webpWithMetadata } from './helpers/pictures.js';

const labels = (findings: Array<{ label: string; value: string }>) => findings.map((f) => `${f.label}: ${f.value}`);
const has = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text));

describe('[F-P2 2.2] more picture formats', () => {
  it('tells WebP, GIF, TIFF, HEIC and AVIF by their first bytes', async () => {
    expect(detectFormat(await encoded('webp'))).toBe('webp');
    expect(detectFormat(await encoded('gif'))).toBe('gif');
    expect(detectFormat(await encoded('avif'))).toBe('avif');
    expect(detectFormat(tiffWithMetadata())).toBe('tiff');
    expect(detectFormat(heifWithMetadata('heic'))).toBe('heic');
  });

  it('reads EXIF and XMP from a WebP, and cleans them out of a copy that still decodes', async () => {
    const webp = await webpWithMetadata();
    const found = labels((await inspectFile(webp, 'a.webp')).findings);
    expect(found).toEqual(expect.arrayContaining(['Artist: Jeanne Dupont', 'XMP author: Marc Leroy']));
    expect(found.some((f) => f.startsWith('GPS position: '))).toBe(true);

    const cleaned = (await redactFile(webp, 'a.webp')).data!;
    expect(has(cleaned, 'Jeanne') || has(cleaned, 'Marc Leroy')).toBe(false);
    // The VP8X flags no longer announce what is gone, and the RIFF size is the file's.
    expect(cleaned[20]! & 0x0c).toBe(0);
    expect(new DataView(cleaned.buffer, cleaned.byteOffset).getUint32(4, true)).toBe(cleaned.length - 8);
    const image = await loadImage(Buffer.from(cleaned));
    expect([image.width, image.height]).toEqual([12, 8]);
    expect((await inspectFile(cleaned, 'a.webp')).findings.filter((f) => f.confidence !== 'informational')).toEqual([]);
  });

  it('reads a GIF’s comment and XMP, and cleans them out of a copy that still decodes', async () => {
    const gif = await gifWithMetadata();
    const found = labels((await inspectFile(gif, 'a.gif')).findings);
    expect(found).toEqual(expect.arrayContaining(['Embedded comment: Retouché par Jeanne Dupont', 'XMP author: Marc Leroy']));
    const cleaned = (await redactFile(gif, 'a.gif')).data!;
    expect(has(cleaned, 'Jeanne') || has(cleaned, 'XMP DataXMP')).toBe(false);
    const image = await loadImage(Buffer.from(cleaned));
    expect([image.width, image.height]).toEqual([12, 8]);
  });

  it('reads a TIFF’s directory and XMP, and refuses to rewrite it', async () => {
    const file = tiffWithMetadata();
    const found = labels((await inspectFile(file, 'a.tif')).findings);
    expect(found).toEqual(expect.arrayContaining(['Artist: Jeanne Dupont', 'XMP author: Marc Leroy']));
    expect(found.some((f) => f.startsWith('GPS position: '))).toBe(true);
    const error = await redactFile(file, 'a.tif').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedFormatError);
    expect((error as UnsupportedFormatError).code).toBe('image-not-rewritable');
    expect((error as UnsupportedFormatError).detail).toBe('tiff');
  });

  it('reads the Exif and XMP items of a HEIC or an AVIF, and refuses to rewrite it', async () => {
    for (const brand of ['heic', 'avif'] as const) {
      const file = heifWithMetadata(brand);
      const result = await inspectFile(file, `a.${brand}`);
      expect(result.format).toBe(brand);
      const found = labels(result.findings);
      expect(found).toEqual(expect.arrayContaining(['Artist: Jeanne Dupont', 'XMP author: Marc Leroy']));
      expect(found.some((f) => f.startsWith('GPS position: '))).toBe(true);
      const error = await redactFile(file, `a.${brand}`).catch((e: unknown) => e);
      expect((error as UnsupportedFormatError).code).toBe('image-not-rewritable');
    }
    // The encoder's own AVIF carries nothing to report.
    expect((await inspectFile(await encoded('avif'), 'b.avif')).findings.filter((f) => f.confidence !== 'informational')).toEqual([]);
  });
});

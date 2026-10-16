import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inspectImage, stripImageMetadata } from '../src/core/image.js';
import { translateLabel, translateValue } from '../src/shared/french.js';
import { jpegWithPreview } from './helpers/exif-jpeg.js';

/*
 * Exif keeps a second, small copy of the picture in its own directory. Editors
 * are inconsistent about regenerating it, so a photograph cropped to hide
 * something can ship the uncropped version inside the same file.
 */

const previews = (bytes: Uint8Array) =>
  inspectImage(bytes, 'photo.jpg').filter((finding) =>
    finding.label.toLowerCase().includes('preview'),
  );

describe('the preview image inside Exif', () => {
  it('reports one that is a different shape from the picture', () => {
    const found = previews(jpegWithPreview({ width: 1600, height: 900 }, { width: 400, height: 300 }));
    expect(found).toHaveLength(1);
    expect(found[0]?.confidence).toBe('probable');
    expect(found[0]?.label).toBe('Embedded preview is a different shape from the picture');
    expect(found[0]?.value).toContain('400×300');
    expect(found[0]?.value).toContain('1600×900');
  });

  it('reports one that matches, without claiming anything about it', () => {
    const found = previews(jpegWithPreview({ width: 1600, height: 1200 }, { width: 400, height: 300 }));
    expect(found).toHaveLength(1);
    expect(found[0]?.confidence).toBe('informational');
    expect(found[0]?.label).toBe('Embedded preview image');
  });

  /*
   * The control that decides whether this check is usable. Cameras have
   * written 160x120 for decades whatever the sensor's shape, so an untouched
   * 3:2 photograph carries a 4:3 preview and always has. Warning about that
   * would put a flag on a large share of ordinary holiday photographs.
   */
  it('does not accuse a camera of cropping for writing a standard 160x120 preview', () => {
    const found = previews(jpegWithPreview({ width: 3000, height: 2000 }, { width: 160, height: 120 }));
    expect(found).toHaveLength(1);
    expect(found[0]?.confidence).toBe('informational');
  });

  it('says nothing about Exif that carries no preview at all', () => {
    expect(previews(jpegWithPreview({ width: 1600, height: 1200 }))).toEqual([]);
  });

  it('says nothing about a real file whose Exif is absent', () => {
    // signed.jpg carries a C2PA manifest in APP11 and no Exif APP1.
    const bytes = new Uint8Array(readFileSync('test/fixtures/signed.jpg'));
    expect(previews(bytes)).toEqual([]);
  });

  it('is removed by cleaning, because the whole APP1 segment goes', () => {
    const bytes = jpegWithPreview({ width: 1600, height: 900 }, { width: 400, height: 300 });
    const cleaned = stripImageMetadata(bytes);
    expect(cleaned).toBeDefined();
    expect(previews(cleaned!)).toEqual([]);
  });

  it('reads in French', () => {
    const [found] = previews(
      jpegWithPreview({ width: 1600, height: 900 }, { width: 400, height: 300 }),
    );
    expect(translateLabel(found!.label, 'fr')).toContain('aperçu');
    const value = translateValue(found!, 'fr');
    expect(value).toContain('octets');
    expect(value).not.toMatch(/cropping|preview|picture/);
  });

  it('refuses to read a truncated or lying Exif block rather than guessing', () => {
    const whole = jpegWithPreview({ width: 1600, height: 900 }, { width: 400, height: 300 });
    // Every prefix must either report nothing or report without throwing.
    for (let cut = 2; cut < whole.length; cut++) {
      expect(() => inspectImage(whole.subarray(0, cut), 'photo.jpg')).not.toThrow();
    }
  });
});

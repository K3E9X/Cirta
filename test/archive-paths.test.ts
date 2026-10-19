import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { inspectFile } from '../src/core/index.js';
import { jpegWith, tiff } from './helpers/tiff.js';

/*
 * [C10.2] A photograph inside a zip inside a zip was reported twice, once as
 * "nested.zip → photo.jpg" and once as "nested.zip > photo.jpg": the nested
 * archive was flattened by the walk and then inspected again as an archive of
 * its own. One separator, one reading, no duplicates.
 */

const photo = jpegWith(tiff([{ tag: 0x013b, ascii: 'Jean Dupont' }]));
const bundle = zipSync({ 'nested.zip': zipSync({ 'photo.jpg': photo }), 'top.jpg': photo });

describe('[C10.2] nested archives', () => {
  it('reports a finding once, under one path', async () => {
    const artists = (await inspectFile(bundle, 'bundle.zip')).findings.filter((f) => f.label === 'Artist');
    expect(artists.map((f) => f.location).sort()).toEqual([
      'nested.zip → photo.jpg → JPEG segments (Exif IFD0)',
      'top.jpg → JPEG segments (Exif IFD0)',
    ]);
  });

  it('uses no other separator', async () => {
    const { findings } = await inspectFile(bundle, 'bundle.zip');
    expect(findings.some((f) => f.location.includes(' > '))).toBe(false);
  });

  it('reads a third level once too', async () => {
    const deep = zipSync({ 'a.zip': zipSync({ 'b.zip': zipSync({ 'photo.jpg': photo }) }) });
    const artists = (await inspectFile(deep, 'deep.zip')).findings.filter((f) => f.label === 'Artist');
    expect(artists.map((f) => f.location)).toEqual(['a.zip → b.zip → photo.jpg → JPEG segments (Exif IFD0)']);
  });
});

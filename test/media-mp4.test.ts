import { describe, expect, it } from 'vitest';
import { detectFormat, inspectFile, redactFile } from '../src/core/index.js';
import { movie, MOVIE_TIME, SECONDS_1904 } from './helpers/media.js';
import { heifWithMetadata } from './helpers/pictures.js';

/*
 * [F-P3 2.2] MP4, QuickTime and M4A: where a phone or a camera leaves its
 * place, its model, its software and the date, and a cleaning that moves no
 * byte of the picture or the sound.
 */

const PHONE = {
  'com.apple.quicktime.location.ISO6709': '+48.8584+002.2945+035.000/',
  'com.apple.quicktime.make': 'Apple',
  'com.apple.quicktime.model': 'iPhone 15 Pro',
  'com.apple.quicktime.software': '17.4.1',
  'com.apple.quicktime.creationdate': '2024-03-01T11:00:00+0100',
};

describe('[F-P3 2.2] MP4, MOV and M4A', () => {
  it('reads where, with what and when: the phone’s keys, the udta atoms, the movie header, the XMP', async () => {
    const file = movie({ gps: '+45.7640+004.8357/', encoder: 'Lavf60.16.100', apple: PHONE, xmpCreator: 'Marie Martin' });
    const { format, findings } = await inspectFile(file, 'IMG_0042.MOV');
    expect(format).toBe('mp4');
    const by = (label: string) => findings.filter((f) => f.label === label).map((f) => f.value);
    expect(by('GPS position')).toEqual(expect.arrayContaining(['48.85840, 2.29450', '45.76400, 4.83570']));
    expect(findings.find((f) => f.label === 'GPS position')).toMatchObject({ confidence: 'confirmed', kind: 'identity' });
    expect(by('Camera make and model')).toContain('Apple iPhone 15 Pro');
    expect(by('Software')).toEqual(expect.arrayContaining(['17.4.1', 'Lavf60.16.100']));
    expect(by('Creation time')).toEqual(expect.arrayContaining(['2024-03-01T10:00:00Z', '2024-03-01T11:00:00+0100']));
    expect(findings.some((f) => /Marie Martin/.test(f.value))).toBe(true);
    expect(findings.find((f) => f.label === 'GPS position')!.location).toMatch(/^MP4 boxes \(moov\/(udta\/©xyz|meta\/com\.apple\.quicktime\.location\.ISO6709)\)$/);
  });

  it('cleans in place: the boxes become free space of the same size, the dates are zeroed, the media is untouched', async () => {
    const mdat = new Uint8Array(4096).map((_, i) => (i * 31) & 0xff);
    const file = movie({ gps: '+45.7640+004.8357/', encoder: 'Lavf60.16.100', apple: PHONE, xmpCreator: 'Marie Martin', mdat });
    const cleaned = await redactFile(file, 'IMG_0042.MOV');
    const out = cleaned.data!;
    expect(out.length).toBe(file.length);
    // The media data sits where it sat, byte for byte: no chunk offset moved.
    const at = file.length - mdat.length;
    expect(out.subarray(at)).toEqual(mdat);
    const after = await inspectFile(out, 'IMG_0042.MOV');
    expect(after.findings.filter((f) => f.confidence !== 'informational')).toEqual([]);
    expect(Buffer.from(out).includes(Buffer.from('iPhone'))).toBe(false);
    expect(Buffer.from(out).includes(Buffer.from('Marie'))).toBe(false);
    // mvhd, tkhd and mdhd say "unknown" now.
    const view = Buffer.from(out);
    for (const type of ['mvhd', 'tkhd', 'mdhd']) {
      const offset = view.indexOf(type) + 4 + 4;
      expect(view.readUInt32BE(offset), type).toBe(0);
    }
    expect(cleaned.removed.map((f) => f.label)).toEqual(expect.arrayContaining(['GPS position', 'Camera make and model', 'Creation time']));
  });

  it('tells MP4, QuickTime and M4A apart from HEIC and AVIF, which open the same way', async () => {
    expect(detectFormat(movie({ brand: 'qt  ' }))).toBe('mov');
    expect(detectFormat(movie({ brand: 'M4A ' }))).toBe('m4a');
    expect(detectFormat(movie())).toBe('mp4');
    expect(detectFormat(heifWithMetadata('heic'))).toBe('heic');
    expect(detectFormat(heifWithMetadata('avif'))).toBe('avif');
  });

  it('says nothing about a file that carries nothing, and keeps a movie with no metadata as it is', async () => {
    const bare = movie();
    // A view onto the same bytes: dates set to "unknown" (zero) in each header.
    const view = Buffer.from(bare.buffer, bare.byteOffset, bare.length);
    for (const type of ['mvhd', 'tkhd', 'mdhd']) {
      view.writeUInt32BE(0, view.indexOf(type) + 8);
      view.writeUInt32BE(0, view.indexOf(type) + 12);
    }
    const { findings } = await inspectFile(bare, 'a.mp4');
    expect(findings.filter((f) => f.confidence !== 'informational')).toEqual([]);
    // With nothing to remove, the clean changes nothing.
    expect((await redactFile(bare, 'a.mp4')).data).toEqual(bare);
    expect(MOVIE_TIME - SECONDS_1904).toBe(Date.UTC(2024, 2, 1, 10) / 1000);
  });
});

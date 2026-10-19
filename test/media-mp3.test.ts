import { describe, expect, it } from 'vitest';
import { detectFormat, inspectFile, redactFile } from '../src/core/index.js';
import { apev2, bytes, id3Text, id3v1, id3v2, lameFrame, latin1, mpegFrame } from './helpers/media.js';
import { GPS, ARTIST } from './helpers/pictures.js';
import { jpegWith, tiff } from './helpers/tiff.js';

/*
 * [F-P3 2.2] MP3: the ID3 tags in front (2.2, 2.3, 2.4), ID3v1 and APEv2 at
 * the end, the listener a rating names, the picture on the cover with its own
 * EXIF. Cleaning keeps the audio frames, byte for byte.
 */

const audio = () => bytes(lameFrame(), mpegFrame(0x11), mpegFrame(0x22), mpegFrame(0x33));
const cover = () => jpegWith(tiff(ARTIST, undefined, GPS));

function tagged(): Uint8Array {
  const tag = id3v2(3, [
    ['TPE1', id3Text('Marie Martin')],
    ['TIT2', id3Text('Mémo vocal — réunion', 1)],
    ['TENC', id3Text('Voice Memos')],
    ['TSSE', id3Text('Lavf60.16.100')],
    ['TYER', id3Text('2024')],
    ['COMM', bytes([0], 'fra', [0], latin1('Enregistré au bureau de Lyon'))],
    ['TXXX', bytes([0], 'Projet', [0], 'Fusion Alpha')],
    ['POPM', bytes('marie.martin@example.fr', [0], [196], [0, 0, 0, 3])],
    ['PRIV', bytes('www.example.com', [0], [1, 2, 3, 4])],
    ['APIC', bytes([0], 'image/jpeg', [0], [3], [0], cover())],
  ]);
  return bytes(tag, audio(), apev2({ Artist: 'M. Martin', Comment: 'Copie de travail' }), id3v1('Memo', 'Marie Martin', 'Notes', '2024', 'Brouillon'));
}

describe('[F-P3 2.2] MP3', () => {
  it('reads ID3v2, ID3v1 and APEv2: names, the listener’s address, dates, comments, the cover picture’s EXIF', async () => {
    const { format, findings } = await inspectFile(tagged(), 'memo.mp3');
    expect(format).toBe('mp3');
    const by = (label: string) => findings.filter((f) => f.label === label).map((f) => f.value);
    expect(by('Artist')).toEqual(expect.arrayContaining(['Marie Martin', 'M. Martin']));
    expect(findings.find((f) => f.label === 'Artist' && f.location === 'ID3v2 tag (TPE1)')).toMatchObject({ confidence: 'confirmed', kind: 'identity' });
    expect(by('Title')).toContain('Mémo vocal — réunion');
    expect(by('Listener’s e-mail address')).toEqual(['marie.martin@example.fr']);
    expect(by('Comment')).toEqual(expect.arrayContaining(['Enregistré au bureau de Lyon', 'Brouillon', 'Copie de travail']));
    expect(by('User-defined text')).toEqual(['Projet: Fusion Alpha']);
    expect(by('Recording date')).toContain('2024');
    expect(by('Private data')).toEqual(['www.example.com, 4 bytes']);
    // The cover is a JPEG with its own EXIF: its position and its artist are reported too.
    expect(findings.some((f) => f.label === 'GPS position' && /ID3v2 tag \(APIC\)/.test(f.location))).toBe(true);
    // LAME's header names the encoder; it is part of the audio stream.
    expect(findings.find((f) => f.label === 'Software' && f.value === 'LAME3.100')).toMatchObject({ confidence: 'informational' });
  });

  it('reads 2.4 (sizes in syncsafe integers, UTF-8) and 2.2 (three-letter frames)', async () => {
    const v24 = bytes(id3v2(4, [['TPE1', id3Text('Jeanne Dupont', 3)], ['TDRC', id3Text('2024-05-02T10:12', 3)], ['TOWN', id3Text('Jeanne', 3)]]), audio());
    const four = await inspectFile(v24, 'a.mp3');
    expect(four.findings.map((f) => `${f.label}=${f.value}`)).toEqual(expect.arrayContaining(['Artist=Jeanne Dupont', 'Recording date=2024-05-02T10:12', 'File owner=Jeanne']));
    const v22 = bytes(id3v2(2, [['TP1', id3Text('Paul Leroy')], ['TT2', id3Text('Interview')]]), audio());
    const two = await inspectFile(v22, 'b.mp3');
    expect(two.findings.map((f) => `${f.label}=${f.value}`)).toEqual(expect.arrayContaining(['Artist=Paul Leroy', 'Title=Interview']));
  });

  it('cleans: every tag goes, the audio frames stay byte for byte, the encoder header with them', async () => {
    const cleaned = await redactFile(tagged(), 'memo.mp3');
    expect(cleaned.data).toEqual(audio());
    const after = await inspectFile(cleaned.data!, 'memo.mp3');
    expect(after.findings.filter((f) => f.confidence !== 'informational')).toEqual([]);
    expect(cleaned.removed.map((f) => f.label)).toEqual(expect.arrayContaining(['Artist', 'Listener’s e-mail address', 'GPS position']));
  });

  it('knows an MP3 without tags by two frames in a row, and nothing by one stray sync', () => {
    expect(detectFormat(audio())).toBe('mp3');
    expect(detectFormat(bytes([0xff, 0xfb, 0x90, 0x00], latin1('not audio at all, just text after a sync word'.repeat(4))))).not.toBe('mp3');
  });
});

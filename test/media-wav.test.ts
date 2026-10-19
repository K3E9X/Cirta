import { describe, expect, it } from 'vitest';
import { detectFormat, inspectFile, redactFile } from '../src/core/index.js';
import { SAMPLES, wav } from './helpers/media.js';

/*
 * [F-P3 2.2] WAV: what a recorder, a DAW or a broadcast chain writes beside
 * the sound — LIST/INFO, the Broadcast extension (bext), iXML, XMP, an id3
 * chunk, cue labels — and a copy without them whose samples have not moved.
 */

const FULL = {
  info: { IART: 'Marie Martin', INAM: 'Entretien RH', ICMT: 'Ne pas diffuser', ISFT: 'Audacity 3.4', ICRD: '2024-03-01', IENG: 'Paul Leroy' },
  bext: { description: 'Interview, salle B', originator: 'ZOOM H5', reference: 'ZH5-0042', date: '2024-03-01', time: '10:12:00', history: 'A=PCM,F=48000,W=24,M=stereo,T=ZOOM H5\r\n' },
  ixml: '<BWFXML><PROJECT>Fusion Alpha</PROJECT><NOTE>Bureau de Jeanne</NOTE><LOCATION><LOCATION_NAME>Lyon, Part-Dieu</LOCATION_NAME><LOCATION_GPS>45.7606, 4.8590</LOCATION_GPS></LOCATION></BWFXML>',
  xmpCreator: 'Jeanne Dupont',
  id3Artist: 'Marie Martin',
  cueLabel: 'Question sur le salaire',
};

describe('[F-P3 2.2] WAV', () => {
  it('reads INFO, bext, iXML, XMP, the id3 chunk and the cue labels', async () => {
    const { format, findings } = await inspectFile(wav(FULL), 'entretien.wav');
    expect(format).toBe('wav');
    const at = (label: string) => findings.filter((f) => f.label === label).map((f) => `${f.value} @ ${f.location}`);
    expect(at('Artist')).toEqual(expect.arrayContaining(['Marie Martin @ WAV chunks (LIST INFO/IART)', 'Marie Martin @ WAV chunks (id3) (TPE1)']));
    expect(at('Engineer')).toEqual(['Paul Leroy @ WAV chunks (LIST INFO/IENG)']);
    expect(at('Originator')).toEqual(['ZOOM H5 @ WAV chunks (bext)']);
    expect(at('Originator reference')).toEqual(['ZH5-0042 @ WAV chunks (bext)']);
    expect(at('Creation time')).toEqual(expect.arrayContaining(['2024-03-01 10:12:00 @ WAV chunks (bext)', '2024-03-01 @ WAV chunks (LIST INFO/ICRD)']));
    expect(at('Coding history')).toEqual(['A=PCM,F=48000,W=24,M=stereo,T=ZOOM H5 @ WAV chunks (bext)']);
    expect(at('Place name')).toEqual(['Lyon, Part-Dieu @ WAV chunks (iXML)']);
    expect(at('GPS position')).toEqual(['45.76060, 4.85900 @ WAV chunks (iXML)']);
    expect(at('Cue label')).toEqual(['Question sur le salaire @ WAV chunks (LIST adtl/labl)']);
    expect(findings.some((f) => /Jeanne Dupont/.test(f.value))).toBe(true);
    expect(findings.find((f) => f.label === 'Software')).toMatchObject({ value: 'Audacity 3.4', confidence: 'informational' });
  });

  it('cleans: the format and the samples, nothing else, the RIFF size written again', async () => {
    const cleaned = await redactFile(wav(FULL), 'entretien.wav');
    const out = cleaned.data!;
    // What is left, in order: the format, the cue points (positions, not words), the samples.
    const ids: string[] = [];
    for (let at = 12; at + 8 <= out.length; ) {
      ids.push(Buffer.from(out.subarray(at, at + 4)).toString('latin1'));
      const size = new DataView(out.buffer, out.byteOffset).getUint32(at + 4, true);
      at += 8 + size + (size % 2);
    }
    expect(ids).toEqual(['fmt ', 'cue ', 'data']);
    const view = new DataView(out.buffer, out.byteOffset);
    expect(view.getUint32(4, true)).toBe(out.length - 8);
    expect(Buffer.from(out).includes(Buffer.from(SAMPLES))).toBe(true);
    const after = await inspectFile(out, 'entretien.wav');
    expect(after.findings).toEqual([]);
  });

  it('reads an RF64 file, and refuses to rewrite it rather than get its 64-bit sizes wrong', async () => {
    const big = wav({ ...FULL, rf64: true });
    expect(detectFormat(big)).toBe('wav');
    expect((await inspectFile(big, 'long.wav')).findings.some((f) => f.label === 'Artist')).toBe(true);
    await expect(redactFile(big, 'long.wav')).rejects.toMatchObject({ code: 'media-not-rewritable', detail: 'rf64' });
  });
});

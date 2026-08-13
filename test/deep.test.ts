import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import {
  inspectFile,
  redactFile,
  inspectImage,
  stripImageMetadata,
  fingerprint,
  detectImageKind,
  type Finding,
} from '../src/core/index.js';
import { makeJpeg, makePng, makeRichPptx } from './fixtures.js';

const labels = (findings: Finding[]) => findings.map((f) => f.label);
const find = (findings: Finding[], label: string) => findings.find((f) => f.label === label);

describe('image metadata', () => {
  it('identifies JPEG and PNG by magic bytes', () => {
    expect(detectImageKind(makeJpeg())).toBe('jpeg');
    expect(detectImageKind(makePng())).toBe('png');
    expect(detectImageKind(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });

  it('flags Exif carrying GPS coordinates as confirmed', () => {
    const findings = inspectImage(makeJpeg({ gps: true }), 'ppt/media/image1.jpeg');
    const exif = find(findings, 'Exif with GPS coordinates');
    expect(exif?.confidence).toBe('confirmed');
  });

  it('reports Exif without GPS as probable rather than confirmed', () => {
    const findings = inspectImage(makeJpeg({ gps: false }), 'ppt/media/image1.jpeg');
    expect(find(findings, 'Exif camera data')?.confidence).toBe('probable');
  });

  it('strips Exif and comments from a JPEG', () => {
    const stripped = stripImageMetadata(makeJpeg())!;
    expect(inspectImage(stripped, 'x')).toEqual([]);
    expect(stripped.length).toBeLessThan(makeJpeg().length);
  });

  it('keeps the JFIF segment and the scan data when stripping a JPEG', () => {
    const stripped = stripImageMetadata(makeJpeg())!;
    // APP0/JFIF drives rendering and must survive; the scan and EOI must too.
    expect([...stripped.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...stripped.subarray(2, 4)]).toEqual([0xff, 0xe0]);
    expect([...stripped.subarray(-2)]).toEqual([0xff, 0xd9]);
    expect([...stripped].join(',')).toContain('18,52,86'); // 0x12,0x34,0x56
  });

  it('strips text and time chunks from a PNG while keeping image data', () => {
    const stripped = stripImageMetadata(makePng())!;
    expect(inspectImage(stripped, 'x')).toEqual([]);
    const text = new TextDecoder('latin1').decode(stripped);
    expect(text).not.toContain('tEXt');
    expect(text).not.toContain('tIME');
    expect(text).toContain('IHDR');
    expect(text).toContain('IDAT');
    expect(text).toContain('IEND');
  });

  it('reports nothing to strip for unrecognised data', () => {
    expect(stripImageMetadata(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });

  it('reports nothing to strip for an image that carries no metadata', () => {
    const clean = stripImageMetadata(makeJpeg())!;
    expect(stripImageMetadata(clean)).toBeUndefined();
  });
});

describe('generator and host fingerprinting', () => {
  const derive = (value: string) =>
    fingerprint([
      { kind: 'provenance', confidence: 'informational', location: 'test', label: 'Test', value },
    ]);

  it('derives a Windows account name from a path', () => {
    const found = derive('C:\\Users\\lotfi\\Templates\\corp.potx');
    expect(find(found, 'Windows account')?.value).toContain('lotfi');
  });

  it('derives a macOS account name from a path', () => {
    expect(find(derive('/Users/lotfi/Documents/deck.key'), 'macOS account')?.value).toBe('lotfi');
  });

  it('does not mistake a Windows path expressed as a URL for macOS', () => {
    // file:///C:/Users/... contains "/Users/" but is a Windows path.
    const found = derive('file:///C:/Users/lotfi/Documents/chiffres.xlsx');
    expect(labels(found)).not.toContain('macOS account');
    expect(find(found, 'Windows account')?.value).toContain('lotfi');
  });

  it('derives a Linux account name from a path', () => {
    expect(find(derive('/home/lotfi/work/rapport.pdf'), 'Linux account')?.value).toBe('lotfi');
  });

  it('recognises a scratch directory', () => {
    expect(labels(derive('C:\\Users\\x\\AppData\\Local\\Temp\\out.pptx'))).toContain(
      'Windows temporary directory',
    );
    expect(labels(derive('/var/folders/9k/abc/T/out.pdf'))).toContain('macOS temporary directory');
  });

  it('recognises session and run identifiers', () => {
    expect(labels(derive('/scratch/session_01ABCdef99/out.pdf'))).toContain('Session identifier');
    expect(labels(derive('/w/0ecef234-0e74-58a2-9812-4124ebdd75c0/x.pdf'))).toContain(
      'Run or workspace identifier (UUID)',
    );
  });

  it('names an assistant when the metadata mentions one', () => {
    const found = derive('Claude PDF Export 1.2');
    expect(find(found, 'Assistant or agent named in metadata')?.value).toContain('Claude');
  });

  it('names the library when a document was generated programmatically', () => {
    expect(find(derive('python-pptx'), 'Document generated programmatically')?.value).toContain(
      'python-pptx',
    );
    expect(find(derive('Skia/PDF m120'), 'Document generated programmatically')?.value).toContain(
      'Skia',
    );
  });

  it('says nothing about ordinary desktop software', () => {
    expect(derive('Microsoft Office PowerPoint')).toEqual([]);
  });

  it('reports each derived fact once even when several fields carry it', () => {
    const found = fingerprint([
      { kind: 'environment', confidence: 'confirmed', location: 'a', label: 'A', value: '/home/lotfi/x' },
      { kind: 'environment', confidence: 'confirmed', location: 'b', label: 'B', value: '/home/lotfi/y' },
    ]);
    expect(found.filter((f) => f.label === 'Linux account')).toHaveLength(1);
  });
});

describe('deep document inspection', () => {
  it('surfaces the host, the tool and the scratch directory together', async () => {
    const { findings } = await inspectFile(makeRichPptx());
    const found = labels(findings);
    expect(found).toContain('Windows account');
    expect(found).toContain('Windows temporary directory');
    expect(found).toContain('Document generated programmatically');
  });

  it('reports hyperlinks pointing at local paths but ignores web links', async () => {
    const { findings } = await inspectFile(makeRichPptx());
    const link = find(findings, 'Link to a local or network path');
    expect(link?.value).toContain('C:/Users/lotfi/Documents');
    expect(findings.filter((f) => f.label === 'Link to a local or network path')).toHaveLength(1);
  });

  it('reports hidden slides and speaker notes', async () => {
    const { findings } = await inspectFile(makeRichPptx());
    expect(find(findings, 'Hidden slides')?.value).toBe('1 hidden slide still present in the file');
    expect(find(findings, 'Speaker notes')?.value).toBe('1 slide with presenter notes');
  });

  it('reports Exif on pictures embedded in the deck', async () => {
    const { findings } = await inspectFile(makeRichPptx());
    const exif = findings.find((f) => f.location === 'ppt/media/image1.jpeg');
    expect(exif).toBeDefined();
  });

  it('strips Exif from embedded pictures during redaction', async () => {
    const redacted = await redactFile(makeRichPptx());
    const media = unzipSync(redacted.data!)['ppt/media/image1.jpeg']!;
    expect(inspectImage(media, 'x')).toEqual([]);
  });

  it('leaves document content in place and says so', async () => {
    const redacted = await redactFile(makeRichPptx());
    const kept = redacted.notes.find((n) => n.code === 'kept:content');
    expect(kept?.detail).toContain('local links');
    expect(kept?.detail).toContain('hidden slides');
    expect(kept?.detail).toContain('speaker notes');

    // The slide, the link and the notes must survive untouched.
    const parts = unzipSync(redacted.data!);
    expect(Object.keys(parts)).toContain('ppt/notesSlides/notesSlide1.xml');
    expect(Object.keys(parts)).toContain('ppt/slides/slide2.xml');
  });
});

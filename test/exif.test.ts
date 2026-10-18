import { describe, expect, it } from 'vitest';
import { inspectFile, redactFile, type Finding } from '../src/core/index.js';
import { iTXt, jpegWith, png, tEXt, tiff, xmpApp1, zTXt, type Field } from './helpers/tiff.js';

/*
 * [C7] A photograph's Exif was reduced to "Exif with GPS coordinates, 226
 * bytes": no position, no camera, no artist. A PNG's Author chunk came out as
 * "PNG tEXt chunk, 30 bytes". Cleaning removed everything; the report said
 * almost nothing of what it was. The fields are read and shown.
 */

const deg = (d: number, m: number, s: number): Array<[number, number]> => [
  [d, 1],
  [m, 1],
  [s, 1],
];

const IFD0: Field[] = [
  { tag: 0x010f, ascii: 'Apple' },
  { tag: 0x0110, ascii: 'iPhone 15 Pro' },
  { tag: 0x0131, ascii: '17.5.1' },
  { tag: 0x013b, ascii: 'Jean Dupont' },
  { tag: 0x8298, ascii: '© Jean Dupont 2026' },
  { tag: 0x0132, ascii: '2026:10:01 18:42:07' },
  { tag: 0x013c, ascii: 'MacBook-de-Jean' },
];
const EXIF: Field[] = [
  { tag: 0x9003, ascii: '2026:10:01 18:42:07' },
  { tag: 0x9011, ascii: '+02:00' },
  { tag: 0xa434, ascii: 'iPhone 15 Pro back triple camera 6.86mm f/1.78' },
  { tag: 0xa431, ascii: 'F2LXK0A1B2C3' },
  { tag: 0xa430, ascii: 'Jean Dupont' },
];
const GPS: Field[] = [
  { tag: 1, ascii: 'N' },
  { tag: 2, rational: deg(48, 51, 29) },
  { tag: 3, ascii: 'E' },
  { tag: 4, rational: deg(2, 17, 40) },
];

const photo = jpegWith(tiff(IFD0, EXIF, GPS));
const get = (findings: Finding[], label: string) => findings.find((f) => f.label === label);

describe('[C7] Exif fields', () => {
  it('shows the position, in decimal degrees, as text', async () => {
    const { findings } = await inspectFile(photo, 'photo.jpg');
    expect(get(findings, 'GPS position')).toMatchObject({ value: '48.85806, 2.29444', confidence: 'confirmed', kind: 'identity' });
  });

  it('shows the camera, the software and the artist', async () => {
    const { findings } = await inspectFile(photo, 'photo.jpg');
    expect(get(findings, 'Camera make and model')?.value).toBe('Apple iPhone 15 Pro');
    expect(get(findings, 'Software')?.value).toBe('17.5.1');
    expect(get(findings, 'Artist')).toMatchObject({ value: 'Jean Dupont', confidence: 'confirmed', kind: 'identity' });
    expect(get(findings, 'Copyright')?.value).toBe('© Jean Dupont 2026');
    expect(get(findings, 'Computer name')?.value).toBe('MacBook-de-Jean');
  });

  it('reads the Exif sub-directory: date taken, time zone, lens, serial number, owner', async () => {
    const { findings } = await inspectFile(photo, 'photo.jpg');
    expect(get(findings, 'Date taken')?.value).toBe('2026:10:01 18:42:07');
    expect(get(findings, 'Time zone offset')?.value).toBe('+02:00');
    expect(get(findings, 'Lens')?.value).toContain('triple camera');
    expect(get(findings, 'Camera serial number')).toMatchObject({ value: 'F2LXK0A1B2C3', confidence: 'confirmed' });
    expect(get(findings, 'Camera owner')).toMatchObject({ value: 'Jean Dupont', confidence: 'confirmed' });
  });

  it('signs southern and western coordinates', async () => {
    const south = jpegWith(tiff([], undefined, [{ tag: 1, ascii: 'S' }, { tag: 2, rational: deg(33, 51, 54) }, { tag: 3, ascii: 'W' }, { tag: 4, rational: deg(70, 39, 0) }]));
    expect(get((await inspectFile(south, 'photo.jpg')).findings, 'GPS position')?.value).toBe('-33.86500, -70.65000');
  });

  it('survives a directory that points back at itself', async () => {
    const block = tiff([{ tag: 0x010f, ascii: 'Loop' }]);
    // Point IFD0's next-directory pointer at IFD0 again.
    const view = new DataView(block.buffer);
    const entries = view.getUint16(8, true);
    view.setUint32(8 + 2 + entries * 12, 8, true);
    const { findings } = await inspectFile(jpegWith(block), 'photo.jpg');
    expect(get(findings, 'Camera make and model')?.value).toBe('Loop');
  });

  it('reads Exif carried by a PNG eXIf chunk', async () => {
    const image = png({ type: 'eXIf', data: tiff([{ tag: 0x013b, ascii: 'Jean Dupont' }]) });
    expect(get((await inspectFile(image, 'image.png')).findings, 'Artist')?.value).toBe('Jean Dupont');
  });
});

describe('[C7] PNG text chunks', () => {
  it('shows known keys with their values: tEXt, iTXt, compressed zTXt', async () => {
    const image = png(tEXt('Author', 'Jean Dupont'), iTXt('Description', 'Maquette du projet Orion'), zTXt('Comment', 'Exporté depuis le poste de Jean'), tEXt('Software', 'GIMP 2.10'));
    const { findings } = await inspectFile(image, 'image.png');
    expect(get(findings, 'Author')).toMatchObject({ value: 'Jean Dupont', confidence: 'confirmed', kind: 'identity' });
    expect(get(findings, 'Description')?.value).toBe('Maquette du projet Orion');
    expect(get(findings, 'Comment')?.value).toBe('Exporté depuis le poste de Jean');
    expect(get(findings, 'Software')?.value).toBe('GIMP 2.10');
  });

  it('shows an unknown key with its value rather than a byte count', async () => {
    const { findings } = await inspectFile(png(tEXt('ProjectCode', 'ORION-42')), 'image.png');
    expect(findings.some((f) => f.value.includes('ORION-42'))).toBe(true);
  });
});

const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
 xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#" xmlns:stRef="http://ns.adobe.com/xap/1.0/sType/ResourceRef#"
 xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">
<dc:creator><rdf:Seq><rdf:li>Jean Dupont</rdf:li></rdf:Seq></dc:creator>
<xmpMM:DerivedFrom stRef:filePath="C:\\Users\\jdupont\\Desktop\\maquette_v3.psd"/>
<xmpMM:History><rdf:Seq>
<rdf:li stEvt:action="created" stEvt:softwareAgent="Adobe Photoshop 25.0 (Windows)" stEvt:when="2026-09-30T10:00:00"/>
<rdf:li stEvt:action="saved" stEvt:softwareAgent="Adobe Photoshop 25.1 (Macintosh)" stEvt:when="2026-10-01T09:00:00"/>
</rdf:Seq></xmpMM:History>
<photoshop:DocumentAncestors><rdf:Bag><rdf:li>xmp.did:0A1B2C3D</rdf:li><rdf:li>adobe:docid:photoshop:9f8e7d</rdf:li></rdf:Bag></photoshop:DocumentAncestors>
</rdf:Description></rdf:RDF></x:xmpmeta>`;

describe('[C7] XMP embedded in images', () => {
  for (const [name, image] of [
    ['JPEG APP1', jpegWith(undefined, xmpApp1(XMP))],
    ['PNG iTXt', png(iTXt('XML:com.adobe.xmp', XMP))],
  ] as const) {
    it(`reads creator, history, source path and ancestors from ${name}`, async () => {
      const { findings } = await inspectFile(image, name.startsWith('PNG') ? 'image.png' : 'photo.jpg');
      expect(get(findings, 'XMP author')?.value).toBe('Jean Dupont');
      expect(get(findings, 'Editing history')?.value).toMatch(/Adobe Photoshop 25\.0 \(Windows\).*Adobe Photoshop 25\.1 \(Macintosh\)/);
      expect(get(findings, 'Source file path')?.value).toBe('C:\\Users\\jdupont\\Desktop\\maquette_v3.psd');
      expect(get(findings, 'Document ancestors')?.value).toMatch(/^2 /);
    });
  }
});

describe('[C7] cleaning', () => {
  it('still removes everything, and the report counts what went', async () => {
    const result = await redactFile(photo, 'photo.jpg');
    expect((await inspectFile(result.data!, 'photo.jpg')).findings.filter((f) => f.confidence !== 'informational')).toEqual([]);
    expect(result.removed.map((f) => f.label)).toEqual(expect.arrayContaining(['GPS position', 'Artist']));
  });
});

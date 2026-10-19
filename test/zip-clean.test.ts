import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { inspectFile, redactFile, UnsupportedFormatError } from '../src/core/index.js';
import { errorText } from '../src/shared/french.js';
import { makeDocx, makeJpeg, makePdf, makePng } from './fixtures.js';
import { legacyOffice } from './helpers/ole.js';

describe('[F-P2 2.4] cleaning a plain archive', () => {
  it('cleans every member it supports, an archive inside it too, and repacks them in their order', async () => {
    const inner = zipSync({ 'photo.jpg': makeJpeg(), 'lisez-moi.txt': strToU8('Bon​jour') });
    const archive = zipSync({
      'dossier/lettre.docx': makeDocx(),
      'dossier/offre.pdf': await makePdf(),
      'image.png': makePng(),
      'notes.txt': strToU8('Rapport​ final'),
      'vide.txt': new Uint8Array(),
      'archives/ancien.zip': inner,
    });
    const before = (await inspectFile(archive, 'a.zip')).findings;
    expect(before.some((f) => f.confidence === 'confirmed')).toBe(true);

    const result = await redactFile(archive, 'a.zip');
    expect(result.format).toBe('zip');
    const members = unzipSync(result.data!);
    expect(Object.keys(members)).toEqual(Object.keys(unzipSync(archive)));
    expect(new TextDecoder().decode(members['notes.txt'])).toBe('Rapport final');
    expect(members['vide.txt']).toHaveLength(0);

    const after = (await inspectFile(result.data!, 'a.zip')).findings;
    expect(after.filter((f) => f.confidence === 'confirmed')).toEqual([]);
    expect(result.removed.some((f) => f.location.startsWith('dossier/lettre.docx → '))).toBe(true);
    expect(result.removed.some((f) => f.location.startsWith('archives/ancien.zip → photo.jpg → '))).toBe(true);
    expect(result.notes.map((n) => n.code)).toContain('scope:archive');
  });

  it('passes the cleaning options to each member', async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(`<w:document ${W}><w:body><w:p><w:r><w:t>Texte</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>caché</w:t></w:r></w:p></w:body></w:document>`),
    });
    const result = await redactFile(zipSync({ 'a.docx': docx }), 'a.zip', { removeHidden: true });
    const cleaned = new TextDecoder().decode(unzipSync(unzipSync(result.data!)['a.docx']!)['word/document.xml']);
    expect(cleaned).not.toContain('caché');
  });

  it('refuses an archive holding a member it cannot clean, and names each one', async () => {
    const archive = zipSync({ 'ok.txt': strToU8('bonjour'), 'programme.bin': new Uint8Array([0, 1, 2, 3, 0xff, 0, 0, 7]), 'ancien.doc': legacyOffice('doc', { summary: { 4: 'J' } }) });
    const error = await redactFile(archive, 'a.zip').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedFormatError);
    expect((error as UnsupportedFormatError).code).toBe('archive-not-rewritable');
    expect((error as UnsupportedFormatError).detail).toBe('programme.bin, ancien.doc');
    expect(errorText(error, 'fr')).toContain('programme.bin, ancien.doc');
    expect(errorText(error, 'en')).toContain('programme.bin, ancien.doc');
  });

  it('dates every repacked member 1980-01-01 and gives the same bytes twice', async () => {
    const archive = zipSync({ 'a.txt': strToU8('x​'), 'b.pdf': await makePdf() });
    const first = (await redactFile(archive, 'a.zip')).data!;
    const second = (await redactFile(archive, 'a.zip')).data!;
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    expect(new DataView(first.buffer, first.byteOffset).getUint16(12, true)).toBe(0x21);
  });
});

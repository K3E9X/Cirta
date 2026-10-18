import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { PDFDocument, PDFArray, PDFHexString } from 'pdf-lib';
import { inspectFile, redactFile } from '../src/core/index.js';
import { makeDocx, makeJpeg, makePdf, makePng, makePptx, makeXlsx } from './fixtures.js';

/*
 * [F-P2 2.4] Same input, same options: same bytes, whatever the clock says.
 * Two cleans an hour and a year apart must be identical — so that a cleaned
 * copy can be checked by cleaning the original again and comparing hashes.
 */

const odt = () =>
  zipSync({
    mimetype: strToU8('application/vnd.oasis.opendocument.text'),
    'meta.xml': strToU8('<office:document-meta xmlns:office="o" xmlns:meta="m" xmlns:dc="d"><office:meta><dc:creator>Jeanne</dc:creator></office:meta></office:document-meta>'),
    'content.xml': strToU8('<office:document-content/>'),
  });

async function twice(data: Uint8Array, hint: string): Promise<[Uint8Array, Uint8Array]> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T08:00:00Z'));
  const first = (await redactFile(data, hint)).data!;
  vi.setSystemTime(new Date('2027-06-15T21:37:00Z'));
  const second = (await redactFile(data, hint)).data!;
  vi.useRealTimers();
  return [first, second];
}

afterEach(() => vi.useRealTimers());

describe('[F-P2 2.4] deterministic output', () => {
  it('gives the same bytes for the same input, a year apart, in every rewritten format', async () => {
    const cases: Array<[string, Uint8Array]> = [
      ['a.pdf', await makePdf()],
      ['a.docx', makeDocx()],
      ['a.pptx', makePptx()],
      ['a.xlsx', makeXlsx()],
      ['a.odt', odt()],
      ['a.png', makePng()],
      ['a.jpg', makeJpeg()],
      ['a.html', strToU8('<html><head><meta name="author" content="J"></head><body>x</body></html>')],
      ['a.txt', strToU8('Bon​jour')],
    ];
    for (const [name, data] of cases) {
      const [a, b] = await twice(data, name);
      expect(Buffer.from(a).equals(Buffer.from(b)), name).toBe(true);
    }
  });

  it('dates every member of a rewritten package 1980-01-01, the ZIP epoch, not the hour of the clean', async () => {
    const [cleaned] = await twice(makeDocx(), 'a.docx');
    // The DOS date of the first local header: bytes 12–13. 1980-01-01 is (0 << 9) | (1 << 5) | 1.
    const view = new DataView(cleaned.buffer, cleaned.byteOffset);
    expect(view.getUint16(12, true)).toBe(0x21);
    expect(Object.keys(unzipSync(cleaned)).length).toBeGreaterThan(0);
  });

  it('gives a PDF a new /ID computed from its cleaned content, not the original’s', async () => {
    // An /ID as a producer writes it: a pair of hashes that ties every copy to this one.
    const source = await PDFDocument.load(await makePdf());
    const theirs = PDFHexString.of('0123456789ABCDEF0123456789ABCDEF');
    source.context.trailerInfo.ID = source.context.obj([theirs, theirs]);
    const original = await source.save();
    const before = await PDFDocument.load(original);
    expect((await inspectFile(original, 'a.pdf')).findings.some((f) => f.label === 'Document identifier (/ID)')).toBe(true);
    const ids = (doc: PDFDocument) => (doc.context.lookup(doc.context.trailerInfo.ID) as PDFArray | undefined)?.asArray().map((x) => (x as PDFHexString).asString());
    const [cleaned, again] = await twice(original, 'a.pdf');
    const after = ids(await PDFDocument.load(cleaned));
    expect(after).toHaveLength(2);
    expect(after![0]).toMatch(/^[0-9A-F]{32}$/i);
    expect(after).not.toEqual(ids(before));
    expect(ids(await PDFDocument.load(again))).toEqual(after);
    // Recomputed on inspection: it identifies nothing the pages do not show, and is not reported.
    expect((await inspectFile(cleaned, 'a.pdf')).findings.some((f) => f.label === 'Document identifier (/ID)')).toBe(false);
  });

  it('stores an OpenDocument mimetype first and uncompressed, as the specification requires', async () => {
    const [cleaned] = await twice(odt(), 'a.odt');
    const view = new DataView(cleaned.buffer, cleaned.byteOffset);
    expect(new TextDecoder().decode(cleaned.subarray(30, 30 + view.getUint16(26, true)))).toBe('mimetype');
    expect(view.getUint16(8, true)).toBe(0);
  });
});

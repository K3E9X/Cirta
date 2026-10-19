import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { detectFormat, inspectFile, redactFile } from '../src/core/index.js';
import { decodeLzma, decodeLzma2 } from '../src/core/lzma.js';
import { makeDocx } from './fixtures.js';
import { sevenZip } from './helpers/sevenzip.js';

/*
 * [F-P3 2.2] 7z, inspected only, and the LZMA decoder it needs: names,
 * dates, and each file's content read as it would be on its own; what sits
 * behind a coder this does not decode, or is encrypted, named as unread.
 */

/*
 * Known-answer vectors: 220 words of French (Python's random, seed 11, from a
 * fixed list), compressed by xz-utils through Python's lzma module — raw LZMA
 * (lc 3, lp 0, pb 2, 64 KiB dictionary) and raw LZMA2 (preset 6). The text is
 * checked by its SHA-256.
 */
const TEXT_SHA256 = 'b9dbc39658300528c87c9b628597e34a03c703cc61a56b416d4249579d0f859d';
const TEXT_LENGTH = 1534;
const VECTORS = new URL('./vectors/lzma.txt', import.meta.url);

describe('[F-P3 2.2] LZMA and LZMA2', () => {
  it('decode xz-utils’ own output to the text it was made from', async () => {
    const { readFileSync } = await import('node:fs');
    const [, lzma1, lzma2] = readFileSync(VECTORS, 'utf8').trim().split('\n');
    const one = decodeLzma(new Uint8Array([0x5d, 0, 0, 1, 0]), new Uint8Array(Buffer.from(lzma1!, 'base64')), TEXT_LENGTH);
    expect(createHash('sha256').update(one).digest('hex')).toBe(TEXT_SHA256);
    const two = decodeLzma2(new Uint8Array(Buffer.from(lzma2!, 'base64')), TEXT_LENGTH);
    expect(createHash('sha256').update(two).digest('hex')).toBe(TEXT_SHA256);
  });

  it('refuse a stream that is cut short or claims more than it holds', async () => {
    const { readFileSync } = await import('node:fs');
    const [, lzma1] = readFileSync(VECTORS, 'utf8').trim().split('\n');
    const bytes = new Uint8Array(Buffer.from(lzma1!, 'base64'));
    expect(() => decodeLzma(new Uint8Array([0x5d, 0, 0, 1, 0]), bytes.subarray(0, 100), TEXT_LENGTH)).toThrow();
    expect(() => decodeLzma2(new Uint8Array([0x80]), 10)).toThrow();
  });
});

const MARCH = Date.UTC(2024, 2, 1, 10) / 1000;
const files = () => [
  { name: 'dossier', directory: true, mtime: MARCH - 86400 },
  { name: 'dossier/rapport.docx', data: makeDocx(), mtime: MARCH },
  { name: 'dossier/notes.txt', data: new TextEncoder().encode('Bon​jour'), mtime: MARCH },
  { name: 'dossier/facture.pdf‮txt.exe', data: new TextEncoder().encode('MZ'), mtime: MARCH },
];

describe('[F-P3 2.2] 7z', () => {
  it('reads names, dates and each file, stored or in LZMA2, the header plain or encoded', async () => {
    for (const options of [{}, { coder: 'lzma2' as const }, { coder: 'lzma2' as const, encodeHeader: true }]) {
      const archive = sevenZip(files(), options);
      expect(detectFormat(archive)).toBe('7z');
      const { format, findings, notes } = await inspectFile(archive, 'dossier.7z');
      expect(format).toBe('7z');
      expect(findings.find((f) => f.label === 'Member dates')?.value).toBe('2024-02-29T10:00:00Z – 2024-03-01T10:00:00Z');
      expect(findings.some((f) => f.label === 'Author' && f.location.startsWith('dossier/rapport.docx → '))).toBe(true);
      expect(findings.some((f) => f.kind === 'invisible-character' && f.location.startsWith('dossier/notes.txt → '))).toBe(true);
      expect(findings.some((f) => f.kind === 'deceptive-name' && /facture/.test(f.location))).toBe(true);
      expect(notes.map((n) => n.code)).toContain('scope:archive-inspect-only');
    }
  });

  it('names what it does not read: a coder it does not decode, encrypted content', async () => {
    for (const [coder, name] of [['bzip2', 'BZip2'], ['aes', 'AES']] as const) {
      const { findings, notes } = await inspectFile(sevenZip(files(), { coder }), 'dossier.7z');
      expect(notes.find((n) => n.code === 'limit:archive-unread')?.detail).toBe(`${name}: dossier/rapport.docx, dossier/notes.txt, dossier/facture.pdf‮txt.exe`);
      // The names are still checked.
      expect(findings.some((f) => f.kind === 'deceptive-name')).toBe(true);
    }
  });

  it('refuses a damaged archive rather than read it wrong, and refuses to clean', async () => {
    const archive = sevenZip(files(), { coder: 'lzma2' });
    const damaged = archive.slice();
    damaged[40] = damaged[40]! ^ 0xff; // inside the packed content: a file's CRC no longer matches
    await expect(inspectFile(damaged, 'dossier.7z')).rejects.toMatchObject({ code: 'unparseable' });
    await expect(redactFile(archive, 'dossier.7z')).rejects.toMatchObject({ code: 'archive-inspect-only', detail: '7z' });
  });
});

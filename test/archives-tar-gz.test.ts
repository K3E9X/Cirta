import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { detectFormat, inspectFile, redactFile } from '../src/core/index.js';
import { makeDocx } from './fixtures.js';
import { tar, whereFroms } from './helpers/tar.js';

/*
 * [F-P3 2.2] TAR and gzip, inspected only: who owned each member and when,
 * what macOS remembers about where a file came from, links out of the
 * archive, the gzip header's original name and date — and every member
 * read as it would be on its own.
 */

const MARCH = Date.UTC(2024, 2, 1, 10) / 1000;
const JANUARY = Date.UTC(2024, 0, 2, 9) / 1000;

function release(): Uint8Array {
  return tar([
    { name: 'dossier/', type: '5', uname: 'marie', gname: 'staff', uid: 501, gid: 20, mtime: JANUARY },
    { name: 'dossier/rapport.docx', data: makeDocx(), uname: 'marie', gname: 'staff', uid: 501, gid: 20, mtime: MARCH, pax: { 'SCHILY.xattr.com.apple.quarantine': '0083;65e1a2b3;Safari;9F2C1E7A-2B4C-4D5E-8F90-1A2B3C4D5E6F', 'SCHILY.xattr.com.apple.metadata:kMDItemWhereFroms': 'bplist00¡\u0001_\u0010https://intranet.example.com/rh/rapport.docx' } },
    { name: 'dossier/notes.txt', data: 'Bon​jour', uname: 'marie', uid: 501, mtime: MARCH },
    { name: 'dossier/lien', type: '2', link: '/Users/marie/Documents/secret.txt', uname: 'marie', uid: 501, mtime: MARCH },
    { name: '../evasion.txt', data: 'x', uname: 'marie', uid: 501, mtime: MARCH },
    { name: `dossier/${'tres-long-'.repeat(12)}nom.txt`, data: 'y\u200bz', uname: 'marie', uid: 501, mtime: MARCH },
    { name: 'dossier/._rapport.docx', data: whereFroms('https://mail.example.com/attachment/42'), uname: 'marie', uid: 501, mtime: MARCH },
  ]);
}

describe('[F-P3 2.2] TAR', () => {
  it('reads the owners, the dates, the macOS attributes, the links, and each member as itself', async () => {
    const { format, findings, notes } = await inspectFile(release(), 'dossier.tar');
    expect(format).toBe('tar');
    const by = (label: string) => findings.filter((f) => f.label === label).map((f) => f.value);
    expect(by('Owner account')).toEqual(['marie (uid 501)']);
    expect(by('Member dates')).toEqual(['2024-01-02T09:00:00Z – 2024-03-01T10:00:00Z']);
    expect(by('Download address')).toEqual(expect.arrayContaining(['https://intranet.example.com/rh/rapport.docx', 'https://mail.example.com/attachment/42']));
    expect(by('Quarantine attribute (macOS)')).toEqual(['Safari, 0083;65e1a2b3']);
    expect(by('Link to an absolute path')).toEqual(['dossier/lien → /Users/marie/Documents/secret.txt']);
    // The members: the Word file's author, the zero-width space in the note, a name that climbs out of the folder.
    expect(findings.some((f) => f.label === 'Author' && f.location.startsWith('dossier/rapport.docx → '))).toBe(true);
    expect(findings.some((f) => f.kind === 'invisible-character' && f.location.startsWith('dossier/notes.txt → '))).toBe(true);
    expect(findings.some((f) => f.kind === 'deceptive-name' && /evasion/.test(f.location + f.value))).toBe(true);
    // A GNU long name is followed, not cut at 100 characters.
    expect(findings.some((f) => f.location.startsWith(`dossier/${'tres-long-'.repeat(12)}nom.txt → `))).toBe(true);
    expect(notes.map((n) => n.code)).toContain('scope:archive-inspect-only');
  });

  it('is refused on cleaning, saying what to do', async () => {
    await expect(redactFile(release(), 'dossier.tar')).rejects.toMatchObject({ code: 'archive-inspect-only', detail: 'tar' });
  });
});

describe('[F-P3 2.2] gzip', () => {
  it('reads the header — the original name, its date, the system — and the content, a TAR in turn', async () => {
    const gz = gzipSync(release(), { filename: 'dossier-marie.tar', mtime: new Date(MARCH * 1000) });
    expect(detectFormat(gz)).toBe('gz');
    const { format, findings } = await inspectFile(gz, 'dossier.tar.gz');
    expect(format).toBe('gz');
    const by = (label: string) => findings.filter((f) => f.label === label).map((f) => `${f.value} @ ${f.location}`);
    expect(by('Original file name')).toEqual(['dossier-marie.tar @ gzip header']);
    expect(by('Date modified')).toEqual(['2024-03-01T10:00:00Z @ gzip header']);
    // The TAR inside is read like the TAR above.
    expect(by('Owner account')).toEqual(['marie (uid 501) @ dossier-marie.tar → TAR headers (uname)']);
    expect(findings.some((f) => f.label === 'Author' && f.location.startsWith('dossier-marie.tar → dossier/rapport.docx → '))).toBe(true);
  });

  it('reads a single gzipped document, and refuses to clean it', async () => {
    const gz = gzipSync(makeDocx(), { filename: 'rapport.docx' });
    const { findings } = await inspectFile(gz, 'rapport.docx.gz');
    expect(findings.some((f) => f.label === 'Author' && f.location.startsWith('rapport.docx → '))).toBe(true);
    await expect(redactFile(gz, 'rapport.docx.gz')).rejects.toMatchObject({ code: 'archive-inspect-only', detail: 'gz' });
  });

  it('refuses a gzip that inflates past the archive limit rather than read it in part', async () => {
    const bomb = gzipSync(new Uint8Array(300 * 1024 * 1024));
    await expect(inspectFile(bomb, 'bomb.gz')).rejects.toMatchObject({ code: 'archive-too-large' });
  }, 60_000);
});

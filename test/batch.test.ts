import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { inspectFile, redactFile } from '../src/core/index.js';
import { cleanBatch, batchPath } from '../src/shared/batch.js';
import { isSupportedFile, SKIP_DIRECTORIES } from '../src/shared/files.js';
import { makeDocx, makeJpeg } from './fixtures.js';
import { legacyOffice } from './helpers/ole.js';

const deps = { inspect: (data: Uint8Array, hint?: string) => inspectFile(data, hint), redact: (data: Uint8Array, hint?: string) => redactFile(data, hint) };
const at = new Date('2026-10-19T08:00:00Z');

describe('[F-P2 2.7] cleaning a folder at once', () => {
  it('cleans every file into one ZIP, keeping the folder’s paths, with a manifest that names each refusal', async () => {
    const files = [
      { path: 'dossier/lettre.docx', data: makeDocx() },
      { path: 'dossier/photos/plage.jpg', data: makeJpeg() },
      { path: 'dossier/notes.txt', data: strToU8('Bon\u200bjour') },
      { path: 'dossier/ancien.doc', data: legacyOffice('doc', { summary: { 4: 'Jeanne' } }) },
    ];
    const out = await cleanBatch(files, deps, { version: '9.9.9', options: { removeComments: true }, at });
    const zip = unzipSync(out.zip);
    expect(Object.keys(zip).sort()).toEqual(['ciirta-manifest.json', 'dossier/lettre.docx', 'dossier/notes.txt', 'dossier/photos/plage.jpg']);
    expect(strFromU8(zip['dossier/notes.txt']!)).toBe('Bonjour');
    expect((await inspectFile(zip['dossier/photos/plage.jpg']!, 'plage.jpg')).findings.filter((f) => f.confidence === 'confirmed')).toEqual([]);

    const manifest = JSON.parse(strFromU8(zip['ciirta-manifest.json']!));
    expect(manifest).toMatchObject({ schema: 'ciirta.manifest/1', tool: { name: 'ciirta', version: '9.9.9' }, createdAt: '2026-10-19T08:00:00.000Z', options: { removeComments: true } });
    expect(manifest.files.map((f: { file: string }) => f.file)).toEqual(['dossier/lettre.docx', 'dossier/photos/plage.jpg', 'dossier/notes.txt']);
    expect(manifest.refused).toEqual([{ file: 'dossier/ancien.doc', code: 'legacy-not-rewritable' }]);
    expect(out.refused.map((r) => r.file)).toEqual(['dossier/ancien.doc']);
    // The manifest never carries a value the clean removed.
    expect(strFromU8(zip['ciirta-manifest.json']!)).not.toContain('Jeanne');
  });

  it('gives the same archive twice for the same files, and does not let a name climb out of the folder', async () => {
    const files = [{ path: 'a.txt', data: strToU8('x\u200b') }];
    const first = await cleanBatch(files, deps, { version: '1', options: {}, at });
    const second = await cleanBatch(files, deps, { version: '1', options: {}, at });
    expect(Buffer.from(first.zip).equals(Buffer.from(second.zip))).toBe(true);
    expect(batchPath('../../etc/passwd')).toBe('etc/passwd');
    expect(batchPath('/abs/a.txt')).toBe('abs/a.txt');
    expect(batchPath('C:\\Users\\j\\a.txt')).toBe('Users/j/a.txt');
    const twice = await cleanBatch([{ path: 'a.txt', data: strToU8('x') }, { path: 'a.txt', data: strToU8('y') }], deps, { version: '1', options: {}, at });
    expect(Object.keys(unzipSync(twice.zip)).sort()).toEqual(['a (2).txt', 'a.txt', 'ciirta-manifest.json']);
  });

  it('takes from a folder the files the command line would, and skips what is never the user’s own', () => {
    expect(isSupportedFile('rapport.docx')).toBe(true);
    expect(isSupportedFile('.env')).toBe(true);
    expect(isSupportedFile('programme.exe')).toBe(false);
    expect(SKIP_DIRECTORIES.has('node_modules')).toBe(true);
  });
});

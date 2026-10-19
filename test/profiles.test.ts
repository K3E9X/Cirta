import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { CLEAN_KEYS } from '../src/shared/clean-plan.js';
import { PROFILES } from '../src/shared/profiles.js';
import { runCli } from './helpers/cli.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const commented = () =>
  zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'docProps/core.xml': strToU8('<cp:coreProperties xmlns:cp="c" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Jeanne</dc:creator></cp:coreProperties>'),
    'word/document.xml': strToU8(`<w:document ${W}><w:body><w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Texte</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p></w:body></w:document>`),
    'word/comments.xml': strToU8(`<w:comments ${W}><w:comment w:id="0" w:author="Marc"><w:p><w:r><w:t>Chiffre faux</w:t></w:r></w:p></w:comment></w:comments>`),
  });

describe('[F-P2 2.3] profiles', () => {
  it('grow from minimal to strict, and strict sets every option the cleaner has', () => {
    expect(Object.keys(PROFILES.minimal.options)).toEqual([]);
    expect(Object.keys(PROFILES.balanced.options).sort()).toEqual(['stripActive', 'stripRemote', 'stripTracking']);
    expect(Object.keys(PROFILES.strict.options).sort()).toEqual([...CLEAN_KEYS].sort());
    expect([PROFILES.minimal.failOn, PROFILES.balanced.failOn, PROFILES.strict.failOn]).toEqual(['confirmed', 'confirmed', 'probable']);
  });

  it('sets the cleaning options in one word: strict removes comments, minimal keeps them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cirta-profile-'));
    const input = join(dir, 'lettre.docx');
    writeFileSync(input, commented());
    expect(runCli(['redact', '--profile', 'minimal', input, '-o', join(dir, 'min.docx')]).status).toBe(0);
    expect(unzipSync(new Uint8Array(readFileSync(join(dir, 'min.docx'))))['word/comments.xml']).toBeDefined();
    const run = runCli(['redact', '--lang', 'fr', '--profile', 'strict', input, '-o', join(dir, 'strict.docx')]);
    expect(run.status).toBe(0);
    expect(unzipSync(new Uint8Array(readFileSync(join(dir, 'strict.docx'))))['word/comments.xml']).toBeUndefined();
  });

  it('sets the --fail-on threshold, which an explicit --fail-on overrides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cirta-profile-'));
    // A title and a date: probable findings, nothing confirmed.
    const file = join(dir, 'titre.docx');
    writeFileSync(
      file,
      zipSync({
        '[Content_Types].xml': strToU8('<Types/>'),
        'docProps/core.xml': strToU8('<cp:coreProperties xmlns:cp="c" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Rapport</dc:title><dcterms:created>2026-01-01T00:00:00Z</dcterms:created></cp:coreProperties>'),
        'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>'),
      }),
    );
    expect(runCli(['verify', '--profile', 'balanced', file]).status).toBe(0);
    expect(runCli(['verify', '--profile', 'strict', file]).status).toBe(1);
    expect(runCli(['verify', '--profile', 'strict', '--fail-on', 'confirmed', file]).status).toBe(0);
  });

  it('refuses a profile it does not know, in French too', () => {
    const run = runCli(['redact', '--lang', 'fr', '--profile', 'paranoid', 'x.pdf']);
    expect(run.status).toBe(2);
    expect(run.stderr.toString()).toContain('Profil inconnu : paranoid (minimal, balanced, strict)');
  });
});

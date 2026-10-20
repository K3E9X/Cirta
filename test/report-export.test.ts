import { describe, expect, it } from 'vitest';
import { inspectFile } from '../src/core/index.js';
import { reportHtml, reportMarkdown } from '../src/shared/report-export.js';
import { makeDocx } from './fixtures.js';
import { runCli } from './helpers/cli.js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const enc = (s: string) => new TextEncoder().encode(s);
const meta = { version: '9.9.9', at: new Date('2026-10-19T08:00:00Z') };

async function entries() {
  // A value written to act: markup, a pipe, a remote picture.
  const notes = enc('---\nauthor: <script>alert(1)</script> | ![x](https://suivi.example/p.gif)\n---\n\nBonjour\n');
  return [
    { file: 'lettre.docx', result: await inspectFile(makeDocx(), 'lettre.docx') },
    { file: 'notes.md', result: await inspectFile(notes, 'notes.md') },
    { file: 'casse.pdf', error: 'Ce fichier n’a pas pu être lu.' },
  ];
}

describe('[F-P2 2.7] exporting the report', () => {
  it('as a standalone HTML page that cannot run anything, values escaped', async () => {
    const html = reportHtml(await entries(), 'fr', meta);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('lettre.docx');
    expect(html).toContain('Auteur');
    expect(html).toContain('confirmé');
    expect(html).toContain('Ce fichier n’a pas pu être lu.');
    expect(html).toContain('Ciirta 9.9.9');
    expect(reportHtml(await entries(), 'en', meta)).toContain('Author');
  });

  it('as Markdown whose values are code, so a table cell can neither break the table nor load a picture', async () => {
    const md = reportMarkdown(await entries(), 'fr', meta);
    expect(md).toMatch(/^# Rapport Ciirta/);
    expect(md).toContain('## lettre.docx');
    expect(md).toContain('| Niveau | Type | Champ | Valeur | Emplacement |');
    const row = md.split('\n').find((line: string) => line.includes('alert(1)'))!;
    expect(row).toContain('`<script>alert(1)</script> \\| ![x](https://suivi.example/p.gif)`');
    // Five cells, the pipe in the value escaped.
    expect(row.split(/(?<!\\)\|/).length).toBe(7);
    expect(md).toContain('Ce fichier n’a pas pu être lu.');
    expect(reportMarkdown(await entries(), 'en', meta)).toMatch(/^# Ciirta report/);
  });

  it('from the command line, with --report, in the reader’s language', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ciirta-report-'));
    writeFileSync(join(dir, 'lettre.docx'), makeDocx());
    const out = join(dir, 'rapport.md');
    const run = runCli(['inspect', '--lang', 'fr', '--report', out, join(dir, 'lettre.docx')]);
    expect(run.status).toBe(0);
    expect(readFileSync(out, 'utf8')).toMatch(/^# Rapport Ciirta[\s\S]*Auteur/);
    expect(run.stdout.toString()).toContain('Rapport écrit');
    const page = join(dir, 'rapport.html');
    expect(runCli(['inspect', '--report', page, '--json', join(dir, 'lettre.docx')]).status).toBe(0);
    expect(readFileSync(page, 'utf8')).toContain('<table>');
    const bad = runCli(['inspect', '--lang', 'fr', '--report', join(dir, 'rapport.pdf'), join(dir, 'lettre.docx')]);
    expect(bad.status).toBe(2);
    expect(bad.stderr.toString()).toContain('--report attend un fichier .html ou .md');
  });
});

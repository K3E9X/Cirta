import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { deck } from './helpers/deck.js';
import { activePdf } from './helpers/active-pdf.js';
import { runCli } from './helpers/cli.js';

/*
 * [F-2.4] Every content option is a flag, off unless given, and announced in
 * the report when it changed something.
 */

describe('[F-2.4] content options from the command line', () => {
  it('removes notes and hidden slides, and says so in French', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ciirta-opts-'));
    const input = join(dir, 'deck.pptx');
    writeFileSync(input, deck([{ words: 'Un', notes: 'note' }, { words: 'Deux', hidden: true }, { words: 'Trois' }]));
    const output = join(dir, 'out.pptx');
    const run = runCli(['redact', '--lang', 'fr', '--remove-notes', '--remove-hidden-slides', input, '-o', output]);
    expect(run.status).toBe(0);
    const out = run.stdout.toString();
    expect(out).toContain('Diapositive masquée retirée');
    expect(out).toContain('Notes du présentateur retirées');
    const parts = unzipSync(new Uint8Array(readFileSync(output)));
    expect(Object.keys(parts).some((p) => p.includes('notesSlide'))).toBe(false);
  });

  it('removes attachments and flattens annotations in a PDF, and says so', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ciirta-opts-'));
    const input = join(dir, 'facture.pdf');
    writeFileSync(input, await activePdf());
    const run = runCli(['redact', '--lang', 'en', '--remove-attachments', '--flatten-annotations', input, '-o', join(dir, 'out.pdf')]);
    expect(run.status).toBe(0);
    expect(run.stdout.toString()).toMatch(/Removed 1 embedded file/);
  });
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectFile, redactFile, UnsupportedFormatError } from '../src/core/index.js';
import { runCli } from './helpers/cli.js';

/*
 * [C10.6] An empty .pdf came back as "(text) — No metadata found": true, and
 * misleading, since there was nothing to look at. It is now called empty.
 */

describe('[C10.6] an empty file', () => {
  it('is refused as empty by inspection and by cleaning, whatever its name', async () => {
    for (const name of ['report.pdf', 'notes.txt', undefined]) {
      await expect(inspectFile(new Uint8Array(0), name)).rejects.toMatchObject({ code: 'empty-file' });
      await expect(redactFile(new Uint8Array(0), name)).rejects.toBeInstanceOf(UnsupportedFormatError);
    }
  });

  it('says so from the command line, in French too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ciirta-empty-'));
    const file = join(dir, 'vide.pdf');
    writeFileSync(file, new Uint8Array(0));
    const run = runCli(['inspect', '--lang', 'fr', file]);
    expect(run.stderr.toString() + run.stdout.toString()).toContain('Fichier vide');
    expect(run.status).toBe(1);
  });
});

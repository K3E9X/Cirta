import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSingle } from '../scripts/build-single.mjs';
import { makeDocx } from './fixtures.js';

/*
 * [F-P3 2.5] The library as one file, for tools that embed it: no import, no
 * dependency, nothing of Node's. Loaded here from a folder with no
 * node_modules, and as a classic script in a bare context that has only what
 * a browser or a worker provides.
 */

describe('[F-P3 2.5] the single-file build', () => {
  const out = mkdtempSync(join(tmpdir(), 'cirta-single-'));
  let files: { module: string; script: string };

  beforeAll(async () => {
    files = await buildSingle(out);
  }, 60_000);

  it('imports nothing: every dependency is inside, and nothing of Node is needed', () => {
    for (const file of [files.module, files.script]) {
      const source = readFileSync(file, 'utf8');
      // Statements only: the word itself is data in places (LaTeX's \import).
      expect(source).not.toMatch(/^\s*(?:import|export)\s[^;'"]*?\bfrom\s*['"]|^\s*import\s*['"]|\brequire\(\s*['"]|\bimport\(\s*['"]/m);
      expect(source).not.toMatch(/['"]node:[a-z]/);
    }
  });

  it('as a module, from a folder with no node_modules, inspects and cleans a document', () => {
    // Imported by a Node of its own, natively: no test runner resolving anything for it.
    const alone = mkdtempSync(join(tmpdir(), 'cirta-alone-'));
    copyFileSync(files.module, join(alone, 'cirta.mjs'));
    writeFileSync(join(alone, 'rapport.docx'), makeDocx());
    const script = `
      import { readFileSync } from 'node:fs';
      const cirta = await import(${JSON.stringify(pathToFileURL(join(alone, 'cirta.mjs')).href)});
      const bytes = new Uint8Array(readFileSync(${JSON.stringify(join(alone, 'rapport.docx'))}));
      const report = await cirta.inspectFile(bytes, 'rapport.docx');
      const cleaned = await cirta.redactFile(bytes, 'rapport.docx');
      console.log(JSON.stringify({ values: report.findings.map((f) => f.value), removed: cleaned.removed.length, schema: cirta.REPORT_SCHEMA }));
    `;
    const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: alone, encoding: 'utf8' }));
    expect(out.values.some((value: string) => /Lotfi Zakaria/.test(value))).toBe(true);
    expect(out.removed).toBeGreaterThan(0);
    expect(out.schema).toBe('cirta.report/1');
  });

  it('as a classic script, in a context with only what a browser offers', async () => {
    const context = createContext({ TextDecoder, TextEncoder, crypto: globalThis.crypto, atob, btoa, structuredClone, console });
    runInContext(readFileSync(files.script, 'utf8'), context);
    const cirta = (context as { Cirta: { inspectFile: (data: Uint8Array, hint?: string) => Promise<{ findings: Array<{ value: string }> }> } }).Cirta;
    const report = await cirta.inspectFile(makeDocx(), 'rapport.docx');
    expect(report.findings.some((f) => /Lotfi Zakaria/.test(f.value))).toBe(true);
    const text = await cirta.inspectFile(new TextEncoder().encode('Bon​jour'), 'note.txt');
    expect(text.findings.length).toBeGreaterThan(0);
  });

  it('is attested and attached to each release', () => {
    const release = readFileSync('.github/workflows/release.yml', 'utf8');
    const job = release.slice(release.indexOf('\n  single-file:'), release.indexOf('\n  github-release:'));
    expect(job).toMatch(/build-single\.mjs[\s\S]*attest-build-provenance@v2[\s\S]*subject-path: 'build\/single\/\*'/);
    expect(release).toMatch(/needs: \[binaries, extensions, single-file\]/);
  });
});

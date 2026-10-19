import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redactFile } from '../src/core/index.js';
import { makeDocx, makeJpeg } from './fixtures.js';
import { runCli } from './helpers/cli.js';

/*
 * [F-2.4] `cirta verify`: the gate before a file goes out. It inspects again
 * and fails when anything at or above a level is still there — confirmed by
 * default, stricter with --fail-on.
 */

async function files() {
  const dir = mkdtempSync(join(tmpdir(), 'cirta-verify-'));
  const dirty = join(dir, 'lettre.docx');
  const clean = join(dir, 'lettre.clean.docx');
  writeFileSync(dirty, makeDocx());
  writeFileSync(clean, (await redactFile(makeDocx(), 'lettre.docx')).data!);
  return { dir, dirty, clean };
}

describe('[F-2.4] cirta verify', () => {
  it('passes a cleaned file, exit 0', async () => {
    const { clean } = await files();
    const run = runCli(['verify', '--lang', 'en', clean]);
    expect(run.status).toBe(0);
    expect(run.stdout.toString()).toMatch(/pass/i);
  });

  it('fails a file that still carries a confirmed finding, exit 1, and says which', async () => {
    const { dirty } = await files();
    const run = runCli(['verify', '--lang', 'fr', dirty]);
    expect(run.status).toBe(1);
    const out = run.stdout.toString();
    expect(out).toMatch(/échec/i);
    expect(out).toContain('Lotfi Zakaria');
  });

  it('is stricter with --fail-on probable', async () => {
    const { dir } = await files();
    // Camera Exif without a position: probable, nothing confirmed.
    const photo = join(dir, 'photo.jpg');
    writeFileSync(photo, makeJpeg({ gps: false }));
    expect(runCli(['verify', photo]).status).toBe(0);
    expect(runCli(['verify', '--fail-on', 'probable', photo]).status).toBe(1);
  });

  it('answers in JSON for a pipeline', async () => {
    const { dirty, clean } = await files();
    const run = runCli(['verify', '--json', dirty, clean]);
    expect(run.status).toBe(1);
    const report = JSON.parse(run.stdout.toString()) as Array<{ file: string; pass: boolean; level: string; findings: unknown[] }>;
    expect(report.map((r) => r.pass)).toEqual([false, true]);
    expect(report[0]!.level).toBe('confirmed');
    expect(report[0]!.findings.length).toBeGreaterThan(0);
  });

  it('fails a file it cannot read', () => {
    const run = runCli(['verify', join(tmpdir(), 'cirta-absent-verify.pdf')]);
    expect(run.status).toBe(1);
  });
});

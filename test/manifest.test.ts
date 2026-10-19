import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { manifest, manifestEntry, MANIFEST_SCHEMA } from '../src/core/manifest.js';
import { inspectFile, redactFile } from '../src/core/index.js';
import { makeDocx, makePdf } from './fixtures.js';
import { runCli } from './helpers/cli.js';

const hex = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

describe('[F-P2 2.4] chain-of-custody manifest', () => {
  it('records hashes, sizes, findings before and after, by label — never by value', async () => {
    const before = makeDocx();
    const cleaned = await redactFile(before, 'a.docx');
    const entry = await manifestEntry({
      file: 'a.docx',
      format: cleaned.format,
      before,
      after: cleaned.data!,
      findingsBefore: (await inspectFile(before, 'a.docx')).findings,
      findingsAfter: (await inspectFile(cleaned.data!, 'a.docx')).findings,
      notes: cleaned.notes.map((n) => n.code),
    });
    expect(entry.before).toMatchObject({ sha256: hex(before), size: before.length });
    expect(entry.after).toMatchObject({ sha256: hex(cleaned.data!), size: cleaned.data!.length });
    expect(entry.before.findings.some((f) => f.label === 'Author')).toBe(true);
    expect(entry.after.findings.some((f) => f.label === 'Author')).toBe(false);
    // The author's name is what the clean removed: it is not carried here.
    expect(JSON.stringify(entry)).not.toContain('Lotfi');

    const m = manifest('1.2.3', { removeComments: true, acceptChanges: false, rules: [{ id: 'projet' } as never] }, [entry], new Date('2026-10-18T12:00:00Z'));
    expect(m).toMatchObject({ schema: MANIFEST_SCHEMA, tool: { name: 'cirta', version: '1.2.3' }, createdAt: '2026-10-18T12:00:00.000Z', options: { removeComments: true, rules: ['projet'] } });
    expect(m.options).not.toHaveProperty('acceptChanges');
  });

  it('is written by redact --manifest, one entry per file, with the version of Cirta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cirta-manifest-'));
    const pdf = join(dir, 'offre.pdf');
    const docx = join(dir, 'lettre.docx');
    writeFileSync(pdf, await makePdf());
    writeFileSync(docx, makeDocx());
    const out = join(dir, 'manifeste.json');
    const run = runCli(['redact', '--manifest', out, '--remove-comments', pdf, docx]);
    expect(run.status).toBe(0);
    const m = JSON.parse(readFileSync(out, 'utf8'));
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    expect(m.tool).toEqual({ name: 'cirta', version });
    expect(m.options).toEqual({ removeComments: true });
    expect(m.files.map((f: { file: string }) => f.file)).toEqual([pdf, docx]);
    for (const entry of m.files) {
      expect(entry.after.sha256).toBe(hex(new Uint8Array(readFileSync(entry.output))));
      expect(entry.before.sha256).toBe(hex(new Uint8Array(readFileSync(entry.file))));
    }
    expect(readFileSync(out, 'utf8')).not.toContain('Lotfi');
  });
});

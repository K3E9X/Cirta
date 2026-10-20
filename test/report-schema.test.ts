import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { strToU8, zipSync } from 'fflate';
import { inspectFile } from '../src/core/index.js';
import { makeDocx, makePdf, makePng } from './fixtures.js';
import { runCli } from './helpers/cli.js';
import { outlookMessage } from './helpers/ole.js';

/*
 * [F-P2 2.5] The JSON report is versioned and its schema published:
 * schema/report.v1.json. What the command line prints, and what the library
 * returns, must validate against it.
 */

const schema = JSON.parse(readFileSync('schema/report.v1.json', 'utf8'));
// strictRequired would reject the oneOf that says an entry has a result or an error.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const validate = ajv.compile(schema);
const validateResult = ajv.compile({ $ref: 'https://github.com/K3E9X/Cirta/schema/report.v1.json#/$defs/result' });

describe('[F-P2 2.5] the versioned JSON report', () => {
  it('validates what inspect --json prints, results and refusals alike', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ciirta-schema-'));
    const files = {
      'offre.pdf': await makePdf(),
      'lettre.docx': makeDocx(),
      'image.png': makePng(),
      'message.msg': outlookMessage({ strings: { 0x0c1a: 'Jeanne' } }),
      'archive.zip': zipSync({ 'a.txt': strToU8('Bon​jour') }),
      'vide.pdf': new Uint8Array(),
      'inconnu.bin': new Uint8Array([0, 1, 2, 3, 0, 0, 0xff, 7]),
    };
    for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
    const run = runCli(['inspect', '--json', ...Object.keys(files).map((n) => join(dir, n))]);
    const report = JSON.parse(run.stdout.toString());
    const ok = validate(report);
    expect(ajv.errorsText(validate.errors), 'schema errors').toBe('No errors');
    expect(ok).toBe(true);
    expect(report.every((entry: { schema: string }) => entry.schema === 'ciirta.report/1')).toBe(true);
    const empty = report.find((entry: { file: string }) => entry.file.endsWith('vide.pdf'));
    expect(empty.code).toBe('empty-file');
  });

  it('validates what the library returns', async () => {
    for (const [data, hint] of [[await makePdf(), 'a.pdf'], [makeDocx(), 'a.docx'], [strToU8('Bon​jour'), 'a.txt']] as const) {
      const result = await inspectFile(data, hint, { pii: true });
      expect(validateResult(JSON.parse(JSON.stringify(result))), ajv.errorsText(validateResult.errors)).toBe(true);
    }
  });
});

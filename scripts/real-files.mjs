/**
 * Round-trip real Office and OpenDocument files through redaction.
 *
 * Every unit-test fixture in this repository is built by hand. That is fast and
 * precise, but a hand-built container shares the parser's own assumptions — the
 * one genuinely signed image in the suite is what caught the CBOR reader
 * assuming manifests hold no indefinite-length items.
 *
 * So this asks LibreOffice to produce a document, redacts it, and asks
 * LibreOffice to open the result. A converter that succeeds is a far stronger
 * statement than any assertion written here: a real implementation accepted the
 * file. Corrupting a Word document is the worst outcome this tool has, and
 * nothing else in the suite would notice it.
 *
 * The first conversion is the control. If LibreOffice cannot even produce the
 * input — it is absent, sandboxed, or missing a filter — this skips loudly
 * rather than failing, because that says nothing about the redaction. Only a
 * document that LibreOffice made and then refused to reopen is a real defect,
 * and that is the only thing here that fails the run.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import process from 'node:process';

import { inspectFile, redactFile } from '../dist/core/index.js';

const run = promisify(execFile);

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const skip = (reason) => {
  console.log(`\nSKIPPED — ${reason}`);
  console.log('This says nothing about redaction; it means the control could not be produced.');
  process.exit(0);
};

/** A fresh profile per call, or concurrent invocations fight over one and hang. */
async function soffice(args, tag) {
  return run(
    'soffice',
    [`-env:UserInstallation=file://${join(tmpdir(), `cirta-lo-${tag}`)}`, '--headless', ...args],
    { timeout: 180_000 },
  );
}

const dir = await mkdtemp(join(tmpdir(), 'cirta-real-'));
console.log(`real-file round trip — ${process.platform}`);

try {
  try {
    await run('soffice', ['--version'], { timeout: 60_000 });
  } catch {
    skip('LibreOffice is not installed');
  }

  const source = join(dir, 'source.txt');
  // A zero-width space and French typography, so the round trip exercises both
  // what should be removed and what should survive.
  await writeFile(source, 'Rapport trimestriel​\nObjet : typographie\n', 'utf8');

  const formats = ['docx', 'odt'];
  for (const [index, format] of formats.entries()) {
    try {
      await soffice(['--convert-to', format, '--outdir', dir, source], `in${index}`);
    } catch (error) {
      skip(`LibreOffice could not convert the source (${String(error).slice(0, 120)})`);
    }
  }

  const produced = (await readdir(dir)).filter((name) => /\.(docx|odt)$/.test(name));
  if (produced.length === 0) skip('LibreOffice produced no documents from the source');
  console.log(`  control: LibreOffice produced ${produced.join(', ')}`);

  for (const name of produced) {
    const original = new Uint8Array(await readFile(join(dir, name)));

    const report = await inspectFile(original);
    check(`${name}: inspected as ${report.format}`, report.format !== 'zip');
    check(
      `${name}: found the metadata LibreOffice wrote`,
      report.findings.length > 0,
      'no findings at all in a freshly authored document',
    );

    const redacted = await redactFile(original);
    const cleanName = name.replace(/(\.[^.]+)$/, '.clean$1');
    await writeFile(join(dir, cleanName), redacted.data);

    check(
      `${name}: nothing confirmed survives redaction`,
      !(await inspectFile(redacted.data)).findings.some((f) => f.confidence === 'confirmed'),
    );

    // The point of this whole script: a real implementation must still accept it.
    const out = join(dir, `out-${name}`);
    try {
      await soffice(['--convert-to', 'pdf', '--outdir', out, join(dir, cleanName)], `out-${name}`);
      const converted = await readdir(out);
      check(
        `${name}: reopens in LibreOffice after redaction`,
        converted.some((file) => file.endsWith('.pdf')),
        `converted: ${converted.join(', ') || 'nothing'}`,
      );
    } catch (error) {
      check(`${name}: reopens in LibreOffice after redaction`, false, String(error).slice(0, 200));
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall real-file checks passed');

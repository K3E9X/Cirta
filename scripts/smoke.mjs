/**
 * End-to-end check of the built CLI, run on Windows, Linux and macOS in CI.
 *
 * The unit tests exercise the core in-process. This runs the actual binary the
 * way a user does — argument parsing, path handling, recursive directory
 * walking, file writing, exit codes — because that is the layer where
 * portability breaks rather than in the parsing logic.
 */

import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { PDFDocument } from 'pdf-lib';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { inspectFile } from '../dist/core/index.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'index.js');

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Run the CLI with bytes on stdin, keeping stdout and stderr distinguishable. */
function runCliWithInput(args, input) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      input,
      encoding: 'buffer',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    return { status: 0, stdout: stdout.toString('utf8'), output: stdout.toString('utf8') };
  } catch (error) {
    return {
      status: error.status ?? 1,
      stdout: (error.stdout ?? Buffer.alloc(0)).toString('utf8'),
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

function runCli(args) {
  try {
    return {
      status: 0,
      output: execFileSync(process.execPath, [CLI, ...args], {
        encoding: 'utf8',
        // Force colour off so assertions match plain text on every platform.
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      }),
    };
  } catch (error) {
    return { status: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

async function makePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]).drawText('contenu');
  pdf.setAuthor('Test Author');
  pdf.setProducer('python-pptx via /home/testuser/work');
  return Buffer.from(await pdf.save());
}

function makePptx() {
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Test Author</dc:creator></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Template>C:\\Users\\testuser\\Templates\\corp.potx</Template></Properties>`;
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      '_rels/.rels': strToU8('<Relationships/>'),
      'docProps/core.xml': strToU8(core),
      'docProps/app.xml': strToU8(app),
      'ppt/presentation.xml': strToU8('<p:presentation/>'),
    }),
  );
}

const dir = await mkdtemp(join(tmpdir(), 'cirta-smoke-'));
const nested = join(dir, 'nested');
await mkdir(nested);

const pdfPath = join(dir, 'sample.pdf');
const pptxPath = join(nested, 'sample.pptx');
await writeFile(pdfPath, await makePdf());
await writeFile(pptxPath, makePptx());

console.log(`cirta smoke test — ${process.platform} node ${process.versions.node}`);

try {
  // --- help ---------------------------------------------------------------
  const help = runCli(['--help']);
  check('--help exits 0', help.status === 0);
  check('--help documents the scope limit', help.output.includes('statistical model watermark'));

  // --- recursive inspect --------------------------------------------------
  const inspect = runCli(['inspect', dir]);
  check('inspect exits 0', inspect.status === 0, `status ${inspect.status}`);
  check('inspect walks subdirectories', inspect.output.includes('sample.pptx'));
  check('inspect reports the author', inspect.output.includes('Test Author'));
  check('inspect derives the OS account', /Windows account|Linux account/.test(inspect.output));
  check('inspect names the generating tool', inspect.output.includes('python-pptx'));
  check('inspect summarises a multi-file run', inspect.output.includes('Summary'));

  // --- json ---------------------------------------------------------------
  const json = runCli(['inspect', pdfPath, '--json']);
  check('--json exits 0', json.status === 0);
  let parsed;
  try {
    parsed = JSON.parse(json.output);
  } catch {
    parsed = undefined;
  }
  check('--json emits parseable output', Array.isArray(parsed) && parsed.length === 1);
  check(
    '--json carries confidence levels',
    parsed?.[0]?.result?.findings?.some((f) => f.confidence === 'confirmed'),
  );

  // --- redact -------------------------------------------------------------
  const outPath = join(dir, 'out.pdf');
  const redact = runCli(['redact', pdfPath, '-o', outPath]);
  check('redact exits 0', redact.status === 0, `status ${redact.status}`);
  const cleaned = await inspectFile(new Uint8Array(await readFile(outPath)));
  check('redacted PDF has no metadata left', cleaned.findings.length === 0,
    JSON.stringify(cleaned.findings.map((f) => f.label)));

  const pptxOut = join(dir, 'out.pptx');
  runCli(['redact', pptxPath, '-o', pptxOut]);
  const pptxParts = unzipSync(new Uint8Array(await readFile(pptxOut)));
  check('redacted PPTX drops the template path',
    !strFromU8(pptxParts['docProps/app.xml']).includes('testuser'));
  check('redacted PPTX is still a valid container',
    Object.keys(pptxParts).includes('ppt/presentation.xml'));

  // --- text on stdin ------------------------------------------------------
  const text = execFileSync(process.execPath, [CLI, 'text', '--clean'], {
    input: 'Bonjour,\u200b\u200b voici\ufeff le texte.',
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  check('text --clean strips invisible characters', text === 'Bonjour, voici le texte.',
    JSON.stringify(text));

  // --- binary input is refused, not silently mangled -----------------------
  const binary = runCliWithInput(['text', '--clean'], await readFile(pdfPath));
  check('text refuses binary input', binary.status === 2, `status ${binary.status}`);
  check('text says why it refused', /not text|UTF-8/.test(binary.output), binary.output);
  check('text writes nothing when refusing', binary.stdout === '', JSON.stringify(binary.stdout));

  // --- exit codes ---------------------------------------------------------
  check('missing file exits non-zero', runCli(['inspect', join(dir, 'nope.pdf')]).status !== 0);
  check('unknown command exits 2', runCli(['wat']).status === 2);
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');

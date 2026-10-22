#!/usr/bin/env node
/**
 * [F-P2 2.8] The command line as one executable, no Node installation
 * needed: a Node single executable application (SEA).
 *
 *   1. src/cli bundled into one CommonJS file (esbuild);
 *   2. Node turns it into a SEA blob;
 *   3. the blob is injected into a copy of this Node binary (postject);
 *   4. on macOS the copy is signed again ad hoc, which it needs to run.
 *
 * What the binary leaves out: the PDF renderer (pdfjs-dist) and the native
 * canvas, which a single file cannot carry. Without them it says so — the
 * hidden-text check on PDF pages does not run, --burn-redactions and
 * --reencode-images are refused —, as an npm install without the optional
 * canvas does. Everything else is the same program.
 *
 * Output: build/sea/ciirta-<platform>-<arch>[.exe], then a smoke test of it.
 * Platform code signing (Apple Developer ID, Windows Authenticode) is not
 * done here: it needs certificates the project does not hold. The release
 * workflow attests each binary instead (Sigstore, actions/attest-build-provenance).
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'build', 'sea');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const windows = process.platform === 'win32';
const name = `ciirta-${process.platform}-${process.arch}${windows ? '.exe' : ''}`;
const binary = join(out, name);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. One CommonJS file. The renderer and the canvas stay out: their dynamic
//    imports fail inside the binary, and the engines report themselves absent.
await build({
  entryPoints: [join(root, 'src/cli/index.ts')],
  outfile: join(out, 'ciirta.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['@napi-rs/canvas', 'pdfjs-dist', 'pdfjs-dist/*'],
  define: { CIIRTA_VERSION: JSON.stringify(pkg.version) },
  legalComments: 'none',
  logLevel: 'warning',
});

// 2. The blob.
const config = join(out, 'sea-config.json');
writeFileSync(config, JSON.stringify({ main: join(out, 'ciirta.cjs'), output: join(out, 'sea.blob'), disableExperimentalSEAWarning: true, useCodeCache: false }));
execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });

// 3. A copy of this Node, the blob injected.
copyFileSync(process.execPath, binary);
chmodSync(binary, 0o755);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', binary]);
const { inject } = await import('postject');
await inject(binary, 'NODE_SEA_BLOB', readFileSync(join(out, 'sea.blob')), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
});
// 4. macOS refuses to run a binary whose signature the injection broke.
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', binary]);

// The binary, tried as a user would.
const work = mkdtempSync(join(tmpdir(), 'ciirta-sea-'));
writeFileSync(join(work, 'note.txt'), 'Bon​jour');
const run = (args) => execFileSync(binary, args, { cwd: work, encoding: 'utf8' });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
check(`${name} runs without Node and says its version`, run(['--version']).trim().endsWith(pkg.version), run(['--version']));
const report = JSON.parse(run(['inspect', '--json', 'note.txt']));
check('it inspects a file', report[0]?.result?.findings?.some((f) => f.kind === 'invisible-character'));
run(['redact', 'note.txt']);
check('it cleans one', readFileSync(join(work, 'note.clean.txt'), 'utf8') === 'Bonjour');
rmSync(work, { recursive: true, force: true });

const hash = createHash('sha256').update(readFileSync(binary)).digest('hex');
writeFileSync(`${binary}.sha256`, `${hash}  ${name}\n`);
console.log(`\n${name}: ${Math.round(readFileSync(binary).length / 1024 / 1024)} MB, sha256 ${hash}`);
if (failures) process.exit(1);

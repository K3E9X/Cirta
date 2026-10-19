#!/usr/bin/env node
/**
 * [F-P3 2.5] The library as one file, for the tools that embed it rather than
 * install it: everything the core needs is inside, nothing is imported, and
 * nothing of Node's is used. It runs wherever modern JavaScript does — Node,
 * Deno, Bun, a browser, a worker — given the standard TextDecoder, Web Crypto
 * and structuredClone those all provide.
 *
 *   build/single/cirta.mjs        an ES module: import { inspectFile } from './cirta.mjs'
 *   build/single/cirta.global.js  a classic script: window.Cirta.inspectFile(…)
 *
 * What it leaves out is what the core leaves out: the PDF page renderer, which
 * a host plugs in (InspectOptions.xray), and the command line.
 *
 * Not a WebAssembly build: see REPORT_CLAUDE_CODE.md, F-P3 2.5.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Writes both files into `out` and returns their paths. */
export async function buildSingle(out = join(root, 'build', 'single')) {
  mkdirSync(out, { recursive: true });
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const common = {
    entryPoints: [join(root, 'src', 'core', 'index.ts')],
    bundle: true,
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2022',
    legalComments: 'eof',
    banner: { js: `/* Cirta ${pkg.version} — ${pkg.homepage} — MIT. Licences of the bundled libraries at the end of this file. */` },
    logLevel: 'warning',
  };
  const module = join(out, 'cirta.mjs');
  const script = join(out, 'cirta.global.js');
  await build({ ...common, format: 'esm', outfile: module });
  await build({ ...common, format: 'iife', globalName: 'Cirta', outfile: script });
  return { module, script };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { module, script } = await buildSingle();
  console.log(`${module}\n${script}`);
}

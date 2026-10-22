#!/usr/bin/env node
/**
 * [F-P2 2.6] The VS Code extension: integrations/vscode/src bundled with the
 * library into one CommonJS file, integrations/vscode/dist/extension.js.
 * `vscode` stays out — the editor provides it.
 *
 *   node scripts/build-vscode.mjs            the bundle
 *   node scripts/build-vscode.mjs --package  and the .vsix, with @vscode/vsce
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const extension = join(root, 'integrations', 'vscode');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

rmSync(join(extension, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: [join(extension, 'src', 'extension.ts')],
  outfile: join(extension, 'dist', 'extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  define: { CIIRTA_VERSION: JSON.stringify(pkg.version) },
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('integrations/vscode/dist/extension.js');

if (process.argv.includes('--package')) {
  // The licence goes in when the repository has one (see REPORT_CLAUDE_CODE.md, F-P2 2.8).
  const licence = existsSync(join(root, 'LICENSE'));
  if (licence) copyFileSync(join(root, 'LICENSE'), join(extension, 'LICENSE'));
  execFileSync('npx', ['--yes', '@vscode/vsce@3.6.0', 'package', '--no-dependencies', ...(licence ? [] : ['--skip-license'])], { cwd: extension, stdio: 'inherit', shell: process.platform === 'win32' });
}

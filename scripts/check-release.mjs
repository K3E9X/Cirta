#!/usr/bin/env node
/**
 * [F-P2 2.8] What a release must be before it is published, checked by the
 * release workflow before `npm publish` and before the binaries are built:
 *
 *   - the tag is the package's version (v1.2.3 for 1.2.3);
 *   - CHANGELOG.md describes that version under its own heading;
 *   - the licence file exists and travels in the package;
 *   - the package carries what the library's users import, its types, the
 *     report schema, the README, the licence and the changelog — and none of
 *     the sources, tests or fixtures;
 *   - package.json names the repository, which npm's provenance statement
 *     ties the package to, and asks for provenance.
 *
 *   node scripts/check-release.mjs v1.2.3
 *
 * Exit 1 with every problem listed; nothing is published.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

export const REQUIRED_FILES = [
  'dist/core/index.js',
  'dist/core/index.d.ts',
  'dist/cli/index.js',
  'dist/cli/node.js',
  'dist/cli/node.d.ts',
  'schema/report.v1.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'package.json',
];

const FORBIDDEN = /^(?:src|test|scripts|examples|assets|dist-web)\/|\.test\.|^\.github\//;

/** Every problem with a release, as sentences; none means it may go out. */
export function releaseProblems({ tag, pkg, changelog, licence, packed }) {
  const problems = [];
  if (tag !== undefined && tag !== `v${pkg.version}`) problems.push(`the tag ${tag} is not the package's version v${pkg.version}`);
  const heading = new RegExp(`^## \\[${pkg.version.replace(/\./g, '\\.')}\\]`, 'm');
  if (!heading.test(changelog ?? '')) problems.push(`CHANGELOG.md has no "## [${pkg.version}]" section: move Unreleased under it`);
  if (!licence) problems.push('there is no LICENSE file: the MIT licence asks for its notice, with the copyright holder, to travel with the package');
  for (const file of REQUIRED_FILES) if (!packed.includes(file)) problems.push(`the package does not carry ${file}`);
  const stray = packed.filter((file) => FORBIDDEN.test(file));
  if (stray.length) problems.push(`the package carries what it should not: ${stray.slice(0, 5).join(', ')}${stray.length > 5 ? '…' : ''}`);
  if (!/github\.com\/K3E9X\/Cirta/i.test(pkg.repository?.url ?? '')) problems.push('package.json names no repository, which npm provenance ties the package to');
  if (pkg.publishConfig?.provenance !== true) problems.push('package.json does not ask for provenance (publishConfig.provenance)');
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = new URL('../', import.meta.url);
  const read = (name) => (existsSync(new URL(name, root)) ? readFileSync(new URL(name, root), 'utf8') : undefined);
  const pkg = JSON.parse(read('package.json'));
  const [pack] = JSON.parse(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json'], { cwd: fileURLToPath(root), encoding: 'utf8', shell: process.platform === 'win32' }));
  const problems = releaseProblems({ tag: process.argv[2], pkg, changelog: read('CHANGELOG.md'), licence: read('LICENSE'), packed: pack.files.map((f) => f.path) });
  if (problems.length) {
    console.error(`release ${pkg.version} refused:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`release ${pkg.version}: ready (${pack.files.length} files, ${pack.size} bytes packed)`);
}

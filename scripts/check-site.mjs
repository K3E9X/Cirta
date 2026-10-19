#!/usr/bin/env node
/**
 * [F-P2 2.7] Checks the built site, after `npm run build:web`, for what the
 * page promises about itself: the policy it declares, the files its service
 * worker keeps — each present, none outside the site —, the app manifest.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';

const ROOT = new URL('../dist-web/', import.meta.url).pathname;
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

async function list(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await list(path)));
    else out.push(relative(ROOT, path).split('\\').join('/'));
  }
  return out;
}

console.log('built site');
const files = await list(ROOT);
const html = await readFile(join(ROOT, 'index.html'), 'utf8');
const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
for (const directive of ["connect-src 'none'", "worker-src 'self'", "manifest-src 'self'", "object-src 'none'"]) check(`the page declares ${directive}`, policy.includes(directive), policy);

const sw = await readFile(join(ROOT, 'sw.js'), 'utf8');
const kept = JSON.parse(/const FILES = (\[.*\]);/.exec(sw)?.[1] ?? '[]');
check('the service worker keeps every file the build wrote, and the page itself', kept[0] === './' && files.filter((f) => f !== 'sw.js' && f !== 'SHA256SUMS').every((f) => kept.includes(f)), kept.join(', '));
check('…and nothing the build did not write', kept.slice(1).every((f) => files.includes(f)));
check('the service worker names no other site', !/https?:\/\//.test(sw.replace(/^\/\/.*$/m, '')));

const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
check('the app manifest is scoped to the site, its icon present', manifest.scope === './' && manifest.start_url === './' && manifest.icons.every((icon) => files.includes(icon.src)));
check('the page links the manifest', /<link rel="manifest" href="[^"]*manifest\.webmanifest"/.test(html));

// The page's own SHA-256 list and SHA256SUMS: every published file, the hashes right.
const { createHash } = await import('node:crypto');
const sums = (await readFile(join(ROOT, 'SHA256SUMS'), 'utf8')).trim().split('\n').map((line) => /^([0-9a-f]{64})  (.+)$/.exec(line));
check('SHA256SUMS lists every published file but itself', sums.every(Boolean) && sums.map((m) => m[2]).sort().join() === files.filter((f) => f !== 'SHA256SUMS').sort().join());
const wrong = [];
for (const [, hash, file] of sums.filter(Boolean)) if (createHash('sha256').update(await readFile(join(ROOT, file))).digest('hex') !== hash) wrong.push(file);
check('each SHA-256 in SHA256SUMS is the file’s', wrong.length === 0, wrong.join(', '));
const rows = [...html.matchAll(/<tr><td><code>([^<]+)<\/code><\/td><td><code>([0-9a-f]{64})<\/code><\/td><\/tr>/g)].map((m) => `${m[2]}  ${m[1]}`);
check('the page lists the same hashes, for every file but itself', rows.length > 0 && rows.join('\n') === sums.filter((m) => m[2] !== 'index.html').map((m) => m[0]).join('\n'));

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nthe built site keeps its promises');

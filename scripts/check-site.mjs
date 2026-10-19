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
check('the service worker keeps every file the build wrote, and the page itself', kept[0] === './' && files.filter((f) => f !== 'sw.js').every((f) => kept.includes(f)), kept.join(', '));
check('…and nothing the build did not write', kept.slice(1).every((f) => files.includes(f)));
check('the service worker names no other site', !/https?:\/\//.test(sw.replace(/^\/\/.*$/m, '')));

const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
check('the app manifest is scoped to the site, its icon present', manifest.scope === './' && manifest.start_url === './' && manifest.icons.every((icon) => files.includes(icon.src)));
check('the page links the manifest', /<link rel="manifest" href="[^"]*manifest\.webmanifest"/.test(html));

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nthe built site keeps its promises');

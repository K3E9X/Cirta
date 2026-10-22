#!/usr/bin/env node
/**
 * [R1] The organisation's rules in the built page, after `npm run build:web`:
 *
 *   npm install --no-save playwright@1.56.1
 *   node scripts/web-rules.mjs
 *
 * - a rules file with `(a+)+$` is refused at import, in under two seconds, and
 *   not kept;
 * - the same file left in storage by an earlier version is forgotten when the
 *   page opens, and the page says so; files are still analysed;
 * - a rule that is merely slow is stopped by the analysis worker: the file's
 *   report comes back in under a few seconds with « Règle abandonnée : trop
 *   lente », and the other rule's finding.
 *
 * CIRTA_CHROMIUM names a Chromium to use instead of Playwright's own.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = fileURLToPath(new URL('../dist-web/', import.meta.url));
const BASE = '/Cirta/';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('scripts/web-rules.mjs needs playwright: npm install --no-save playwright@1.56.1');
  process.exit(2);
}

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  let path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  if (!path.startsWith(BASE)) return void response.writeHead(404).end();
  path = path.slice(BASE.length) || 'index.html';
  try {
    response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(await readFile(join(ROOT, path)));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}${BASE}`;

const rule = (id, pattern) => `  - id: ${id}\n    label: Règle ${id}\n    level: confirmed\n    pattern: '${pattern}'\n`;
const BAD = `rules:\n${rule('r', '(a+)+$')}`;
const SLOW = `rules:\n${rule('lente', '\\d*\\d*\\d*!')}${rule('ref', 'REF-\\d+')}`;
const file = (name, text) => ({ name, mimeType: name.endsWith('.txt') ? 'text/plain' : 'application/yaml', buffer: Buffer.from(text) });
const cards = (page, n) => page.waitForFunction((count) => document.querySelectorAll('#file-results .card:not(.is-busy)').length >= count, n, { timeout: 30_000 });

const browser = await chromium.launch(process.env['CIRTA_CHROMIUM'] ? { executablePath: process.env['CIRTA_CHROMIUM'] } : {});
const context = await browser.newContext({ locale: 'fr-FR' });

console.log('a rule that can take exponential time');
{
  const page = await context.newPage();
  await page.goto(url);
  const start = Date.now();
  await page.locator('#rules-input').setInputFiles(file('regles.yaml', BAD));
  await page.waitForFunction(() => document.querySelector('#rules-status')?.classList.contains('is-error'), null, { timeout: 5_000 });
  const status = await page.locator('#rules-status').textContent();
  check('refused at import, in under two seconds', Date.now() - start < 2_000, `${Date.now() - start} ms`);
  check('the page says why, in French', /motif refusé, son temps peut croître de façon exponentielle/.test(status ?? ''), status ?? '');
  check('not kept', (await page.evaluate(() => localStorage.getItem('cirta.rules'))) === null);
  await page.close();
}

console.log('the same rule, kept by an earlier version');
{
  const page = await context.newPage();
  await page.addInitScript((text) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('cirta.rules', text);
      localStorage.setItem('cirta.rules.name', 'ancien.yaml');
      sessionStorage.setItem('seeded', '1');
    }
  }, BAD);
  await page.goto(url);
  const status = await page.locator('#rules-status').textContent();
  check('forgotten when the page opens, and said', /oubliées/.test(status ?? '') && (await page.evaluate(() => localStorage.getItem('cirta.rules'))) === null, status ?? '');
  await page.locator('#file-input').setInputFiles(file('a.txt', `${'a'.repeat(40)}!`));
  await cards(page, 1);
  check('a file is still analysed', !(await page.locator('#file-results .card').first().textContent())?.includes('règle r'));
  await page.close();
}

console.log('a rule that is merely slow');
{
  const page = await context.newPage();
  await page.goto(url);
  await page.locator('#rules-input').setInputFiles(file('regles.yaml', SLOW));
  await page.waitForFunction(() => /2 règles/.test(document.querySelector('#rules-status')?.textContent ?? ''), null, { timeout: 5_000 });
  const start = Date.now();
  await page.locator('#file-input').setInputFiles(file('n.txt', `REF-42 ${'1'.repeat(20_000)}`));
  await cards(page, 1);
  const elapsed = Date.now() - start;
  await page.evaluate(() => document.querySelectorAll('details').forEach((details) => (details.open = true)));
  const text = (await page.locator('#file-results .card').first().textContent()) ?? '';
  check('the report comes back within the budget', elapsed < 5_000, `${elapsed} ms`);
  check('« Règle abandonnée : trop lente », naming the rule', text.includes('Règle abandonnée : trop lente') && text.includes('Règle lente'), text.slice(0, 400));
  check('the other rule still ran', text.includes('REF-42'));
  await page.close();
}

await browser.close();
server.close();
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');

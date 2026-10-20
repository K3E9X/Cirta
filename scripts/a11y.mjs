#!/usr/bin/env node
/**
 * [F-P3 2.7] The accessibility audit of the built site, after `npm run build:web`.
 *
 *   npm install --no-save playwright@1.56.1 axe-core@4.10.3
 *   npx playwright install chromium
 *   node scripts/a11y.mjs
 *
 * Neither package is a dependency of Ciirta: the audit is run on demand and in
 * CI, at the versions above, and nothing it loads reaches the published files.
 * CIIRTA_CHROMIUM names a Chromium to use instead of Playwright's own.
 *
 * What it checks, for both languages and for each theme — the system's light
 * and dark, and a forced choice against the system's —, with results on screen
 * and every <details> open:
 *   - axe-core finds no violation, contrast included;
 * and once:
 *   - every Tab stop in the page, with results on screen and every section
 *     open, shows where the focus is; the first one is the skip link; nothing
 *     marked hidden is shown;
 *   - Enter on « Choose files » opens the file picker, and the tabs answer the
 *     arrow keys;
 *   - a stored theme is applied under the page's own CSP, before the script
 *     bundle runs, and the switch cycles auto → light → dark → auto;
 *   - a file read, a text analysed and a text cleaned are each announced
 *     through the page's status region;
 *   - at 320px wide nothing scrolls sideways.
 *
 * What it cannot check is listed in REPORT_CLAUDE_CODE.md under F-P3 2.7: a
 * screen reader's actual speech, and zoom to 400 %.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = fileURLToPath(new URL('../dist-web/', import.meta.url));
const BASE = '/Cirta/';

let chromium;
let axeSource;
try {
  ({ chromium } = await import('playwright'));
  axeSource = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
} catch {
  console.error('scripts/a11y.mjs needs playwright and axe-core: npm install --no-save playwright@1.56.1 axe-core@4.10.3');
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
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(ROOT, path));
    response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}${BASE}`;

// Files that give the page something to say: a finding in each of three formats.
const SAMPLES = [
  { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('Bonjour​ le‍ monde‮.\n') },
  { name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><html><head><meta name="author" content="Jeanne Martin"><meta name="generator" content="Writer 7"></head><body><p>Texte</p></body></html>') },
  { name: 'drawing.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:export-filename="/home/jeanne/plan.png"><metadata><title>Plan</title></metadata><rect width="10" height="10"/></svg>') },
];

const browser = await chromium.launch(process.env['CIIRTA_CHROMIUM'] ? { executablePath: process.env['CIIRTA_CHROMIUM'] } : {});

console.log('axe-core, with results on screen');
for (const [system, forced] of [['light', null], ['dark', null], ['dark', 'light'], ['light', 'dark']]) {
  for (const locale of ['fr-FR', 'en-US']) {
    // The page forbids inline scripts it did not hash; axe is injected, so this context alone bypasses the policy.
    const context = await browser.newContext({ locale, colorScheme: system, reducedMotion: 'reduce', bypassCSP: true });
    if (forced) await context.addInitScript((theme) => localStorage.setItem('ciirta.theme', theme), forced);
    const page = await context.newPage();
    await page.goto(url);
    await page.locator('#file-input').setInputFiles(SAMPLES);
    await page.waitForFunction((count) => document.querySelectorAll('#file-results .card:not(.is-busy)').length >= count, SAMPLES.length, { timeout: 60_000 });
    await page.evaluate(() => document.querySelectorAll('details').forEach((details) => (details.open = true)));
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () =>
      // @ts-ignore — injected above
      (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`),
    );
    check(`${locale}, system ${system}${forced ? `, forced ${forced}` : ''}: no violation`, violations.length === 0, violations.join('; '));
    await context.close();
  }
}

console.log('keyboard');
{
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  // Listening from the start: Playwright turns file-chooser interception on
  // asynchronously, and a listener added at the key press can miss the dialog.
  const choosers = [];
  page.on('filechooser', (chooser) => choosers.push(chooser));
  await page.goto(url);
  // Results on screen and every section open, so the walk meets their controls too.
  await page.locator('#file-input').setInputFiles(SAMPLES);
  await page.waitForFunction((count) => document.querySelectorAll('#file-results .card:not(.is-busy)').length >= count, SAMPLES.length, { timeout: 60_000 });
  await page.evaluate(() => document.querySelectorAll('details').forEach((details) => (details.open = true)));
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  const stops = [];
  // Tab from the top until the focus leaves the page or comes back to where it started.
  for (let i = 0; i < 500; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const node = document.activeElement;
      if (!node || node === document.body) return null;
      const style = getComputedStyle(node);
      const name = node.id ? `#${node.id}` : node.tagName.toLowerCase() + (node.getAttribute('class') ? `.${node.getAttribute('class').split(' ')[0]}` : '');
      return { name, key: node.outerHTML.slice(0, 200), ring: style.outlineStyle !== 'none' || style.boxShadow !== 'none' };
    });
    if (!stop || (stops.length && stop.key === stops[0].key)) break;
    stops.push(stop);
  }
  console.log(`  (${stops.length} Tab stops)`);
  const shown = await page.evaluate(() => [...document.querySelectorAll('[hidden]')].filter((node) => getComputedStyle(node).display !== 'none').map((node) => node.id || node.tagName));
  check('nothing marked hidden is shown', shown.length === 0, shown.join(', '));
  check('the first Tab stop is the skip link', stops[0]?.name === 'a.skip', stops[0]?.name);
  check('the walk reaches the switches, the tabs, both pickers, the options and the results', ['#theme-toggle', '#lang-toggle', '#tab-files', '#file-pick', '#folder-pick', '#scan-pii', 'input', 'button.button'].every((id) => stops.some((s) => s.name === id)), stops.map((s) => s.name).join(' '));
  const blind = stops.filter((s) => !s.ring).map((s) => s.name);
  check('every stop shows where the focus is', blind.length === 0, blind.join(', '));

  await page.locator('#file-pick').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check('Enter on « Choose files » opens the picker, for several files', choosers.length === 1 && choosers[0].isMultiple(), `${choosers.length} picker(s)`);

  await page.locator('#tab-files').focus();
  await page.keyboard.press('ArrowRight');
  check('the arrow keys move between the tabs', await page.evaluate(() => document.activeElement?.id === 'tab-text' && !document.querySelector('#panel-text')?.hidden));
  await context.close();
}

console.log('announcements');
{
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await page.goto(url);
  await page.locator('#file-input').setInputFiles(SAMPLES);
  await page.waitForFunction((count) => document.querySelectorAll('#file-results .card:not(.is-busy)').length >= count, SAMPLES.length, { timeout: 60_000 });
  await page.waitForTimeout(200);
  const files = await page.evaluate(() => [document.querySelector('#announce')?.textContent, document.querySelector('#file-summary .summary-text')?.textContent]);
  check('the status region says what the files came to, as the summary does', Boolean(files[0]) && files[0] === files[1], files.join(' | '));
  await page.locator('#tab-text').click();
  await page.locator('#text-input').fill('Hello\u200b world');
  await page.locator('#text-scan').click();
  await page.waitForTimeout(200);
  const scan = await page.locator('#announce').textContent();
  check('…and what an analysis of the text found', /^Analysis — 1 /.test(scan ?? ''), scan ?? '');
  await page.locator('#text-clean').click();
  await page.waitForTimeout(200);
  const clean = await page.locator('#announce').textContent();
  check('…and what a clean removed', /^Cleaning — /.test(clean ?? ''), clean ?? '');
  await context.close();
}

console.log('theme');
{
  // No bypass here: the stored theme has to go through the page's own policy.
  const context = await browser.newContext({ colorScheme: 'dark' });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('ciirta.theme', 'light');
      sessionStorage.setItem('seeded', '1');
    }
  });
  const page = await context.newPage();
  const refused = [];
  page.on('console', (message) => message.type() === 'error' && refused.push(message.text()));
  // Read before the bundle runs: the attribute must come from the inline script.
  await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
  await page.goto(url);
  const before = await page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
  check('a stored light theme beats a dark system before any bundle runs', before[0] === 'light' && before[1] === 'rgb(255, 255, 255)', before.join(' '));
  check('…under the page’s CSP, which refuses nothing', !refused.some((text) => /Content Security Policy/i.test(text)), refused.join(' | '));
  await page.unroute(/\/assets\/.*\.js$/);
  await page.reload();
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await page.locator('#theme-toggle').click();
    seen.push(await page.evaluate(() => `${document.documentElement.dataset.theme ?? 'auto'}/${localStorage.getItem('ciirta.theme') ?? '-'}`));
  }
  check('the switch cycles light → dark → auto → light, and stores it', seen.join(' ') === 'dark/dark auto/- light/light', seen.join(' '));
  await context.close();
}

console.log('narrow screen');
for (const locale of ['fr-FR', 'en-US']) {
  const context = await browser.newContext({ locale, viewport: { width: 320, height: 640 } });
  const page = await context.newPage();
  await page.goto(url);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${locale} at 320px: no sideways scroll`, width <= 320, `${width}px`);
  await context.close();
}

await browser.close();
server.close();
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}

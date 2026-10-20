#!/usr/bin/env node
/**
 * [F-P2 2.6] The site as a browser extension (Manifest V3, Chrome and
 * Firefox): the toolbar button opens the same page, served from the
 * extension itself. The site is built again for it, with relative paths
 * (CIIRTA_BASE=./) instead of the /Cirta/ of GitHub Pages.
 *
 * What changes from the site:
 *   - the one inline script moves to a file, which an extension page requires;
 *   - what only makes sense on the web goes: the service worker, the web app
 *     manifest, SHA256SUMS and the « Check this site » box (between
 *     <!--ciirta:site-only--> markers), whose hashes describe the site;
 *   - the extension asks for no permission and no host, and its policy
 *     forbids every connection (connect-src 'none') on all its pages and
 *     their workers. 'wasm-unsafe-eval' lets PDF.js run its image decoders.
 *
 * Output: build/browser-extension/ (load it unpacked) and
 * build/ciirta-browser-extension-<version>.zip, the same files, deterministic.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const site = join(root, 'build', 'browser-extension-site');
const out = join(root, 'build', 'browser-extension');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Web-only files: the extension serves its own, and offline is a given. */
export const LEFT_OUT = ['sw.js', 'manifest.webmanifest', 'SHA256SUMS'];

export const POLICY = "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";

export function extensionManifest(version) {
  return {
    manifest_version: 3,
    name: 'Ciirta',
    version,
    description: 'What a document says about its making — metadata, hidden text, invisible characters — found and removed in the browser. Nothing is sent.',
    homepage_url: 'https://github.com/K3E9X/Cirta',
    action: { default_title: 'Ciirta', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
    // Chrome runs the service worker, Firefox the script; each ignores the other.
    background: { service_worker: 'background.js', scripts: ['background.js'] },
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    content_security_policy: { extension_pages: POLICY },
    browser_specific_settings: { gecko: { id: 'ciirta@k3e9x.github.io', strict_min_version: '121.0' } },
  };
}

/** The page, made an extension page: the inline script out to a file, the web-only parts gone. */
export function extensionPage(html) {
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (inline.length !== 1) throw new Error(`expected the page's one inline script, found ${inline.length}`);
  const marked = /\s*<!--ciirta:site-only-->[\s\S]*?<!--\/ciirta:site-only-->/g;
  if (!marked.test(html)) throw new Error('the page has no <!--ciirta:site-only--> block');
  const page = html
    .replace(inline[0][0], '<script src="./motion.js"></script>')
    .replace(/\s*<link rel="manifest"[^>]*>/, '')
    .replace(marked, '');
  return { page, script: `${inline[0][1].trim()}\n` };
}

const BACKGROUND = `// Ciirta: the toolbar button opens the page, which the extension carries.
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }));
`;

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]));
}

async function icons() {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const logo = await loadImage(readFileSync(join(site, 'logo.svg')));
  return Object.fromEntries(
    [16, 32, 48, 128].map((size) => {
      const canvas = createCanvas(size, size);
      canvas.getContext('2d').drawImage(logo, 0, 0, size, size);
      return [`icons/${size}.png`, canvas.toBuffer('image/png')];
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', site, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: root,
    env: { ...process.env, CIIRTA_BASE: './' },
    stdio: 'inherit',
  });
  if (!existsSync(join(site, 'index.html'))) throw new Error(`${site}/index.html is missing`);
  rmSync(out, { recursive: true, force: true });
  const files = {};
  for (const path of listFiles(site)) {
    const name = relative(site, path).split('\\').join('/');
    if (LEFT_OUT.includes(name)) continue;
    files[name] = readFileSync(path);
  }
  const { page, script } = extensionPage(files['index.html'].toString('utf8'));
  files['index.html'] = Buffer.from(page);
  files['motion.js'] = Buffer.from(script);
  files['background.js'] = Buffer.from(BACKGROUND);
  files['manifest.json'] = Buffer.from(`${JSON.stringify(extensionManifest(pkg.version), null, 2)}\n`);
  Object.assign(files, await icons());

  const names = Object.keys(files).sort();
  for (const name of names) {
    mkdirSync(dirname(join(out, name)), { recursive: true });
    writeFileSync(join(out, name), files[name]);
  }
  const zip = join(root, 'build', `ciirta-browser-extension-${pkg.version}.zip`);
  // A fixed date, so the same build gives the same bytes.
  const mtime = new Date('1980-01-01T00:00:00Z');
  writeFileSync(zip, zipSync(Object.fromEntries(names.map((name) => [name, [new Uint8Array(files[name]), { mtime }]])), { level: 9 }));
  console.log(`${relative(root, out)}/ (${names.length} files)\n${relative(root, zip)}`);
}

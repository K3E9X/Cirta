#!/usr/bin/env node
/**
 * [F-P3 2.6] The Thunderbird add-in (MailExtension, Thunderbird 128 or later):
 * integrations/thunderbird/src bundled with the library into a background
 * script and a panel script, with the panel's page, its styles, the two
 * languages' names, and icons drawn from the logo.
 *
 * It asks for one permission, « compose », which is what reading and replacing
 * a message's attachments before it is sent requires, and its policy forbids
 * every connection.
 *
 * Output: build/thunderbird/ (load it from Thunderbird's « Debug Add-ons »
 * page) and build/ciirta-thunderbird-<version>.xpi, the same files,
 * deterministic.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'integrations', 'thunderbird');

export const POLICY = "script-src 'self'; object-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";

export function thunderbirdManifest(version) {
  return {
    manifest_version: 2,
    name: '__MSG_name__',
    description: '__MSG_description__',
    version,
    default_locale: 'en',
    homepage_url: 'https://github.com/K3E9X/Cirta',
    browser_specific_settings: { gecko: { id: 'ciirta-thunderbird@k3e9x.github.io', strict_min_version: '128.0' } },
    permissions: ['compose'],
    background: { scripts: ['background.js'] },
    compose_action: {
      default_title: '__MSG_actionTitle__',
      default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' },
      default_popup: 'popup.html',
    },
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    content_security_policy: POLICY,
  };
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]));
}

async function icons() {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const logo = await loadImage(readFileSync(join(root, 'assets', 'logo.svg')));
  return Object.fromEntries(
    [16, 32, 48, 128].map((size) => {
      const canvas = createCanvas(size, size);
      canvas.getContext('2d').drawImage(logo, 0, 0, size, size);
      return [`icons/${size}.png`, canvas.toBuffer('image/png')];
    }),
  );
}

/** Writes build/thunderbird/ and the .xpi; returns their paths. */
export async function buildThunderbird(out = join(root, 'build', 'thunderbird')) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const files = {};
  for (const [entry, name] of [['background.ts', 'background.js'], ['popup.ts', 'popup.js']]) {
    const result = await build({
      entryPoints: [join(source, 'src', entry)],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'firefox128',
      legalComments: 'eof',
      write: false,
      logLevel: 'warning',
    });
    files[name] = Buffer.from(result.outputFiles[0].contents);
  }
  for (const path of listFiles(source)) {
    const name = relative(source, path).split('\\').join('/');
    if (name.startsWith('src/')) continue;
    files[name] = readFileSync(path);
  }
  files['manifest.json'] = Buffer.from(`${JSON.stringify(thunderbirdManifest(pkg.version), null, 2)}\n`);
  Object.assign(files, await icons());

  rmSync(out, { recursive: true, force: true });
  const names = Object.keys(files).sort();
  for (const name of names) {
    mkdirSync(dirname(join(out, name)), { recursive: true });
    writeFileSync(join(out, name), files[name]);
  }
  const xpi = join(dirname(out), `ciirta-thunderbird-${pkg.version}.xpi`);
  // A fixed date, so the same build gives the same bytes.
  const mtime = new Date('1980-01-01T00:00:00Z');
  writeFileSync(xpi, zipSync(Object.fromEntries(names.map((name) => [name, [new Uint8Array(files[name]), { mtime }]])), { level: 9 }));
  return { out, xpi, names };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { out, xpi, names } = await buildThunderbird();
  console.log(`${relative(root, out)}/ (${names.length} files)\n${relative(root, xpi)}`);
}

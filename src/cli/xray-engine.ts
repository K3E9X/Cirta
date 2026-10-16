/**
 * The x-ray engine for Node: PDF.js's Node build, a native canvas to render
 * into, and PDF.js's own standard fonts read from its package directory.
 *
 * The canvas is an optional dependency with a prebuilt binary per platform.
 * Where it is missing — an unusual platform, an install with optional
 * dependencies disabled — there is no engine, and the report says the
 * hidden-text check did not run rather than implying it found nothing.
 */

import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { XrayEngine, XrayPdfjs } from '../core/xray.js';

let cached: Promise<XrayEngine | undefined> | undefined;

export function nodeXrayEngine(): Promise<XrayEngine | undefined> {
  cached ??= build().catch(() => undefined);
  return cached;
}

async function build(): Promise<XrayEngine | undefined> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as XrayPdfjs;
  const { createCanvas } = await import('@napi-rs/canvas');

  const require = createRequire(import.meta.url);
  const fontsDir = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts');
  const fonts = new Map<string, Uint8Array>();
  for (const name of await readdir(fontsDir)) {
    if (/\.(?:pfb|ttf)$/i.test(name)) fonts.set(name, new Uint8Array(await readFile(join(fontsDir, name))));
  }

  return {
    pdfjs,
    createCanvas: (width, height) => createCanvas(width, height) as unknown as ReturnType<XrayEngine['createCanvas']>,
    standardFont: (filename) => fonts.get(filename),
  };
}

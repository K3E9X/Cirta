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
  const root = dirname(require.resolve('pdfjs-dist/package.json'));
  const fonts = await files(join(root, 'standard_fonts'), /\.(?:pfb|ttf)$/i);
  const wasm = await files(join(root, 'wasm'), /^(?:openjpeg|jbig2)\.wasm$/);

  return {
    pdfjs,
    createCanvas: (width, height) => createCanvas(width, height) as unknown as ReturnType<XrayEngine['createCanvas']>,
    standardFont: (filename) => fonts.get(filename),
    wasm: (filename) => wasm.get(filename),
  };
}

async function files(dir: string, pattern: RegExp): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const name of await readdir(dir)) {
    if (pattern.test(name)) out.set(name, new Uint8Array(await readFile(join(dir, name))));
  }
  return out;
}

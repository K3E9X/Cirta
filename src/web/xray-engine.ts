/**
 * The x-ray engine for the page: PDF.js's browser build running inside this
 * worker, an OffscreenCanvas to render into, and PDF.js's standard fonts and
 * image decoders bundled with the code.
 *
 * PDF.js normally starts a worker of its own from a script URL. Here it is
 * already in one, so its worker half is imported alongside and handed over on
 * `globalThis.pdfjsWorker`, which PDF.js checks first: the two halves talk in
 * this thread, and no script is ever fetched.
 *
 * The legacy build, not the modern one: PDF.js 6's modern build calls
 * Map.prototype.getOrInsertComputed, which browsers only began shipping in
 * 2026, and failed on a current Chromium. The legacy build carries its own
 * polyfills.
 *
 * This module is its own chunk, requested the moment the analysis worker
 * starts — which the page does while idle, right after it loads. A visitor who
 * goes offline after that keeps the check; one who goes offline sooner gets a
 * report that says the pages were not rendered.
 */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import type { XrayCanvas, XrayEngine, XrayPdfjs } from '../core/xray.js';

// Inlined as data URLs at build time: bytes in the bundle, not files to fetch.
//
// The Foxit Type 1 fonts only, under a BSD-style licence. PDF.js also ships
// Liberation Sans, under the GPL with a font exception, as its stand-in for a
// Helvetica or Arial the PDF does not embed; it is left out of this MIT bundle.
// Without it PDF.js draws those glyphs with a system sans-serif, which puts
// ink in the same places — all this check measures.
const FONTS = import.meta.glob<string>('../../node_modules/pdfjs-dist/standard_fonts/*.pfb', {
  query: '?inline',
  import: 'default',
  eager: true,
});
const WASM = import.meta.glob<string>('../../node_modules/pdfjs-dist/wasm/{openjpeg,jbig2}.wasm', {
  query: '?inline',
  import: 'default',
  eager: true,
});

function byName(files: Record<string, string>): (name: string) => Uint8Array | undefined {
  const urls = new Map(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]));
  const decoded = new Map<string, Uint8Array>();
  return (name) => {
    const cached = decoded.get(name);
    if (cached) return cached;
    const url = urls.get(name);
    if (!url) return undefined;
    const binary = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    decoded.set(name, bytes);
    return bytes;
  };
}

interface CanvasAndContext {
  canvas: OffscreenCanvas | null;
  context: OffscreenCanvasRenderingContext2D | null;
}

/** The scratch canvases PDF.js draws masks and patterns into; its default asks a document for them. */
class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }

  reset(target: CanvasAndContext, width: number, height: number): void {
    if (!target.canvas) throw new Error('Canvas is not specified');
    target.canvas.width = width;
    target.canvas.height = height;
  }

  destroy(target: CanvasAndContext): void {
    if (target.canvas) target.canvas.width = target.canvas.height = 0;
    target.canvas = null;
    target.context = null;
  }
}

/**
 * PDF.js's default builds SVG filters in the document for transfer functions
 * and high-contrast modes. There is no document here; these are what its own
 * base class returns, and a transfer function then simply does not apply.
 */
class NoFilters {
  addFilter(): string {
    return 'none';
  }
  addHCMFilter(): string {
    return 'none';
  }
  addAlphaFilter(): string {
    return 'none';
  }
  addLuminosityFilter(): string {
    return 'none';
  }
  addKnockoutFilter(): string {
    return 'none';
  }
  addHighlightHCMFilter(): string {
    return 'none';
  }
  addSelectionHCMFilter(): string {
    return 'none';
  }
  addSelectionFilter(): string {
    return 'none';
  }
  createSelectionStyle(): null {
    return null;
  }
  destroy(): void {}
}

export function webXrayEngine(): XrayEngine {
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;
  return {
    pdfjs: pdfjs as unknown as XrayPdfjs,
    createCanvas: (width, height) => new OffscreenCanvas(width, height) as unknown as XrayCanvas,
    standardFont: byName(FONTS),
    wasm: byName(WASM),
    documentOptions: {
      CanvasFactory: OffscreenCanvasFactory,
      FilterFactory: NoFilters,
      isOffscreenCanvasSupported: true,
    },
  };
}

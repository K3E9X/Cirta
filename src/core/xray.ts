/**
 * Text a reader cannot see, which anything that extracts text will read.
 *
 * A language model given a PDF reads its text layer, not its pixels. So does a
 * search index, a screen reader, and every "summarise this document" tool. A
 * sentence drawn under a black rectangle, in white on a white page, in the
 * invisible text mode, at half a point, or past the edge of the page is not on
 * the page for a person and is entirely there for all of those. In July 2025
 * eighteen preprints on arXiv were found carrying instructions to AI reviewers
 * hidden exactly this way; the same tricks are how a redaction fails.
 *
 * The method is the one Free Law Project's x-ray uses for bad redactions —
 * find the letters, look at what is actually painted where they sit — applied
 * to every hiding technique at once rather than to rectangles alone. No code is
 * taken from it: x-ray is Python and depends on PyMuPDF, which is AGPL. The
 * rendering here is PDF.js (Apache-2.0).
 *
 * Why render rather than read the drawing operators. Interpreting the graphics
 * state would answer "is this text white" and "is a rectangle drawn after it",
 * but each hiding technique would need its own rule and every rule its own
 * blind spots — a clipping path, a white image, a form XObject. Rendering asks
 * the only question that matters, the one a reader's eyes answer: is there any
 * ink where these letters are? It also gets the hard control right for free. A
 * scanned page with an OCR layer has invisible text over an image of the same
 * words; the image's ink is there, so it is not reported.
 *
 * Nothing here imports an environment. PDF.js, the canvas and the standard
 * fonts are handed in, so the CLI runs this with Node and a native canvas and
 * the page runs it in its worker with an OffscreenCanvas.
 */

import { PDFDocument } from 'pdf-lib';
import type { Finding } from './types.js';
import { preview } from './types.js';
import { AIMED_LABEL, CONTRAST, HIDDEN_LABEL, TINY_PT, aimedAtModel, type HiddenHow } from './hidden-text.js';

/* ---------------------------------------------------------- the engine -- */

export interface XrayTextItem {
  str?: string;
  transform?: number[];
  width?: number;
}

export interface XrayViewport {
  width: number;
  height: number;
  transform: number[];
}

export interface XrayPage {
  view: number[];
  getViewport(options: { scale: number }): XrayViewport;
  getTextContent(): Promise<{ items: unknown[] }>;
  render(options: { canvas: unknown; canvasContext: unknown; viewport: XrayViewport }): { promise: Promise<void> };
  cleanup(): void;
}

export interface XrayDocument {
  numPages: number;
  getPage(n: number): Promise<XrayPage>;
}

/** What getDocument returns: the document, and the handle that tears it down. */
export interface XrayLoadingTask {
  promise: Promise<XrayDocument>;
  destroy(): Promise<void>;
}

export interface XrayPdfjs {
  getDocument(params: Record<string, unknown>): XrayLoadingTask;
  Util: { transform(a: number[], b: number[]): number[] };
}

export interface XrayCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null;
}

export interface XrayEngine {
  pdfjs: XrayPdfjs;
  createCanvas(width: number, height: number): XrayCanvas;
  /** The bytes of one of PDF.js's standard fonts, by file name, from memory. */
  standardFont(filename: string): Uint8Array | undefined;
  /**
   * PDF.js's JBIG2 and JPEG 2000 decoders, by file name. Scanned pages are
   * mostly one or the other, and a scan that fails to decode leaves its OCR
   * text over blank paper — every word of it would read as hidden.
   */
  wasm(filename: string): Uint8Array | undefined;
  /** Anything the environment needs PDF.js to use: a canvas factory where there is no DOM. */
  documentOptions?: Record<string, unknown>;
}

/** A copy of the PDF with every page box pushed far past anything drawn. */
async function enlargePages(data: Uint8Array): Promise<Uint8Array | undefined> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
  for (const page of doc.getPages()) {
    page.setMediaBox(-100_000, -100_000, 200_000, 200_000);
    page.setCropBox(-100_000, -100_000, 200_000, 200_000);
  }
  return doc.save({ useObjectStreams: false });
}

/* ------------------------------------------------------------- limits -- */

const MAX_PAGES = 30;
const DEADLINE_MS = 8_000;
const MAX_PIXELS = 3_000_000;
const MAX_ITEMS_PER_PAGE = 4_000;
const MAX_REGIONS = 6;

/** Below this share of inked pixels, a character's cell carries no ink. */
const BLANK = 0.008;
const HIDDEN = CONTRAST.hidden;
const FAINT = CONTRAST.faint;
/** A single blank cell is a misaligned period; three letters are a word. */
const MIN_RUN = 3;
/** What has ink of its own: a letter or a digit, in any script. */
const LETTER = /[\p{L}\p{N}]/u;
const LETTERS = /[\p{L}\p{N}]/gu;
/** A page with this much text, most of it without ink, is doubted rather than believed. */
const DOUBT = { letters: 200, share: 0.6 };

/* -------------------------------------------------------------- output -- */


export interface XrayRegion {
  page: number;
  how: HiddenHow;
  /** The finding's label, so an interface shows the same words as the report. */
  label: string;
  text: string;
  /** The rendered surroundings, so a reader can see the hiding for themselves. */
  crop: { width: number; height: number; rgba: Uint8ClampedArray };
  /** Where the hidden text sits inside the crop, in pixels. */
  box: { x: number; y: number; width: number; height: number };
}

export interface XrayResult {
  findings: Finding[];
  regions: XrayRegion[];
  pagesChecked: number;
  pagesTotal: number;
  /**
   * Pages where most of a substantial text produced no ink. That is either a
   * page built to hide it, or a font or image this renderer could not draw;
   * from pixels alone the two look the same, so findings there are graded
   * probable and the report says why.
   */
  doubtful: number[];
}

const LABEL = HIDDEN_LABEL;

/* ------------------------------------------------------------ geometry -- */

type Box = [number, number, number, number];

function corners(points: Array<[number, number]>): Box {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * The rendered box of characters [from, to) of a text item, in viewport pixels,
 * between `below` and `above` em of the baseline. The full em, a fifth below
 * and four fifths above, frames the letters for a reader.
 */
function cellBox(m: number[], width: number, n: number, from: number, to: number, below = 0.2, above = 0.8): Box {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = m;
  const along = Math.hypot(a, b) || 1;
  const ux = a / along;
  const uy = b / along;
  const vx = c;
  const vy = d;
  const x0 = e + ux * ((width * from) / n);
  const y0 = f + uy * ((width * from) / n);
  const x1 = e + ux * ((width * to) / n);
  const y1 = f + uy * ((width * to) / n);
  return corners([
    [x0 - vx * below, y0 - vy * below],
    [x1 - vx * below, y1 - vy * below],
    [x0 + vx * above, y0 + vy * above],
    [x1 + vx * above, y1 + vy * above],
  ]);
}

/* --------------------------------------------------------------- pixels -- */

interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Five bits a channel: antialiasing noise in a flat fill folds to one value. */
function key(data: Uint8ClampedArray, i: number): number {
  return ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3);
}

/** sRGB to linear light, by table: relative luminance for a contrast ratio. */
const LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function luminance(data: Uint8ClampedArray, i: number): number {
  return 0.2126 * LINEAR[data[i]!]! + 0.7152 * LINEAR[data[i + 1]!]! + 0.0722 * LINEAR[data[i + 2]!]!;
}

interface Ink {
  /** Share of pixels that stand out from the cell's colour at all. */
  hidden: number;
  /** Share that stand out enough to be read. */
  faint: number;
  colour: number;
  pixels: number;
}

/** The dominant colour of a box, and how much of the box differs from it. */
function inkIn(r: Raster, box: Box): Ink {
  const x0 = Math.max(0, Math.floor(box[0]));
  const y0 = Math.max(0, Math.floor(box[1]));
  const x1 = Math.min(r.width, Math.ceil(box[2]));
  const y1 = Math.min(r.height, Math.ceil(box[3]));
  if (x1 <= x0 || y1 <= y0) return { hidden: 1, faint: 1, colour: -1, pixels: 0 };
  const counts = new Map<number, [count: number, at: number]>();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * r.width + x) * 4;
      const k = key(r.data, i);
      const seen = counts.get(k);
      if (seen) seen[0]++;
      else counts.set(k, [1, i]);
    }
  }
  let colour = -1;
  let at = 0;
  let most = 0;
  for (const [k, [n, i]] of counts) if (n > most) [colour, at, most] = [k, i, n];

  const d = r.data;
  const base = luminance(d, at);
  let hidden = 0;
  let faint = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * r.width + x) * 4;
      const l = luminance(d, i);
      const ratio = (Math.max(l, base) + 0.05) / (Math.min(l, base) + 0.05);
      const channel = Math.max(Math.abs(d[i]! - d[at]!), Math.abs(d[i + 1]! - d[at + 1]!), Math.abs(d[i + 2]! - d[at + 2]!));
      if (ratio >= HIDDEN.ratio || channel >= HIDDEN.channel) hidden++;
      if (ratio >= FAINT.ratio || channel >= FAINT.channel) faint++;
    }
  }
  const pixels = (x1 - x0) * (y1 - y0);
  return { hidden: hidden / pixels, faint: faint / pixels, colour, pixels };
}

/** The page's own background: the most common colour on a coarse grid. */
function pageColour(r: Raster): number {
  const counts = new Map<number, number>();
  const step = Math.max(4, Math.floor(Math.min(r.width, r.height) / 60));
  for (let y = 0; y < r.height; y += step) {
    for (let x = 0; x < r.width; x += step) {
      const k = key(r.data, (y * r.width + x) * 4);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts].sort((p, q) => q[1] - p[1])[0]?.[0] ?? -1;
}

/**
 * A strip of the page around a hidden line: the line and some of what runs
 * beside it, and a few lines above and below. A tight box around white-on-
 * white text is a white rectangle and shows nothing; a strip shows the
 * paragraph running on either side of a gap that is not empty. The width stays
 * near half a page, so the page's own text is still legible on a phone.
 */
/** The nearest row, moving in `step` from `y` for up to `limit` rows, with nothing drawn across it. */
function quietRow(r: Raster, x0: number, width: number, y: number, step: 1 | -1, limit: number): number {
  for (let k = 0; k <= limit; k++) {
    const row = y + k * step;
    if (row <= 0 || row >= r.height - 1) return Math.max(0, Math.min(r.height - 1, row));
    const first = key(r.data, (row * r.width + x0) * 4);
    let flat = true;
    for (let x = x0 + 1; x < x0 + width && flat; x++) flat = key(r.data, (row * r.width + x) * 4) === first;
    if (flat) return row;
  }
  return y;
}

function crop(r: Raster, box: Box): { crop: XrayRegion['crop']; origin: [number, number] } {
  const MAX_H = 420;
  const line = Math.max(8, box[3] - box[1]);
  const middle = (box[1] + box[3]) / 2;
  const width = Math.min(r.width, 1400, Math.max(700, Math.ceil(box[2] - box[0] + line * 10)));
  const centre = (box[0] + box[2]) / 2;
  const x0 = Math.max(0, Math.min(r.width - width, Math.floor(centre - width / 2)));
  // Edges moved to the nearest gap between lines, so the strip does not end
  // on half a line of text.
  const reach = Math.ceil(line * 3.5);
  const top = quietRow(r, x0, width, Math.max(0, Math.floor(middle - reach)), -1, line);
  const bottom = quietRow(r, x0, width, Math.min(r.height - 1, Math.ceil(middle + reach)), 1, line);
  const y0 = Math.max(0, Math.min(top, Math.floor(box[1])));
  const height = Math.max(1, Math.min(MAX_H, r.height - y0, bottom - y0 + 1));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * r.width + x0) * 4;
    rgba.set(r.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { crop: { width, height, rgba }, origin: [x0, y0] };
}

/* ---------------------------------------------------------------- pages -- */

function asItem(raw: unknown): XrayTextItem | undefined {
  if (!raw || typeof raw !== 'object' || !('str' in raw)) return undefined;
  return raw as XrayTextItem;
}

/** A letter's cell with no readable ink: its colour, and whether a trace shows. */
interface Cell {
  colour: number;
  faint: boolean;
}

interface Run {
  how: HiddenHow;
  text: string;
  box: Box;
}

/**
 * Snap a blank run to whole words. PDF.js gives one width for a whole string,
 * so each character's cell is an even share of it, and in a proportional font
 * the shares drift: a box over "58000" mid-sentence read back as "5800". A word
 * counts when at least half its letters fall in the run, so the figure comes
 * back whole and the "EUR" beside it, grazed by one cell, does not.
 */
function wholeWords(chars: string[], start: number, end: number): [number, number] {
  let from = -1;
  let to = -1;
  for (let i = 0; i < chars.length; ) {
    if (!chars[i]!.trim()) {
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && chars[j]!.trim()) j++;
    const overlap = Math.min(j, end) - Math.max(i, start);
    if (overlap * 2 >= j - i) {
      if (from < 0) from = i;
      to = j;
    }
    i = j;
  }
  return from < 0 ? [start, start] : [from, to];
}

/** The runs of letters on one rendered page that carry no ink of their own. */
function hiddenRuns(items: XrayTextItem[], viewport: XrayViewport, pdfjs: XrayPdfjs, r: Raster, scale: number): Run[] {
  const runs: Run[] = [];
  const background = pageColour(r);

  for (const item of items.slice(0, MAX_ITEMS_PER_PAGE)) {
    const str = item.str ?? '';
    const width = (item.width ?? 0) * scale;
    if (!str.trim() || !item.transform || width <= 0) continue;
    // Too small to read is its own finding; its cells are too small to measure.
    if (pointSize(item.transform) < TINY_PT) continue;
    const m = pdfjs.Util.transform(viewport.transform, item.transform);
    const n = [...str].length;
    const chars = [...str];

    // Blank or not, character by character. A rectangle over "58000" in the
    // middle of a sentence leaves the line as a whole plenty of ink; only the
    // letters under it have none.
    //
    // Ink is looked for from the baseline to two thirds of an em: every letter
    // and digit has some there, and a box drawn to hide letters covers at least
    // that much. The full em reached past a CSS background a pixel short of the
    // descent, and that row of white read as ink. Punctuation may have none in
    // the band — a period sits under it, an apostrophe over it — so, like a
    // space, it neither opens nor breaks a run.
    const blank = chars.map((ch, i): Cell | null | undefined => {
      if (!LETTER.test(ch)) return undefined;
      const ink = inkIn(r, cellBox(m, width, n, i, i + 1, 0, 0.65));
      if (ink.pixels === 0) return undefined;
      if (ink.hidden < BLANK) return { colour: ink.colour, faint: false };
      if (ink.faint < BLANK) return { colour: ink.colour, faint: true };
      return null; // inked
    });

    let start = -1;
    const close = (end: number) => {
      const [from, to] = wholeWords(chars, start, end);
      start = -1;
      const letters = chars.slice(from, to);
      const visible = letters.filter((ch) => LETTER.test(ch)).length;
      const all = chars.filter((ch) => LETTER.test(ch)).length;
      // Three letters make a word; a two-letter item hidden entire counts too.
      if (visible < MIN_RUN && !(visible >= 2 && visible === all)) return;
      const cells = blank.slice(from, to).filter((c): c is Cell => !!c);
      const same = cells.filter((c) => c.colour === background).length;
      runs.push({
        how: cells.some((c) => c.faint) ? 'faint' : same >= cells.length / 2 ? 'invisible' : 'covered',
        text: letters.join('').trim(),
        box: cellBox(m, width, n, from, to),
      });
    };

    for (let i = 0; i <= chars.length; i++) {
      const state = i < chars.length ? blank[i] : null;
      // Spaces neither open nor break a run: "58 000" is one hidden figure.
      if (state === undefined && i < chars.length) continue;
      if (state) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        close(i);
      }
    }
  }
  return runs;
}

function pointSize(transform: number[]): number {
  return Math.hypot(transform[2] ?? 0, transform[3] ?? 0);
}

function tinyRuns(items: XrayTextItem[]): Run[] {
  const runs: Run[] = [];
  for (const item of items.slice(0, MAX_ITEMS_PER_PAGE)) {
    const str = (item.str ?? '').trim();
    if (str.replace(/\s/g, '').length < 2 || !item.transform) continue;
    const size = pointSize(item.transform);
    if (size > 0 && size < TINY_PT) runs.push({ how: 'tiny', text: str, box: [0, 0, 0, 0] });
  }
  return runs;
}

/**
 * Text drawn outside the page's visible box. PDF.js leaves it out of its own
 * text extraction on purpose, so asking it directly finds nothing — while a
 * different extractor, the one a model's pipeline happens to use, reads it.
 * The engine hands back a copy with every page box enlarged, so the text
 * appears, and its position is then compared with the real box.
 */
async function offPageText(data: Uint8Array, engine: XrayEngine, views: Map<number, number[]>, deadline: number): Promise<Run[][]> {
  const out: Run[][] = [];
  const enlarged = await enlargePages(data.slice()).catch(() => undefined);
  if (!enlarged) return out;
  const task = openDocument(engine, enlarged);
  const doc = await task.promise.catch(() => undefined);
  if (!doc) {
    await task.destroy().catch(() => undefined);
    return out;
  }
  try {
    for (const [pageNumber, view] of views) {
      if (Date.now() > deadline) break;
      const page = await doc.getPage(pageNumber);
      const items = (await page.getTextContent()).items.map(asItem).filter((i): i is XrayTextItem => !!i);
      const [vx0 = 0, vy0 = 0, vx1 = 0, vy1 = 0] = view;
      const runs: Run[] = [];
      for (const item of items) {
        const str = (item.str ?? '').trim();
        if (str.replace(/\s/g, '').length < 2 || !item.transform) continue;
        const x = item.transform[4] ?? 0;
        const y = item.transform[5] ?? 0;
        const w = item.width ?? 0;
        if (x + w < vx0 || x > vx1 || y < vy0 || y > vy1) runs.push({ how: 'offpage', text: str, box: [0, 0, 0, 0] });
      }
      out[pageNumber] = runs;
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return out;
}

/* ------------------------------------------------------------- driving -- */

function openDocument(engine: XrayEngine, data: Uint8Array): XrayLoadingTask {
  class InMemory {
    async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
      const bytes =
        kind === 'standardFontDataUrl' ? engine.standardFont(filename)
        : kind === 'wasmUrl' ? engine.wasm(filename)
        : undefined;
      if (bytes) return bytes.slice();
      // Never a request: predefined CMaps are simply unavailable, and PDF.js
      // carries on without them.
      throw new Error(`${kind} ${filename} is not bundled`);
    }
  }
  return engine.pdfjs.getDocument({
    // PDF.js transfers the buffer it is given to its worker, which empties the
    // caller's copy; pdf-lib reading the same bytes afterwards found nothing.
    data: data.slice(),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    isImageDecoderSupported: false,
    enableXfa: false,
    // Fonts and decoders come from the factory, which answers from memory.
    // Without worker fetch, PDF.js also never asks for its ICC module, which it
    // would otherwise load with a synchronous request.
    useWasm: true,
    useWorkerFetch: false,
    BinaryDataFactory: InMemory,
    standardFontDataUrl: 'cirta-fonts/',
    // Read only if a decoder fails to instantiate: PDF.js then imports a
    // JavaScript fallback from this base. A data URL holding a comment makes
    // that import an inert module rather than a request.
    wasmUrl: 'data:text/javascript,//',
    verbosity: 0,
    ...engine.documentOptions,
  });
}

export async function xrayPdf(data: Uint8Array, engine: XrayEngine): Promise<XrayResult> {
  const deadline = Date.now() + DEADLINE_MS;
  const task = openDocument(engine, data);
  const doc = await task.promise.catch(async (error: unknown) => {
    await task.destroy().catch(() => undefined);
    throw error;
  });
  const findings: Finding[] = [];
  const regions: XrayRegion[] = [];
  const seen = new Set<string>();
  const views = new Map<number, number[]>();
  const pagesTotal = doc.numPages;
  let pagesChecked = 0;

  const doubtful: number[] = [];

  const report = (page: number, run: Run) => {
    const k = `${page}\u0000${run.how}\u0000${run.text}`;
    if (seen.has(k) || !run.text) return false;
    seen.add(k);
    const aimed = aimedAtModel(run.text);
    // An order to a model in half-point type is no less certain for being small.
    const certain = (aimed || (run.how !== 'tiny' && run.how !== 'faint')) && !doubtful.includes(page);
    findings.push({
      kind: 'invisible-character',
      confidence: certain ? 'confirmed' : 'probable',
      location: `page ${page}`,
      label: aimed ? AIMED_LABEL : LABEL[run.how],
      value: preview(run.text, 160),
    });
    return true;
  };

  try {
    for (let n = 1; n <= Math.min(pagesTotal, MAX_PAGES); n++) {
      if (Date.now() > deadline) break;
      const page = await doc.getPage(n);
      views.set(n, page.view);
      const items = (await page.getTextContent()).items.map(asItem).filter((i): i is XrayTextItem => !!i);
      for (const run of tinyRuns(items)) report(n, run);

      if (items.some((i) => (i.str ?? '').trim())) {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, Math.sqrt(MAX_PIXELS / Math.max(1, base.width * base.height)));
        const viewport = page.getViewport({ scale });
        const canvas = engine.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        if (context) {
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const raster: Raster = {
            width: canvas.width,
            height: canvas.height,
            data: context.getImageData(0, 0, canvas.width, canvas.height).data,
          };
          const runs = hiddenRuns(items, viewport, engine.pdfjs, raster, scale);
          const letters = items.reduce((sum, item) => sum + ((item.str ?? '').match(LETTERS)?.length ?? 0), 0);
          const blank = runs.reduce((sum, run) => sum + (run.how === 'faint' ? 0 : (run.text.match(LETTERS)?.length ?? 0)), 0);
          if (letters >= DOUBT.letters && blank / letters >= DOUBT.share) doubtful.push(n);
          for (const run of runs) {
            if (!report(n, run) || regions.length >= MAX_REGIONS) continue;
            const { crop: picture, origin } = crop(raster, run.box);
            regions.push({
              page: n,
              how: run.how,
              label: aimedAtModel(run.text) ? AIMED_LABEL : LABEL[run.how],
              text: run.text,
              crop: picture,
              box: {
                x: run.box[0] - origin[0],
                y: run.box[1] - origin[1],
                width: run.box[2] - run.box[0],
                height: run.box[3] - run.box[1],
              },
            });
          }
        }
      }
      page.cleanup();
      pagesChecked = n;
    }
  } finally {
    await task.destroy();
  }

  const offPage = await offPageText(data, engine, views, deadline);
  for (const [n, runs] of offPage.entries()) for (const run of runs ?? []) report(n, run);

  return { findings, regions, pagesChecked, pagesTotal, doubtful };
}

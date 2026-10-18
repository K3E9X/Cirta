/**
 * [F-2.2] Jupyter notebooks (.ipynb).
 *
 * A notebook is JSON, and what it says about who ran it sits in three places.
 * The metadata: the kernel, the authors, and whatever an extension added —
 * papermill's input and output paths, Colab's file name, VS Code's
 * interpreter. Each cell's metadata: when it ran, to the millisecond. And
 * above all the outputs: a printed path, a traceback walking through
 * C:\Users\<account>\…\site-packages, a token a cell echoed, a figure saved
 * with its Exif.
 *
 * Cleaning empties the notebook's metadata but for the kernel and language
 * (Jupyter needs them to run it), keeps only the cell metadata that changes
 * how a cell is shown, and strips the metadata of every picture. The outputs
 * are what the author computed and stay, named as staying — unless
 * `clearOutputs` empties them with their execution counts.
 */

import { inspectImage, stripImageMetadata } from './image.js';
import { inspectMarkup } from './markup.js';
import { scanContent } from './archive.js';
import { fingerprint } from './fingerprint.js';
import { inspectPlainText } from './plaintext.js';
import { byConfidence, preview, type Finding, type InspectResult, type Note, type RedactResult } from './types.js';

type Json = unknown;
type Obj = Record<string, Json>;

const isObj = (v: Json): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const MAX_NOTEBOOK = 64 * 1024 * 1024;
const MAX_PATHS = 20;

/**
 * [F-2.8] How deep the brackets go, strings skipped. JSON.parse copes with any
 * depth, but every recursive walk after it — JSON.stringify among them — runs
 * out of stack long before; Python's json, which Jupyter uses, stops near a
 * thousand. Past MAX_DEPTH the file is not read as a notebook.
 */
function tooDeep(text: string): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++;
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) {
      if (++depth > MAX_DEPTH) return true;
    } else if (c === 0x7d || c === 0x5d) depth--;
  }
  return false;
}

const MAX_DEPTH = 512;

/** A notebook: an object with a cells array and an nbformat number. */
export function parseNotebook(text: string): Obj | undefined {
  if (text.length > MAX_NOTEBOOK || !/^\s*\{/.test(text) || tooDeep(text)) return undefined;
  try {
    const value: Json = JSON.parse(text);
    return isObj(value) && Array.isArray(value.cells) && typeof value.nbformat === 'number' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** nbformat stores multi-line strings as a list of lines. */
const joined = (v: Json): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('') : '');

/** A traceback: one string per frame, with no newline between them. */
const frames = (v: Json): string => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('\n') : joined(v));

/** The colour escapes IPython writes into tracebacks. */
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * Paths on a machine, the shapes that carry an account name or a scratch
 * directory. A path ends at whitespace, a quote or a bracket.
 */
const LOCAL_PATH = /(?:[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s"'<>|:*?]+|\/(?:home|Users)\/[^\s"'<>():]+|\/(?:var\/folders|tmp)\/[^\s"'<>():]+)/g;

/** Cell metadata that changes how a cell is shown, and nothing about who ran it. */
const DISPLAY_KEYS = new Set(['tags', 'collapsed', 'scrolled', 'jupyter', 'editable', 'deletable', 'slideshow', 'name', 'format', 'raw_mimetype']);
/** Notebook metadata Jupyter needs to run it. */
const RUN_KEYS = new Set(['kernelspec', 'language_info']);

const IMAGE = /^image\/(png|jpeg)$/;

function decodeBase64(text: string): Uint8Array | undefined {
  const clean = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) return undefined;
  try {
    const raw = atob(clean);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
}

/** Where a value is, the same in every language: a JSON path. */
const at = (...steps: Array<string | number>) => steps.map((s, i) => (typeof s === 'number' ? `[${s}]` : i ? `.${s}` : s)).join('');

const prefixed = (findings: Finding[], where: string): Finding[] => findings.map((f) => ({ ...f, location: `${where} → ${f.location}` }));

/** The mime bundle of an output or an attachment: pictures inspected, text scanned. */
function bundleFindings(data: Json, where: string, paths: Map<string, string>): Finding[] {
  if (!isObj(data)) return [];
  const findings: Finding[] = [];
  for (const [mime, value] of Object.entries(data)) {
    if (IMAGE.test(mime)) {
      const bytes = typeof value === 'string' ? decodeBase64(value) : undefined;
      if (bytes) findings.push(...prefixed(inspectImage(bytes, mime), where));
    } else if (mime === 'image/svg+xml') {
      findings.push(...prefixed(inspectMarkup(joined(value), 'svg'), where));
    } else if (mime.startsWith('text/') || mime === 'application/json') {
      findings.push(...textFindings(typeof value === 'string' || Array.isArray(value) ? joined(value) : JSON.stringify(value), where, paths));
    }
  }
  return findings;
}

function textFindings(text: string, where: string, paths: Map<string, string>): Finding[] {
  const plain = text.replace(ANSI, '');
  for (const match of plain.matchAll(LOCAL_PATH)) {
    const path = match[0].replace(/[.,;]+$/, '');
    if (!paths.has(path) && paths.size < MAX_PATHS) paths.set(path, where);
  }
  return scanContent(plain, where);
}

function metadataValue(value: Json): string {
  return preview(typeof value === 'string' ? value : JSON.stringify(value), 200);
}

export function inspectNotebook(nb: Obj): InspectResult {
  const findings: Finding[] = [];
  const paths = new Map<string, string>();
  const meta = isObj(nb.metadata) ? nb.metadata : {};

  const kernel = isObj(meta.kernelspec) ? (meta.kernelspec.display_name ?? meta.kernelspec.name) : undefined;
  if (typeof kernel === 'string') findings.push({ kind: 'provenance', confidence: 'informational', location: 'metadata.kernelspec', label: 'Kernel', value: kernel });
  const language = isObj(meta.language_info) ? meta.language_info : undefined;
  if (language && typeof language.name === 'string') {
    findings.push({ kind: 'provenance', confidence: 'informational', location: 'metadata.language_info', label: 'Language', value: [language.name, language.version].filter((x) => typeof x === 'string').join(' ') });
  }
  for (const [key, value] of Object.entries(meta)) {
    if (RUN_KEYS.has(key)) continue;
    if (key === 'authors' && Array.isArray(value)) {
      for (const [i, author] of value.entries()) {
        const name = isObj(author) ? author.name : author;
        if (typeof name === 'string' && name) findings.push({ kind: 'identity', confidence: 'confirmed', location: at('metadata', 'authors', i), label: 'Author', value: name });
      }
      continue;
    }
    findings.push({ kind: 'environment', confidence: 'probable', location: at('metadata', key), label: 'Notebook metadata', value: metadataValue(value) });
  }

  const cells = Array.isArray(nb.cells) ? nb.cells : [];
  const seenKeys = new Set<string>();
  let sources = '';
  for (const [i, cell] of cells.entries()) {
    if (!isObj(cell)) continue;
    sources += `${joined(cell.source)}\n`;
    findings.push(...scanContent(joined(cell.source), at('cells', i, 'source')));

    // Cell metadata, once per key: the first cell that has it stands for the rest.
    if (isObj(cell.metadata)) {
      for (const [key, value] of Object.entries(cell.metadata)) {
        if (DISPLAY_KEYS.has(key) || seenKeys.has(key)) continue;
        seenKeys.add(key);
        const where = at('cells', i, 'metadata', key);
        const stamp = JSON.stringify(value).match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?/)?.[0];
        if (stamp && (key === 'execution' || key === 'ExecuteTime')) {
          findings.push({ kind: 'timestamp', confidence: 'probable', location: where, label: 'Execution time', value: stamp });
        } else {
          findings.push({ kind: 'environment', confidence: 'probable', location: where, label: 'Cell metadata', value: metadataValue(value) });
        }
      }
    }

    if (isObj(cell.attachments)) {
      for (const [name, bundle] of Object.entries(cell.attachments)) findings.push(...bundleFindings(bundle, at('cells', i, 'attachments', name), paths));
    }

    const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
    for (const [j, output] of outputs.entries()) {
      if (!isObj(output)) continue;
      const where = at('cells', i, 'outputs', j);
      if (output.output_type === 'stream') findings.push(...textFindings(joined(output.text), where, paths));
      else if (output.output_type === 'error') {
        findings.push(...textFindings([output.ename, output.evalue, frames(output.traceback)].filter((x) => typeof x === 'string').join('\n'), where, paths));
      }
      findings.push(...bundleFindings(output.data, where, paths));
    }
  }

  for (const [path, where] of paths) findings.push({ kind: 'environment', confidence: 'confirmed', location: where, label: 'Local path in an output', value: path });

  // The characters of the sources and Markdown get the text pass, as any text does.
  const characters = inspectPlainText(sources).filter((f) => f.kind === 'invisible-character' || f.kind === 'deceptive-link');
  findings.push(...characters.map((f) => ({ ...f, location: f.location === 'file contents' ? 'cells' : `cells → ${f.location}` })));

  return {
    format: 'ipynb',
    findings: [...findings, ...fingerprint(findings)].sort(byConfidence),
    notes: [{ code: 'scope:notebook' }],
  };
}

export interface NotebookClean {
  text: string;
  outputsCleared: number;
  notes: Note[];
}

function stripBundle(bundle: Json): void {
  if (!isObj(bundle)) return;
  for (const [mime, value] of Object.entries(bundle)) {
    if (!IMAGE.test(mime) || typeof value !== 'string') continue;
    const bytes = decodeBase64(value);
    const stripped = bytes && stripImageMetadata(bytes);
    if (stripped) bundle[mime] = encodeBase64(stripped) + (value.endsWith('\n') ? '\n' : '');
  }
}

/** Jupyter's own layout: one-space indent, non-ASCII kept, a final newline. */
export function cleanNotebook(nb: Obj, options: { clearOutputs?: boolean }): NotebookClean {
  const notes: Note[] = [{ code: 'scope:notebook' }];
  if (isObj(nb.metadata)) {
    for (const key of Object.keys(nb.metadata)) if (!RUN_KEYS.has(key)) delete nb.metadata[key];
  }
  let outputsCleared = 0;
  for (const cell of Array.isArray(nb.cells) ? nb.cells : []) {
    if (!isObj(cell)) continue;
    if (isObj(cell.metadata)) {
      for (const key of Object.keys(cell.metadata)) if (!DISPLAY_KEYS.has(key)) delete cell.metadata[key];
    }
    if (isObj(cell.attachments)) for (const bundle of Object.values(cell.attachments)) stripBundle(bundle);
    if (!Array.isArray(cell.outputs)) continue;
    if (options.clearOutputs) {
      if (cell.outputs.length) outputsCleared++;
      cell.outputs = [];
      if ('execution_count' in cell) cell.execution_count = null;
      continue;
    }
    for (const output of cell.outputs) if (isObj(output)) stripBundle(output.data);
  }
  if (outputsCleared) notes.push({ code: 'removed:outputs', detail: String(outputsCleared) });
  return { text: `${JSON.stringify(nb, null, 1)}\n`, outputsCleared, notes };
}

export function redactNotebook(nb: Obj, options: { clearOutputs?: boolean }): RedactResult {
  const before = inspectNotebook(nb);
  const cleaned = cleanNotebook(structuredClone(nb), options);
  return { format: 'ipynb', data: new TextEncoder().encode(cleaned.text), removed: before.findings, notes: cleaned.notes };
}

/** [F-2.3] The sources and the text of the outputs, for the personal-data and rules scans. */
export function notebookText(nb: Obj): string {
  const out: string[] = [];
  for (const cell of Array.isArray(nb.cells) ? nb.cells : []) {
    if (!isObj(cell)) continue;
    out.push(joined(cell.source));
    for (const output of Array.isArray(cell.outputs) ? cell.outputs : []) {
      if (!isObj(output)) continue;
      out.push(joined(output.text), frames(output.traceback).replace(ANSI, ''));
      if (isObj(output.data)) for (const [mime, value] of Object.entries(output.data)) if (mime.startsWith('text/')) out.push(joined(value));
    }
  }
  return out.filter(Boolean).join('\n');
}

/**
 * [F-P2 2.2] Rich Text Format.
 *
 * An RTF file is text, and most of what it says about its author sits in
 * named groups any reader can find:
 *
 *   {\info …}            title, author, operator (last saved by), company,
 *                        manager, dates, editing minutes, revision number
 *   {\*\generator …}     the program that wrote it — WordPad says Riched20
 *   {\*\userprops …}     custom properties
 *   {\*\template …}      the template path, often under C:\Users\<account>
 *   {\*\rsidtbl …}       Word's revision save identifiers
 *   {\*\revtbl …}        the names behind tracked changes
 *   {\*\atnauthor …}     the names behind comments
 *   {\object …}          embedded objects: an OLE1 header, then the data —
 *                        a whole compound file, or for a Package the file
 *                        it carries with the paths it had on the author's disk
 *   {\pict \jpegblip …}  pictures, as hex, with their own EXIF
 *   {\*\fldinst …}       fields: HYPERLINK, INCLUDEPICTURE, INCLUDETEXT, LINK
 *
 * Cleaning works on the group tree, never on regular expressions over the
 * file: a literal "\\info" in the text is an escaped backslash, not a group.
 * The info group, the generator, custom properties, the template, the
 * revision identifiers go; the revision and comment authors become "Author";
 * pictures lose their metadata; on request an object is replaced by the
 * picture Word shows in its place.
 */

import type { Finding, InspectOptions, InspectResult, Note, RedactResult } from './types.js';
import { byConfidence, preview } from './types.js';
import { fingerprint } from './fingerprint.js';
import { inspectImage, stripImageMetadata, detectImageKind } from './image.js';
import { linkFindings } from './links.js';
import { isCfb, readCfb } from './cfb.js';
import { objectFindings } from './legacy-office.js';
import { ANONYMOUS } from './comments.js';
import { ARCHIVE_SEPARATOR } from './archive.js';
import { contrastLevel, hex, toFindings, TINY_PT, type Hidden, type HiddenHow, type Rgb } from './hidden-text.js';

export const isRtf = (data: Uint8Array) => data.length > 5 && String.fromCharCode(...data.subarray(0, 5)) === '{\\rtf';

/** One byte per character, so that what is written back is the bytes that were read. */
function binary(data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i += 0x8000) out += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return out;
}

const bytesOf = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);

interface Group {
  start: number;
  end: number;
  /** The destination: the first control word, after `\*` when there is one. */
  word: string;
  /** Opened by `\*`: a destination a reader that does not know it skips. */
  starred: boolean;
  children: number[];
}

interface Tree {
  src: string;
  groups: Group[];
  /** Control words that carry a revision save identifier, as [start, end). */
  rsids: Array<[number, number]>;
}

const CONTROL = /([a-zA-Z]{1,32})(-?\d{1,10})? ?/y;
const DESTINATION = /(\\\*[ \r\n]*)?\\([a-zA-Z]{1,32})/y;
const MAX_GROUPS = 2_000_000;

/** RTF 1.9.1: groups by their braces, control words by their backslash, `\bin` data skipped. */
function parse(src: string): Tree {
  const groups: Group[] = [];
  const rsids: Array<[number, number]> = [];
  const stack: number[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') {
      DESTINATION.lastIndex = i + 1;
      const destination = DESTINATION.exec(src);
      if (groups.length < MAX_GROUPS) {
        const parent = stack.at(-1);
        if (parent !== undefined) groups[parent]!.children.push(groups.length);
        stack.push(groups.length);
        groups.push({ start: i, end: src.length, word: destination?.[2] ?? '', starred: Boolean(destination?.[1]), children: [] });
      } else {
        stack.push(-1);
      }
      i++;
    } else if (c === '}') {
      const g = stack.pop();
      if (g !== undefined && g >= 0) groups[g]!.end = i + 1;
      i++;
    } else if (c === '\\') {
      CONTROL.lastIndex = i + 1;
      const m = CONTROL.exec(src);
      if (!m) {
        i += src[i + 1] === "'" ? 4 : 2;
        continue;
      }
      const next = i + 1 + m[0].length;
      if (m[1] === 'bin' && m[2]) i = next + Math.max(0, Number(m[2]));
      else {
        if (m[2] && /rsid/.test(m[1]!)) rsids.push([i, next]);
        i = next;
      }
    } else {
      i++;
    }
  }
  return { src, groups, rsids };
}

const CODE_PAGES: Record<number, string> = { 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 10000: 'macintosh', 866: 'ibm866', 874: 'windows-874' };

function decoderFor(src: string): TextDecoder {
  const head = src.slice(0, 4096);
  const page = Number(/\\ansicpg(\d+)/.exec(head)?.[1] ?? (/\\mac\b/.test(head) ? 10000 : 1252));
  try {
    return new TextDecoder(CODE_PAGES[page] ?? `windows-${page}`);
  } catch {
    return new TextDecoder('windows-1252');
  }
}

/**
 * The text of a group, nested groups left out unless `deep` — a field's
 * instruction often sits in a group of its own: code page escapes through the
 * document's code page, `\uN` as the character, its fallback skipped.
 */
function textOf(tree: Tree, g: Group, decoder: TextDecoder, deep = false): string {
  const { src } = tree;
  let out = '';
  let pending: number[] = [];
  const flush = () => {
    if (pending.length) out += decoder.decode(new Uint8Array(pending));
    pending = [];
  };
  let skip = 0;
  let fallback = 1;
  let depth = 0;
  let i = g.start + 1;
  while (i < g.end - 1) {
    const c = src[i]!;
    if (c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}') {
      depth--;
      i++;
      continue;
    }
    if (c === '\\') {
      if (src[i + 1] === "'") {
        if ((deep || depth === 0) && !(skip && skip--)) pending.push(parseInt(src.slice(i + 2, i + 4), 16) || 0);
        i += 4;
        continue;
      }
      CONTROL.lastIndex = i + 1;
      const m = CONTROL.exec(src);
      if (!m) {
        const symbol = src[i + 1];
        if ((deep || depth === 0) && !(skip && skip--)) {
          if (symbol === '~') pending.push(0xa0);
          else if (symbol === '_') pending.push(0x2d);
          else if (symbol === '\\' || symbol === '{' || symbol === '}') pending.push(symbol.charCodeAt(0));
        }
        i += 2;
        continue;
      }
      i += 1 + m[0].length;
      if (m[1] === 'bin' && m[2]) {
        i += Math.max(0, Number(m[2]));
        continue;
      }
      if ((!deep && depth !== 0)) continue;
      if (m[1] === 'uc' && m[2]) fallback = Number(m[2]);
      else if (m[1] === 'u' && m[2]) {
        flush();
        const code = Number(m[2]);
        out += String.fromCharCode(code < 0 ? code + 65536 : code);
        skip = fallback;
      } else if (m[1] === 'tab' || m[1] === 'par' || m[1] === 'line') pending.push(0x20);
      continue;
    }
    if ((deep || depth === 0) && c !== '\r' && c !== '\n') {
      if (skip) skip--;
      else pending.push(c.charCodeAt(0));
    }
    i++;
  }
  flush();
  return out.trim();
}

/** The group's own control words, nested groups left out. */
function ownSource(tree: Tree, g: Group): string {
  let out = '';
  let at = g.start;
  for (const child of g.children) {
    out += tree.src.slice(at, tree.groups[child]!.start);
    at = tree.groups[child]!.end;
  }
  return out + tree.src.slice(at, g.end);
}

const INFO_FIELDS: Record<string, { label: string; kind: Finding['kind']; confidence: Finding['confidence'] }> = {
  title: { label: 'Title', kind: 'identity', confidence: 'probable' },
  subject: { label: 'Subject', kind: 'identity', confidence: 'probable' },
  author: { label: 'Author', kind: 'identity', confidence: 'confirmed' },
  operator: { label: 'Last modified by', kind: 'identity', confidence: 'confirmed' },
  manager: { label: 'Manager', kind: 'identity', confidence: 'confirmed' },
  company: { label: 'Company', kind: 'identity', confidence: 'confirmed' },
  category: { label: 'Category', kind: 'identity', confidence: 'probable' },
  keywords: { label: 'Keywords', kind: 'identity', confidence: 'probable' },
  doccomm: { label: 'Description', kind: 'identity', confidence: 'probable' },
  hlinkbase: { label: 'Hyperlink base', kind: 'environment', confidence: 'confirmed' },
  creatim: { label: 'Created', kind: 'timestamp', confidence: 'probable' },
  revtim: { label: 'Modified', kind: 'timestamp', confidence: 'probable' },
  printim: { label: 'Last printed', kind: 'timestamp', confidence: 'probable' },
  buptim: { label: 'Last backup', kind: 'timestamp', confidence: 'probable' },
};

/** `\yr2024\mo3\dy5\hr10\min20` as 2024-03-05 10:20. */
function rtfDate(source: string): string | undefined {
  const part = (word: string) => /\d+/.exec(new RegExp(`\\\\${word}(\\d+)`).exec(source)?.[1] ?? '')?.[0];
  const year = part('yr');
  if (!year || year === '0') return undefined;
  const pad = (v: string | undefined) => (v ?? '0').padStart(2, '0');
  return `${year}-${pad(part('mo'))}-${pad(part('dy'))} ${pad(part('hr'))}:${pad(part('min'))}`;
}

const minutes = (total: number) => {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
};

const LOCAL_TARGET = /^(file:|[a-z]:[\\/]|\\\\)/i;
const NOBODY = new Set(['', 'Unknown', ANONYMOUS]);
const MAX_HEX = 64 * 1024 * 1024;

function hexBytes(text: string): Uint8Array {
  const digits = text.replace(/[^0-9a-fA-F]/g, '').slice(0, MAX_HEX);
  const out = new Uint8Array(digits.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const toHex = (bytes: Uint8Array) => {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
    if (i % 64 === 63) out += '\r\n';
  }
  return out;
};

/** MS-OLEDS 2.2: an OLE1 object header, then for an embedded object its native data. */
function readOle1(data: Uint8Array): { className: string; topic: string; linked: boolean; native?: Uint8Array } | undefined {
  if (data.length < 12) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const format = view.getUint32(4, true);
  let at = 8;
  const string = () => {
    if (at + 4 > data.length) return undefined;
    const length = view.getUint32(at, true);
    if (length > 4096 || at + 4 + length > data.length) return undefined;
    const value = new TextDecoder('windows-1252').decode(data.subarray(at + 4, at + 4 + length)).replace(/\0[\s\S]*$/, '');
    at += 4 + length;
    return value;
  };
  const className = string();
  const topic = string();
  const item = string();
  if (className === undefined || topic === undefined || item === undefined) return undefined;
  if (format !== 2) return { className, topic, linked: format === 1 };
  if (at + 4 > data.length) return { className, topic, linked: false };
  const size = Math.min(view.getUint32(at, true), data.length - at - 4);
  return { className, topic, linked: false, native: data.subarray(at + 4, at + 4 + size) };
}

/** An Ole10Native stream is the Package's native data behind its size. */
function withSize(native: Uint8Array): Uint8Array {
  const out = new Uint8Array(native.length + 4);
  new DataView(out.buffer).setUint32(0, native.length, true);
  out.set(native, 4);
  return out;
}

async function objectsOf(tree: Tree, object: Group, n: number, decoder: TextDecoder, inspectMember: InspectOptions['inspectMember']): Promise<Finding[]> {
  const location = `\\object ${n}`;
  const child = (word: string) => object.children.map((c) => tree.groups[c]!).find((g) => g.word === word);
  const className = child('objclass') ? textOf(tree, child('objclass')!, decoder) : undefined;
  const data = child('objdata');
  const ole = data ? readOle1(hexBytes(textOf(tree, data, decoder))) : undefined;
  if (!ole) {
    return [{ kind: 'active-content', confidence: 'probable', location, label: 'Embedded object (OLE)', value: `object${className ? `, ProgID ${className}` : ''}` }];
  }
  const progId = className || ole.className || undefined;
  if (ole.linked) {
    const out: Finding[] = [{ kind: 'active-content', confidence: 'probable', location, label: 'Embedded object (OLE)', value: `linked object${progId ? `, ProgID ${progId}` : ''}` }];
    if (ole.topic) out.push({ kind: 'environment', confidence: 'confirmed', location, label: 'Link to a local or network path', value: ole.topic });
    return out;
  }
  const native = ole.native ?? new Uint8Array();
  if (progId === 'Package' || ole.className === 'Package') {
    const stream = withSize(native);
    return objectFindings(location, (name) => (name === '\x01Ole10Native' ? stream : undefined), inspectMember, 'Package');
  }
  if (isCfb(native)) {
    const cfb = readCfb(native);
    if (cfb) {
      const out = await objectFindings(location, (name) => cfb.read(name), inspectMember, progId);
      if (inspectMember && !cfb.read('\x01Ole10Native')) {
        try {
          const name = progId ?? 'embedded object';
          out.push(...(await inspectMember(native, name)).findings.map((f) => ({ ...f, location: `${location}${ARCHIVE_SEPARATOR}${name}${ARCHIVE_SEPARATOR}${f.location}` })));
        } catch {
          // An object no parser claims is still named above.
        }
      }
      return out;
    }
  }
  return [{ kind: 'active-content', confidence: 'probable', location, label: 'Embedded object (OLE)', value: `${native.length} bytes${progId ? `, ProgID ${progId}` : ''}` }];
}

/** A span's control words and braces, its literal text left out: what a picture group is without its hex. */
function controlsOnly(span: string): string {
  let out = '';
  let i = 0;
  while (i < span.length) {
    const c = span[i]!;
    if (c === '\\') {
      CONTROL.lastIndex = i + 1;
      const m = CONTROL.exec(span);
      const n = m ? 1 + m[0].length : span[i + 1] === "'" ? 4 : 2;
      out += span.slice(i, i + n);
      i += n;
      continue;
    }
    if (c === '{' || c === '}') out += c;
    i++;
  }
  return out;
}

const isPicture = (tree: Tree, g: Group) => g.word === 'pict' && /\\(?:jpeg|png)blip\b/.test(ownSource(tree, g));

/** A field instruction's argument: quoted, backslashes doubled as field codes write them. */
function fieldTarget(instruction: string, keyword: string): string | undefined {
  const m = new RegExp(`^\\s*${keyword}\\s+(?:\\\\[a-z]\\s+)*(?:"([^"]*)"|(\\S+))`, 'i').exec(instruction);
  const target = m?.[1] ?? m?.[2];
  return target?.replace(/\\\\/g, '\\');
}

function fieldFindings(instruction: string, location: string): Finding[] {
  const out: Finding[] = [];
  const local = (target: string) => {
    if (LOCAL_TARGET.test(target)) out.push({ kind: 'environment', confidence: 'confirmed', location, label: 'Link to a local or network path', value: target });
  };
  if (/^\s*HYPERLINK\s+\\l/i.test(instruction)) return out;
  const link = fieldTarget(instruction, 'HYPERLINK');
  if (link) {
    out.push(...linkFindings([link], location));
    local(link);
  }
  for (const [keyword, what] of [['INCLUDEPICTURE', 'picture'], ['INCLUDETEXT', 'text']] as const) {
    const target = fieldTarget(instruction, keyword);
    if (!target) continue;
    if (/^https?:/i.test(target)) out.push({ kind: 'active-content', confidence: 'probable', location, label: 'Remote resource loaded on opening', value: preview(`${what}: ${target}`, 300) });
    local(target);
  }
  const linked = /^\s*LINK\s+\S+\s+"([^"]*)"/i.exec(instruction)?.[1];
  if (linked) local(linked.replace(/\\\\/g, '\\'));
  return out;
}

export async function inspectRtf(data: Uint8Array, options: InspectOptions = {}): Promise<InspectResult> {
  const tree = parse(binary(data));
  const decoder = decoderFor(tree.src);
  const findings: Finding[] = [];
  const authors = new Set<string>();
  let objects = 0;
  let pictures = 0;
  let fields = 0;

  for (const g of tree.groups) {
    switch (g.word) {
      case 'info':
        for (const c of g.children) {
          const field = tree.groups[c]!;
          const spec = INFO_FIELDS[field.word];
          if (!spec) continue;
          const value = spec.kind === 'timestamp' ? rtfDate(ownSource(tree, field)) : textOf(tree, field, decoder);
          if (value) findings.push({ ...spec, location: `\\info\\${field.word}`, value });
        }
        {
          const own = ownSource(tree, g);
          const edited = Number(/\\edmins(\d+)/.exec(own)?.[1] ?? 0);
          if (edited) findings.push({ kind: 'timestamp', confidence: 'probable', location: '\\info\\edmins', label: 'Total editing time', value: minutes(edited) });
          const version = Number(/\\version(\d+)/.exec(own)?.[1] ?? 0);
          if (version > 1) findings.push({ kind: 'timestamp', confidence: 'probable', location: '\\info\\version', label: 'Revision number', value: String(version) });
        }
        break;
      case 'generator': {
        const value = textOf(tree, g, decoder).replace(/;$/, '').trim();
        if (value) findings.push({ kind: 'provenance', confidence: 'informational', location: '\\generator', label: 'Producing application', value });
        break;
      }
      case 'template': {
        const value = textOf(tree, g, decoder);
        if (value) findings.push({ kind: 'environment', confidence: 'confirmed', location: '\\template', label: 'Template', value });
        break;
      }
      case 'userprops': {
        let name: string | undefined;
        for (const c of g.children) {
          const prop = tree.groups[c]!;
          if (prop.word === 'propname') name = textOf(tree, prop, decoder);
          else if (prop.word === 'staticval' && name) {
            findings.push({ kind: 'identity', confidence: 'confirmed', location: `\\userprops:${name}`, label: `Custom property: ${name}`, value: textOf(tree, prop, decoder) });
            name = undefined;
          }
        }
        break;
      }
      case 'rsidtbl': {
        const count = (ownSource(tree, g).match(/\\rsid\d+/g) ?? []).length;
        if (count) findings.push({ kind: 'environment', confidence: 'probable', location: '\\rsidtbl', label: 'Revision save IDs', value: `${count} value${count > 1 ? 's' : ''} (correlate documents edited in the same session)` });
        break;
      }
      case 'revtbl':
        for (const c of g.children) authors.add(textOf(tree, tree.groups[c]!, decoder).replace(/;$/, '').trim());
        break;
      case 'atnauthor':
        authors.add(textOf(tree, g, decoder));
        break;
      case 'object':
        findings.push(...(await objectsOf(tree, g, ++objects, decoder, options.inspectMember)));
        break;
      case 'fldinst':
        findings.push(...fieldFindings(textOf(tree, g, decoder, true), `\\field ${++fields}`));
        break;
      case 'pict':
        pictures++;
        if (isPicture(tree, g)) findings.push(...inspectImage(hexBytes(textOf(tree, g, decoder)), `\\pict ${pictures}`));
        break;
    }
  }
  for (const nobody of NOBODY) authors.delete(nobody);
  // [P0-2] Text the document carries and does not show.
  findings.push(...toFindings(hiddenRuns(tree, decoder), 'document'));
  if (authors.size) findings.push({ kind: 'identity', confidence: 'confirmed', location: 'tracked changes / comments', label: 'Comment and revision authors', value: [...authors].join(', ') });

  return { format: 'rtf', findings: [...findings, ...fingerprint(findings)].sort(byConfidence), notes: [{ code: 'scope:rtf' }] };
}

/**
 * [P0-2] Text set as hidden (\\v), coloured as its background (\\cf against the
 * \\highlight or \\cb behind it, else the page's white), or below two points
 * (\\fs in half-points). The character state follows the groups: a group
 * starts with its parent's, \\plain resets it.
 */
interface CharState {
  v: boolean;
  cf: number;
  fs: number;
  bg: number;
}

const HIDDEN_SKIPPED = new Set([...['fonttbl', 'colortbl', 'stylesheet', 'listtable', 'listoverridetable', 'info', 'pict', 'objdata', 'objclass', 'fldinst', 'xe', 'tc'], 'themedata', 'colorschememapping', 'datastore', 'latentstyles']);
const WHITE: Rgb = [255, 255, 255];

function colourTable(tree: Tree): Array<Rgb | undefined> {
  const table = tree.groups.find((g) => g.word === 'colortbl');
  if (!table) return [];
  const body = tree.src.slice(table.start, table.end).replace(/^\{\\colortbl ?/, '').replace(/\}$/, '');
  return body.split(';').slice(0, -1).map((entry) => {
    const part = (name: string) => Number(new RegExp(`\\\\${name}(\\d{1,3})`).exec(entry)?.[1] ?? NaN);
    const rgb: Rgb = [part('red'), part('green'), part('blue')];
    return rgb.every((v) => Number.isFinite(v)) ? rgb : undefined;
  });
}

function hiddenRuns(tree: Tree, decoder: TextDecoder): Hidden[] {
  const root = tree.groups[0];
  if (!root) return [];
  const { src } = tree;
  const colours = colourTable(tree);
  const skipAt = new Map<number, number>();
  for (const g of tree.groups) if (g !== root && (g.starred || HIDDEN_SKIPPED.has(g.word))) skipAt.set(g.start, g.end);

  const found: Hidden[] = [];
  let run: { how: HiddenHow; why: string; bytes: number[]; text: string } | undefined;
  const close = () => {
    if (run) {
      const text = (run.text + decoder.decode(new Uint8Array(run.bytes))).replace(/\s+/g, ' ').trim();
      if (text) found.push({ how: run.how, why: run.why, text });
    }
    run = undefined;
  };
  const reasonOf = (state: CharState): { how: HiddenHow; why: string } | undefined => {
    if (state.v) return { how: 'vanish', why: '\\v' };
    const colour = state.cf ? colours[state.cf] : undefined;
    if (colour) {
      const background = (state.bg && colours[state.bg]) || WHITE;
      const level = contrastLevel(colour, background);
      if (level === 'hidden') return { how: 'invisible', why: `\\cf${state.cf} ${hex(colour)} on ${hex(background)}` };
      if (level === 'faint') return { how: 'faint', why: `\\cf${state.cf} ${hex(colour)} on ${hex(background)}` };
    }
    if (state.fs < TINY_PT * 2) return { how: 'tiny', why: `\\fs${state.fs}` };
    return undefined;
  };
  const emit = (state: CharState, byte?: number, char?: string) => {
    const reason = reasonOf(state);
    const blank = char !== undefined ? !char.trim() : byte === 0x20;
    if (!reason) {
      if (!blank) close();
      return;
    }
    if (run && run.how !== reason.how) close();
    run ??= { ...reason, bytes: [], text: '' };
    if (char !== undefined) {
      run.text += decoder.decode(new Uint8Array(run.bytes)) + char;
      run.bytes = [];
    } else if (byte !== undefined) run.bytes.push(byte);
  };

  const fresh = (): CharState => ({ v: false, cf: 0, fs: 24, bg: 0 });
  const stack: CharState[] = [fresh()];
  let skip = 0;
  let fallback = 1;
  let i = root.start + 1;
  while (i < root.end - 1) {
    const c = src[i]!;
    const state = stack.at(-1)!;
    if (c === '{') {
      const end = skipAt.get(i);
      if (end !== undefined) {
        i = end;
        continue;
      }
      stack.push({ ...state });
      i++;
      continue;
    }
    if (c === '}') {
      if (stack.length > 1) stack.pop();
      i++;
      continue;
    }
    if (c === '\\') {
      if (src[i + 1] === "'") {
        if (!(skip && skip--)) emit(state, parseInt(src.slice(i + 2, i + 4), 16) || 0);
        i += 4;
        continue;
      }
      CONTROL.lastIndex = i + 1;
      const m = CONTROL.exec(src);
      if (!m) {
        const symbol = src[i + 1];
        if (symbol === '~') emit(state, 0xa0);
        else if (symbol === '\\' || symbol === '{' || symbol === '}') emit(state, symbol.charCodeAt(0));
        i += 2;
        continue;
      }
      i += 1 + m[0].length;
      const word = m[1]!;
      const n = m[2] === undefined ? undefined : Number(m[2]);
      if (word === 'bin' && n) i += Math.max(0, n);
      else if (word === 'plain') Object.assign(state, { v: false, cf: 0, fs: 24, bg: 0 });
      else if (word === 'v') state.v = n !== 0;
      else if (word === 'cf') state.cf = n ?? 0;
      else if (word === 'fs') state.fs = n ?? 24;
      else if (word === 'highlight' || word === 'cb' || word === 'chcbpat') state.bg = n ?? 0;
      else if (word === 'uc' && n !== undefined) fallback = n;
      else if (word === 'u' && n !== undefined) {
        emit(state, undefined, String.fromCharCode(n < 0 ? n + 65536 : n));
        skip = fallback;
      } else if (word === 'par' || word === 'line' || word === 'tab' || word === 'cell' || word === 'row' || word === 'sect' || word === 'page') emit(state, 0x20);
      continue;
    }
    if (c !== '\r' && c !== '\n') {
      if (skip) skip--;
      else emit(state, c.charCodeAt(0));
    }
    i++;
  }
  close();
  return found;
}

/** Groups that hold no running text: tables, properties, pictures, field codes. */
const NOT_TEXT = new Set(['fonttbl', 'colortbl', 'stylesheet', 'listtable', 'listoverridetable', 'info', 'pict', 'objdata', 'objclass', 'fldinst', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'xe', 'tc']);

/** [F-P2 2.2] The running text, for personal data, an organisation's rules and the clean-text export. */
export function rtfText(data: Uint8Array): string {
  const tree = parse(binary(data));
  const decoder = decoderFor(tree.src);
  const parts: string[] = [];
  const walk = (index: number) => {
    const g = tree.groups[index]!;
    if (g.starred || NOT_TEXT.has(g.word)) return;
    parts.push(textOf(tree, g, decoder));
    for (const c of g.children) walk(c);
  };
  if (tree.groups.length) walk(0);
  return parts.filter(Boolean).join('\n');
}

/** Destinations that go whole. */
const DROPPED = new Set(['info', 'generator', 'userprops', 'template', 'rsidtbl']);

export interface RedactRtfOptions {
  /** Replace each object by the picture shown in its place. */
  stripActive?: boolean;
}

export async function redactRtf(data: Uint8Array, options: RedactRtfOptions = {}): Promise<RedactResult> {
  const before = (await inspectRtf(data)).findings;
  const tree = parse(binary(data));
  const decoder = decoderFor(tree.src);
  const { src, groups } = tree;
  const notes: Note[] = [{ code: 'scope:rtf' }];
  let objects = 0;

  /** The source from `start` to `end`, children rewritten and revision identifiers left out. */
  const emit = (start: number, end: number, children: number[]): string => {
    let out = '';
    let at = start;
    const rsids = tree.rsids.filter(([s, e]) => s >= start && e <= end);
    const events = [
      ...children.map((c) => ({ start: groups[c]!.start, end: groups[c]!.end, child: c })),
      ...rsids.map(([s, e]) => ({ start: s, end: e, child: -1 })),
    ].sort((a, b) => a.start - b.start);
    for (const event of events) {
      if (event.start < at) continue;
      out += src.slice(at, event.start);
      if (event.child >= 0) out += rewrite(event.child);
      at = event.end;
    }
    return out + src.slice(at, end);
  };

  const rewrite = (index: number): string => {
    const g = groups[index]!;
    if (DROPPED.has(g.word)) return '';
    if (g.word === 'atnauthor') return `{\\*\\atnauthor ${ANONYMOUS}}`;
    if (g.word === 'atnid') return '{\\*\\atnid A}';
    if (g.word === 'revtbl') {
      return `{\\*\\revtbl ${g.children.map((c) => (textOf(tree, groups[c]!, decoder).replace(/;$/, '').trim() === 'Unknown' ? '{Unknown;}' : `{${ANONYMOUS};}`)).join('')}}`;
    }
    if (g.word === 'object' && options.stripActive) {
      objects++;
      const result = g.children.map((c) => groups[c]!).find((c) => c.word === 'result');
      if (!result) return '';
      // The result group's content, kept in a group of its own so its formatting stays scoped.
      const inner = emit(result.start, result.end, result.children);
      return `{${inner.slice(1).replace(/^\\result ?/, '')}`;
    }
    if (isPicture(tree, g)) {
      const bytes = hexBytes(textOf(tree, g, decoder));
      const cleaned = detectImageKind(bytes) ? stripImageMetadata(bytes) : undefined;
      if (cleaned && (cleaned.length !== bytes.length || cleaned.some((b, i) => b !== bytes[i]))) {
        // Control words and nested groups kept, the hex replaced.
        let out = '';
        let at = g.start;
        for (const c of g.children) {
          out += controlsOnly(src.slice(at, groups[c]!.start)) + rewrite(c);
          at = groups[c]!.end;
        }
        return `${out}${controlsOnly(src.slice(at, g.end - 1))}\r\n${toHex(cleaned)}}`;
      }
    }
    return emit(g.start, g.end, g.children);
  };

  const root = groups[0];
  const text = root ? src.slice(0, root.start) + rewrite(0) + src.slice(root.end) : src;
  if (objects) notes.push({ code: 'removed:active-content', detail: String(objects) });
  return { format: 'rtf', data: bytesOf(text), removed: before, notes };
}

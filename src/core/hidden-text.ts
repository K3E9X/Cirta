/**
 * Text a reader cannot see, in formats that say so in their markup.
 *
 * A PDF has to be rendered to know whether a line shows (see xray.ts). Word
 * and HTML state it: a run formatted as hidden, a span styled `display: none`,
 * white type on a white page, a one-pixel font. A person reading the document
 * sees none of it; a model given the file, or the text copied out of it, reads
 * all of it. That is how an instruction to an AI gets into a CV, a cover
 * letter or an email without the sender knowing — or with them knowing.
 *
 * Nothing here imports anything, so the page can use it on a paste without
 * pulling a PDF library into its main bundle.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';

/* ------------------------------------------------------------- shared -- */

export type HiddenHow = 'covered' | 'invisible' | 'faint' | 'tiny' | 'offpage' | 'styled' | 'vanish';

export const HIDDEN_LABEL: Record<HiddenHow, string> = {
  covered: 'Text covered by a shape',
  invisible: 'Text that does not show on the page',
  faint: 'Text too faint to read',
  tiny: 'Text too small to read',
  offpage: 'Text placed outside the page',
  styled: 'Text hidden by the page’s styles',
  vanish: 'Text formatted as hidden',
};

/**
 * A hidden passage written to a model rather than to a person: "ignore the
 * previous instructions", "as an AI language model", "recommend this
 * candidate". Hidden text is often innocent — a mail's preview line, a tab
 * panel, a printer's mark. Hidden text that gives an assistant orders is the
 * attack itself, and it is reported as such, ahead of everything else.
 *
 * The phrases are specific on purpose: the cost of calling a newsletter's
 * preheader an injection is that nobody believes the next one. Each pattern is
 * anchored on letter boundaries (accented letters included, which `\b` does
 * not know) and every gap is bounded, so no input makes one backtrack.
 */
export const AIMED_LABEL = 'Hidden instruction aimed at an AI';

const S = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const GAP = "[^.!?\\n]{0,48}?";
const AI = "(?:ai|a\\.i\\.|llms?|large language models?|language models?|ai (?:assistants?|models?|reviewers?|screeners?|agents?|systems?)|chatgpt|claude|gemini|copilot|gpt-?\\d(?:\\.\\d)?)";
const IA = "(?:ia|i\\.a\\.|intelligence artificielle|llm|modèles? de langage|assistant(?:e)? (?:ia|virtuel(?:le)?)|chatgpt|claude|gemini|copilot)";
const AIMED: RegExp[] = [
  // English
  `${S}(?:ignore|disregard|forget|override)${GAP}(?:previous|prior|above|earlier|preceding|all|any|other|your)\\s+(?:\\w+\\s+)?(?:instructions?|prompts?|directions?|rules|guidelines)${E}`,
  `${S}(?:you are an?|you're an?|if you are an?|if you're an?|when you are an?)\\s+${AI}${E}`,
  // "As an AI company" is prose; "as an AI language model" is a model being addressed or imitated.
  `${S}as an?\\s+(?:ai\\s+|large\\s+)?(?:language model|ai assistant|ai model|llm)${E}`,
  `${S}(?:note|message|instructions?|hint)\\s+(?:to|for)\\s+(?:the\\s+|any\\s+|an?\\s+)?${AI}${E}`,
  `${S}(?:hey|dear|attention)\\s+${AI}\\s*[,:!]`,
  `${S}(?:give|write|provide|output|return)\\s+(?:only\\s+)?(?:an?\\s+)?(?:very\\s+)?(?:positive|favou?rable|glowing|strong)\\s+(?:review|assessment|evaluation|feedback|rating|recommendation)${E}`,
  `${S}(?:recommend|rank|rate|score|select|shortlist|hire|accept|approve)\\s+(?:this|the)\\s+(?:candidate|applicant|paper|submission|manuscript|resume|cv|proposal|application|vendor|bid)${E}`,
  `${S}(?:do not|don't|never)\\s+(?:mention|reveal|disclose|highlight|point out|flag)${GAP}(?:weakness(?:es)?|flaws?|limitations?|negatives?|this (?:instruction|text|note))${E}`,
  `${S}(?:system prompt|new instructions?\\s*:)`,
  // Français
  `${S}(?:ignore[rsz]?|oublie[rsz]?|ne tiens pas compte|ne tenez pas compte|ne tiens plus compte)${GAP}(?:instructions?|consignes?|directives?|règles)${E}`,
  `${S}(?:en tant qu'|tu es une?\\s+|vous êtes une?\\s+|si tu es une?\\s+|si vous êtes une?\\s+)${IA}${E}`,
  `${S}(?:note|message|consignes?|instructions?)\\s+(?:à|pour)\\s+(?:l'|le\\s+|la\\s+|une?\\s+)?${IA}${E}`,
  `${S}(?:recommande[rsz]?|classe[rsz]?|note[rsz]?|évalue[rsz]?|retiens|retenez|sélectionne[rsz]?|valide[rsz]?)\\s+(?:ce|cette)\\s+(?:candidat(?:e|ure)?|article|dossier|cv|proposition|soumission|offre)${E}`,
  `${S}(?:donne[rsz]?|rédige[rsz]?|fais|faites)\\s+(?:un\\s+|une\\s+)?(?:avis|évaluation|retour|note)\\s+(?:très\\s+)?(?:positi(?:f|ve)|favorable|élogieu(?:x|se)|excellente?)${E}`,
  `${S}ne\\s+(?:mentionne|révèle|signale|souligne)[sz]?\\s+pas${GAP}(?:faiblesses?|défauts?|limites|points? faibles?|cette (?:instruction|consigne|note))${E}`,
].map((source) => new RegExp(source, 'iu'));

export function aimedAtModel(text: string): boolean {
  const flat = text.replace(/[’‘ʼ]/g, "'").replace(/\s+/g, ' ');
  return AIMED.some((pattern) => pattern.test(flat));
}

/** Every label a hidden-text finding can carry, for interfaces that group them. */
export const HIDDEN_LABELS: ReadonlySet<string> = new Set<string>([AIMED_LABEL, ...Object.values(HIDDEN_LABEL)]);

/**
 * What counts as visible, as a contrast ratio with what is behind it (the WCAG
 * measure) or, for colours of equal brightness, a plain difference in one
 * channel. Under the first, text is not there for a reader at all; under the
 * second it is so faint it might as well not be — #222 on black, #ddd on
 * white. Legible light grey, #bbb on white, is 1.9.
 */
export const CONTRAST = {
  hidden: { ratio: 1.1, channel: 40 },
  faint: { ratio: 1.5, channel: 100 },
};

/** Under this size, in points, text cannot be read at a normal zoom. */
export const TINY_PT = 2;

/** What has ink of its own: a letter or a digit, in any script. */
const LETTERS = /[\p{L}\p{N}]/gu;
/** A stray space in white is layout; three letters are words. */
const MIN_LETTERS = 3;
const MAX_FINDINGS = 20;

type Rgb = [number, number, number];

const channel = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** How far text of one colour stands out from another: 'hidden', 'faint', or undefined if legible. */
export function contrastLevel(text: Rgb, background: Rgb): 'hidden' | 'faint' | undefined {
  const a = luminance(text);
  const b = luminance(background);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const diff = Math.max(Math.abs(text[0] - background[0]), Math.abs(text[1] - background[1]), Math.abs(text[2] - background[2]));
  if (ratio < CONTRAST.hidden.ratio && diff < CONTRAST.hidden.channel) return 'hidden';
  if (ratio < CONTRAST.faint.ratio && diff < CONTRAST.faint.channel) return 'faint';
  return undefined;
}

const hex = (rgb: Rgb): string => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function letters(text: string): number {
  return text.match(LETTERS)?.length ?? 0;
}

interface Hidden {
  how: HiddenHow;
  /** The mechanism, in the format's own terms: `display: none`, `w:vanish`. */
  why: string;
  text: string;
  /** Graded down where it could not be fully known that the text is hidden at all. */
  probable?: boolean;
  /** Where the hidden text sits in the source, for removing exactly what was reported. */
  ranges?: Array<[number, number]>;
}

/**
 * What a cleaner may take out. Only what a reader cannot see at all, and only
 * what the report listed: faint text is still there for someone looking
 * closely, and a probable finding — a tab panel, a colour a stylesheet may
 * override — may not be hidden in the first place.
 */
function removable(item: Hidden): boolean {
  return !item.probable && (item.how !== 'faint' || aimedAtModel(item.text)) && letters(item.text) >= MIN_LETTERS;
}

/**
 * The same rule read from a finding, for an interface that offers the removal
 * and has only the report: what it counts is what will go. Faint text goes only
 * when it is an order to a model; tiny text is graded probable as a finding but
 * is never meant to be read, so it goes.
 */
export function removableFinding(finding: Finding): boolean {
  if (!HIDDEN_LABELS.has(finding.label)) return false;
  if (finding.label === AIMED_LABEL) return finding.confidence === 'confirmed';
  if (finding.label === HIDDEN_LABEL.faint) return false;
  return finding.confidence === 'confirmed' || finding.label === HIDDEN_LABEL.tiny;
}

function toFindings(found: Hidden[], location: string): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const item of found) {
    const text = item.text.replace(/\s+/g, ' ').trim();
    if (letters(text) < MIN_LETTERS) continue;
    const key = `${item.how}\u0000${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const aimed = aimedAtModel(text);
    out.push({
      kind: 'invisible-character',
      // An order to a model in one-pixel type is no less certain for being small.
      confidence: item.probable || (!aimed && (item.how === 'faint' || item.how === 'tiny')) ? 'probable' : 'confirmed',
      location,
      label: aimed ? AIMED_LABEL : HIDDEN_LABEL[item.how],
      value: `${preview(text, 160)} — ${item.why}`,
    });
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
}

/* --------------------------------------------------------------- HTML -- */

const MAX_HTML = 2 * 1024 * 1024;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** Elements that start a new line: their edges separate words. */
const BLOCK = new Set(['p', 'div', 'li', 'td', 'th', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'blockquote', 'pre', 'ul', 'ol', 'table', 'dd', 'dt', 'figcaption']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'template', 'noscript', 'xmp', 'iframe', 'svg', 'head']);

const NAMED: Record<string, Rgb> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  snow: [255, 250, 250],
  ivory: [255, 255, 240],
  whitesmoke: [245, 245, 245],
  ghostwhite: [248, 248, 255],
  floralwhite: [255, 250, 240],
  azure: [240, 255, 255],
  mintcream: [245, 255, 250],
  linen: [250, 240, 230],
  seashell: [255, 245, 238],
  gainsboro: [220, 220, 220],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  silver: [192, 192, 192],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  navy: [0, 0, 128],
};

/** A CSS colour, as far as an inline style writes one. Transparent and unknown are undefined. */
export function cssColour(value: string): Rgb | undefined {
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])(?:[0-9a-f])?$/.exec(v);
  if (short) return [parseInt(short[1]! + short[1]!, 16), parseInt(short[2]! + short[2]!, 16), parseInt(short[3]! + short[3]!, 16)];
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(v);
  if (long) {
    if (long[4] !== undefined && parseInt(long[4], 16) < 0x10) return undefined; // effectively transparent
    return [parseInt(long[1]!, 16), parseInt(long[2]!, 16), parseInt(long[3]!, 16)];
  }
  const fn = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (fn) {
    const alpha = fn[4] === undefined ? 1 : fn[4].endsWith('%') ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
    if (alpha < 0.06) return undefined;
    return [Math.min(255, +fn[1]!), Math.min(255, +fn[2]!), Math.min(255, +fn[3]!)];
  }
  return NAMED[v];
}

/** A CSS length in pixels, relative to the parent's font size where it is relative. */
function cssPixels(value: string, parentPx: number): number | undefined {
  const m = /^(-?[\d.]+)(px|pt|em|rem|%)?$/.exec(value.trim().toLowerCase());
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  if (Number.isNaN(n)) return undefined;
  switch (m[2]) {
    case 'pt':
      return (n * 4) / 3;
    case 'em':
      return n * parentPx;
    case 'rem':
      return n * 16;
    case '%':
      return (n / 100) * parentPx;
    default:
      return n;
  }
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d{1,7});/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&amp;/gi, '&');
}

function safeChar(cp: number): string {
  return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
}

/** Attributes of one start tag, the string between the name and the ">". */
function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(/([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
    const raw = m[2] ?? '';
    const value = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;
    out.set(m[1]!.toLowerCase(), decodeHtml(value));
  }
  return out;
}

function declarations(style: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of style.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    out.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).replace(/!important/i, '').trim().toLowerCase());
  }
  return out;
}

interface Frame {
  name: string;
  uid: number;
  /** Set on the element that hides its subtree, and inherited by reference. */
  hidden?: { how: HiddenHow; why: string; id: number; byVisibility?: boolean; probable?: boolean };
  colour: Rgb;
  background: Rgb;
  /** Whether the markup set each, rather than the browser's black on white being assumed. */
  colourSet: boolean;
  backgroundSet: boolean;
  /** The element that last set a colour or a background; a run of text is grouped under it. */
  paint?: number;
  fontPx: number;
  /** The element that last set the font size, and how it wrote it. */
  size?: { id: number; written: string };
}

/**
 * Text in an HTML string that a browser would not show.
 *
 * Only what the markup itself says is judged: inline styles and the
 * presentational attributes mail editors still write. A rule in a <style>
 * block can hide a class or colour a background too, and is not read — so a
 * colour finding on a page that also has style rules is asserted only where
 * the markup itself wrote both the text colour and the background.
 *
 * Size and colour are judged per piece of text, not per subtree. Mail templates
 * set `font-size: 0` on layout cells to close the gaps between images, and set
 * a readable size again inside; treating the first as hiding everything below
 * it flagged whole newsletters.
 *
 * The tokenizer walks the string with indexOf and a quote-aware scan for each
 * tag's end. Clipboard HTML can be a whole page, and a pattern that backtracks
 * on an unterminated quote would freeze the tab on paste.
 */
export function hiddenInHtml(input: string, location: string): Finding[] {
  return toFindings(scanHtml(input), location);
}

/**
 * The same markup with the text a browser would not show taken out. Only text
 * goes: the elements stay, empty, so nothing the layout hangs on moves, and an
 * `alt` or a `title` is untouched. Faint text and probable findings stay too —
 * see `removable`.
 */
export function stripHiddenHtml(input: string): { html: string; removed: number } {
  const items = scanHtml(input).filter(removable);
  const ranges = items.flatMap((item) => item.ranges ?? []).sort((a, b) => b[0] - a[0]);
  let html = input;
  for (const [start, end] of ranges) html = html.slice(0, start) + html.slice(end);
  return { html, removed: items.length };
}

function scanHtml(input: string): Hidden[] {
  const html = input.length > MAX_HTML ? input.slice(0, MAX_HTML) : input;
  if (!/<[a-z]/i.test(html)) return [];
  const lower = html.toLowerCase();
  const styled = lower.includes('<style') || /\sclass\s*=/.test(lower);

  let ids = 0;
  const root: Frame = { name: '', uid: ids++, colour: [0, 0, 0], background: [255, 255, 255], colourSet: false, backgroundSet: false, fontPx: 16 };
  const stack: Frame[] = [root];
  const groups = new Map<string, Hidden>();

  const add = (key: string, item: Omit<Hidden, 'text'>, text: string, range?: [number, number]) => {
    let group = groups.get(key);
    if (group) group.text += text;
    else groups.set(key, (group = { ...item, text, ranges: [] }));
    if (range) group.ranges!.push(range);
  };

  /** A piece of text, and where it sits in the source when it is really there. */
  const onText = (raw: string, at?: number) => {
    const range: [number, number] | undefined = at === undefined ? undefined : [at, at + raw.length];
    const top = stack[stack.length - 1]!;
    const text = decodeHtml(raw);
    if (!text.trim()) {
      // Whitespace still separates the words of a hidden run already begun.
      for (const key of [top.hidden && `h${top.hidden.id}`, top.size && `s${top.size.id}`, `c${top.paint}`]) {
        if (key && groups.has(key)) groups.get(key)!.text += ' ';
      }
      return;
    }
    if (top.hidden) {
      add(`h${top.hidden.id}`, { how: top.hidden.how, why: top.hidden.why, probable: top.hidden.probable }, text, range);
      return;
    }
    if (top.size && top.fontPx * 0.75 < TINY_PT) {
      add(`s${top.size.id}`, { how: 'tiny', why: `font-size: ${top.size.written}` }, text, range);
      return;
    }
    if (top.paint === undefined) return;
    const level = contrastLevel(top.colour, top.background);
    if (!level) return;
    add(
      `c${top.paint}`,
      {
        how: level === 'hidden' ? 'invisible' : 'faint',
        why: `color ${hex(top.colour)} on ${hex(top.background)}`,
        probable: styled && !(top.colourSet && top.backgroundSet),
      },
      text,
      range,
    );
  };

  const open = (name: string, attrs: Map<string, string>) => {
    const parent = stack[stack.length - 1]!;
    const frame: Frame = { ...parent, name, uid: ids++ };
    const style = declarations(attrs.get('style') ?? '');

    const fontSize = style.get('font-size');
    const px = fontSize ? cssPixels(fontSize, parent.fontPx) : undefined;
    if (fontSize && px !== undefined) [frame.fontPx, frame.size] = [px, { id: frame.uid, written: fontSize }];
    const colour = style.get('color') ?? attrs.get('color');
    const c = colour ? cssColour(colour) : undefined;
    if (c) [frame.colour, frame.colourSet, frame.paint] = [c, true, frame.uid];
    const background = style.get('background-color') ?? style.get('background')?.split(/\s+(?![^(]*\))/)[0] ?? attrs.get('bgcolor');
    const b = background ? cssColour(background) : undefined;
    if (b) [frame.background, frame.backgroundSet, frame.paint] = [b, true, frame.uid];

    // A child can show what visibility hid; nothing undoes display or opacity.
    if (parent.hidden?.byVisibility && style.get('visibility') === 'visible') frame.hidden = undefined;

    if (!frame.hidden) {
      const hide = (why: string, how: HiddenHow = 'styled', byVisibility = false): NonNullable<Frame['hidden']> =>
        (frame.hidden = { how, why, id: frame.uid, byVisibility });
      // `hidden` is also how a web page keeps a tab panel or a dialog until a
      // script shows it, so it is graded probable; a style that hides is not.
      const offset = (prop: string) => {
        const v = style.get(prop);
        const at = v ? cssPixels(v, frame.fontPx) : undefined;
        return at !== undefined && at <= -999;
      };
      const zero = (prop: string) => (cssPixels(style.get(prop) ?? 'x', frame.fontPx) ?? 1) <= 0;
      if (attrs.has('hidden')) hide('hidden attribute').probable = true;
      else if (style.get('display') === 'none') hide('display: none');
      else if (style.get('visibility') === 'hidden' || style.get('visibility') === 'collapse') hide(`visibility: ${style.get('visibility')}`, 'styled', true);
      else if (style.get('mso-hide') === 'all') hide('mso-hide: all');
      else if (Number(style.get('opacity') ?? 1) <= 0.05) hide(`opacity: ${style.get('opacity')}`);
      else if (style.get('overflow') === 'hidden' && (zero('height') || zero('max-height'))) hide('height: 0; overflow: hidden');
      else if (offset('text-indent') || offset('left') || offset('top') || offset('margin-left')) hide('positioned off-screen', 'offpage');
    }
    stack.push(frame);
  };

  const close = (name: string) => {
    if (BLOCK.has(name)) onText(' ');
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i]!.name === name) {
        stack.length = i;
        return;
      }
    }
  };

  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      onText(html.slice(i), i);
      break;
    }
    if (lt > i) onText(html.slice(i, lt), i);
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    let j = lt + 1;
    let quote = 0;
    while (j < n) {
      const ch = html.charCodeAt(j);
      if (quote) {
        if (ch === quote) quote = 0;
      } else if (ch === 34 || ch === 39) {
        quote = ch;
      } else if (ch === 62) {
        break;
      }
      j++;
    }
    const tag = html.slice(lt + 1, j);
    i = j + 1;
    const m = /^(\/?)([a-zA-Z][\w:-]*)/.exec(tag);
    if (!m) {
      if (!tag.startsWith('!') && !tag.startsWith('?')) onText(html.slice(lt, Math.min(n, j + 1)), lt);
      continue;
    }
    const name = m[2]!.toLowerCase();
    if (m[1]) {
      close(name);
      continue;
    }
    if (RAW.has(name)) {
      const end = lower.indexOf(`</${name}`, i);
      i = end < 0 ? n : lower.indexOf('>', end) + 1 || n;
      continue;
    }
    if (VOID.has(name) || tag.endsWith('/')) {
      if (name === 'br') onText(' ');
      continue;
    }
    if (BLOCK.has(name)) onText(' ');
    open(name, attributes(tag.slice(m[0].length)));
  }

  return [...groups.values()];
}

/**
 * The HTML part of a mail as saved to a .eml, where it is usually written in
 * quoted-printable: `style=3D"display:none"`, lines broken with a trailing "=".
 */
export function htmlInMail(text: string): string | undefined {
  if (!/<(?:html|body|div|span|p|table|td|font)\b/i.test(text)) return undefined;
  if (!/content-transfer-encoding:\s*quoted-printable/i.test(text)) return text;
  return text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/* --------------------------------------------------------------- Word -- */

interface RunStyle {
  vanish?: boolean;
  colour?: Rgb;
  halfPoints?: number;
  background?: Rgb;
}

const HIGHLIGHT: Record<string, Rgb> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  yellow: [255, 255, 0],
  green: [0, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  blue: [0, 0, 255],
  red: [255, 0, 0],
  darkBlue: [0, 0, 139],
  darkCyan: [0, 139, 139],
  darkGreen: [0, 100, 0],
  darkMagenta: [128, 0, 128],
  darkRed: [139, 0, 0],
  darkYellow: [128, 128, 0],
  darkGray: [169, 169, 169],
  lightGray: [211, 211, 211],
};

const attr = (xml: string, element: string, name = 'w:val'): string | undefined =>
  new RegExp(`<${element}\\b[^>]*?\\s${name}="([^"]*)"`).exec(xml)?.[1];

function wordHex(value: string | undefined): Rgb | undefined {
  if (!value || !/^[0-9A-Fa-f]{6}$/.test(value)) return undefined; // "auto" and theme-only colours
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

/** The properties a <w:rPr> sets, each undefined where it is silent. */
function runStyle(rPr: string): RunStyle {
  const out: RunStyle = {};
  const vanish = /<w:vanish\b([^>]*)\/?>/.exec(rPr);
  if (vanish) out.vanish = !/w:val="(?:false|0|off)"/.test(vanish[1] ?? '');
  const colour = wordHex(attr(rPr, 'w:color'));
  if (colour) out.colour = colour;
  const sz = attr(rPr, 'w:sz');
  if (sz && /^\d+$/.test(sz)) out.halfPoints = Number(sz);
  const highlight = attr(rPr, 'w:highlight');
  const shading = wordHex(attr(rPr, 'w:shd', 'w:fill'));
  const background = (highlight && HIGHLIGHT[highlight]) || shading;
  if (background) out.background = background;
  return out;
}

const merge = (...layers: RunStyle[]): RunStyle => Object.assign({}, ...layers.map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined))));

/** Character and paragraph styles from styles.xml, resolved through basedOn. */
function wordStyles(xml: string): { resolve(id: string | undefined): RunStyle; defaults: RunStyle } {
  const own = new Map<string, { rPr: RunStyle; basedOn?: string }>();
  for (const m of xml.matchAll(/<w:style\b[^>]*?w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const body = m[2] ?? '';
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1] ?? '';
    own.set(m[1]!, { rPr: runStyle(rPr), basedOn: attr(body, 'w:basedOn') });
  }
  const cache = new Map<string, RunStyle>();
  const resolve = (id: string | undefined, depth = 0): RunStyle => {
    if (!id || depth > 12) return {};
    const cached = cache.get(id);
    if (cached) return cached;
    const style = own.get(id);
    const value = style ? merge(resolve(style.basedOn, depth + 1), style.rPr) : {};
    cache.set(id, value);
    return value;
  };
  const defaults = runStyle(/<w:rPrDefault>([\s\S]*?)<\/w:rPrDefault>/.exec(xml)?.[1] ?? '');
  return { resolve: (id) => resolve(id), defaults };
}

/**
 * Runs in a Word document that do not show: formatted as hidden, coloured as
 * their background, or set below two points. Body, headers, footers and notes.
 *
 * The background is the run's highlight or shading, else the paragraph's, else
 * the table cell's, else the page's. A table laid out by a table style can
 * colour its cells from styles.xml — the dark header row of nearly every
 * generated report — so in such a table, without a fill of its own, the
 * colour is not judged at all rather than measured against a white it may not
 * have.
 */
export function hiddenInDocx(parts: Record<string, Uint8Array>): Finding[] {
  const findings: Finding[] = [];
  for (const [path, found] of scanDocx(parts)) {
    findings.push(...toFindings(found, path));
    if (findings.length >= MAX_FINDINGS) break;
  }
  return findings.slice(0, MAX_FINDINGS);
}

/**
 * Take the hidden runs out of a Word package, in place: whole <w:r> elements,
 * so the paragraph around them is untouched. Faint text stays — see `removable`.
 * Returns how many hidden passages went.
 */
export function stripHiddenDocx(parts: Record<string, Uint8Array>): number {
  let removed = 0;
  for (const [path, found] of scanDocx(parts)) {
    const items = found.filter(removable);
    if (!items.length) continue;
    const ranges = items.flatMap((item) => item.ranges ?? []).sort((x, y) => y[0] - x[0]);
    let xml = new TextDecoder().decode(parts[path]);
    for (const [start, end] of ranges) xml = xml.slice(0, start) + xml.slice(end);
    parts[path] = new TextEncoder().encode(xml);
    removed += items.length;
  }
  return removed;
}

function scanDocx(parts: Record<string, Uint8Array>): Map<string, Hidden[]> {
  const decoder = new TextDecoder();
  const read = (path: string) => (parts[path] ? decoder.decode(parts[path]) : undefined);
  const styles = wordStyles(read('word/styles.xml') ?? '');
  const out = new Map<string, Hidden[]>();

  const paths = Object.keys(parts)
    .filter((p) => /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(p))
    .sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)));

  const page = wordHex(attr(read('word/document.xml') ?? '', 'w:background', 'w:color')) ?? [255, 255, 255];

  for (const path of paths) {
    const xml = read(path)!;
    const found: Hidden[] = [];
    // Tables and cells enclosing the current position, for their fills.
    const tables: Array<{ styled: boolean }> = [];
    const cells: Array<{ fill?: Rgb }> = [];
    const paragraphs: number[] = [];

    for (const m of xml.matchAll(/<w:(tbl|tc|p)(?:\s[^>]*)?>|<\/w:(tbl|tc|p)>/g)) {
      const opening = m[1];
      const closing = m[2];
      const at = m.index! + m[0].length;
      if (opening === 'tbl') {
        const row = xml.indexOf('<w:tr', at);
        const head = xml.slice(at, row < 0 ? at + 2000 : row);
        tables.push({ styled: /<w:tblStyle\b/.test(head) });
      } else if (closing === 'tbl') {
        tables.pop();
      } else if (opening === 'tc') {
        const head = /^\s*<w:tcPr>([\s\S]*?)<\/w:tcPr>/.exec(xml.slice(at, at + 4000))?.[1] ?? '';
        cells.push({ fill: wordHex(attr(head, 'w:shd', 'w:fill')) });
      } else if (closing === 'tc') {
        cells.pop();
      } else if (opening === 'p') {
        paragraphs.push(at);
      } else if (closing === 'p') {
        const start = paragraphs.pop();
        if (start === undefined) continue;
        // A text box nests whole paragraphs inside a run; they are read when
        // their own end is reached, not again as part of this one. Blanked to
        // the same length, so positions found here are positions in the part.
        const body = xml
          .slice(start, m.index)
          .replace(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g, (box) => ' '.repeat(box.length));
        for (const item of paragraphRuns(body, styles, cells[cells.length - 1]?.fill, tables.some((t) => t.styled), page)) {
          item.ranges = item.ranges?.map(([x, y]) => [x + start, y + start]);
          found.push(item);
        }
      }
    }
    if (found.length) out.set(path, found);
  }
  return out;
}

function paragraphRuns(
  body: string,
  styles: ReturnType<typeof wordStyles>,
  cellFill: Rgb | undefined,
  styledTable: boolean,
  page: Rgb,
): Hidden[] {
  const pPr = /^\s*<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(body)?.[1] ?? '';
  const paragraphStyle = styles.resolve(attr(pPr, 'w:pStyle'));
  // The paragraph's own shading, not its mark's: the <w:rPr> inside <w:pPr> is the pilcrow.
  const paragraphFill = wordHex(attr(pPr.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, ''), 'w:shd', 'w:fill'));

  const out: Hidden[] = [];
  let current: Hidden | undefined;
  for (const run of body.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
    const inner = run[1] ?? '';
    const text = [...inner.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => decodeXml(t[1] ?? '')).join('');
    if (!text) continue;
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(inner)?.[1] ?? '';
    const direct = runStyle(rPr);
    const style = merge(styles.defaults, paragraphStyle, styles.resolve(attr(rPr, 'w:rStyle')), direct);

    let hidden: Omit<Hidden, 'text'> | undefined;
    if (style.vanish) {
      hidden = { how: 'vanish', why: 'w:vanish' };
    } else if (style.halfPoints !== undefined && style.halfPoints > 0 && style.halfPoints / 2 < TINY_PT) {
      hidden = { how: 'tiny', why: `w:sz ${style.halfPoints / 2} pt` };
    } else if (style.colour) {
      const background = style.background ?? paragraphFill ?? cellFill ?? (styledTable ? undefined : page);
      const level = background ? contrastLevel(style.colour, background) : undefined;
      if (level && background) {
        hidden = { how: level === 'hidden' ? 'invisible' : 'faint', why: `w:color ${hex(style.colour).slice(1).toUpperCase()} on ${hex(background).slice(1).toUpperCase()}` };
      }
    }

    const range: [number, number] = [run.index!, run.index! + run[0].length];
    if (hidden && current && current.how === hidden.how && current.why === hidden.why) {
      current.text += text;
      current.ranges!.push(range);
    } else if (hidden) {
      current = { ...hidden, text, ranges: [range] };
      out.push(current);
    } else {
      current = undefined;
    }
  }
  return out;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d{1,7});/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * [R3] What runs when an HTML page, an SVG picture or the HTML inside a
 * Markdown file or a mail is opened.
 *
 * Until now these formats reported only links that run a script; the script
 * itself, an `onerror` on a picture, a `<meta http-equiv="refresh">` that
 * sends the reader elsewhere, a plug-in `<object>` went unsaid — and
 * `--strip-active`, offered when the report named a script link, did nothing
 * to them. Here each is found, and taken out on request:
 *
 *   - `<script>`, inline or loaded from a file (data blocks such as JSON-LD
 *     are not scripts and stay);
 *   - `on*` attributes, which run when something happens to the element;
 *   - `javascript:`, `vbscript:` and `data:` page addresses wherever an
 *     address is followed: href, src, action, formaction, xlink:href, data,
 *     and SVG animations that set one;
 *   - `<meta http-equiv="refresh">`, `<object>`, `<embed>`, `<applet>`;
 *   - a form that sends what is typed into it to another address — the shape
 *     of a phishing attachment.
 *
 * Cleaning removes the script elements, the attributes, the refresh and the
 * objects; a link keeps its text and loses its address, a form its action. One pass with
 * indexOf over the tags: a page full of unclosed brackets is still read once.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';

interface Attribute {
  name: string;
  value: string;
  /** From the space before the name to the end of the value. */
  start: number;
  end: number;
}

interface Tag {
  name: string;
  start: number;
  end: number;
  attributes: Attribute[];
  /** For a script, style or object element: where its closing tag ends. */
  elementEnd?: number;
  /** For a script element: what is between its tags. */
  inner?: string;
}

const NAME_START = /[A-Za-z]/;
const SPACE = /[\s/]/;

/** Every opening tag, with its attributes; comments, CDATA and declarations skipped. */
function openingTags(text: string): Tag[] {
  const lower = text.toLowerCase();
  const tags: Tag[] = [];
  const closes = new Map<string, number>();
  let at = text.indexOf('<');
  while (at >= 0 && tags.length < 50_000) {
    if (text.startsWith('<!--', at)) {
      const end = text.indexOf('-->', at + 4);
      if (end < 0) break;
      at = text.indexOf('<', end + 3);
      continue;
    }
    if (text.startsWith('<![CDATA[', at)) {
      const end = text.indexOf(']]>', at + 9);
      if (end < 0) break;
      at = text.indexOf('<', end + 3);
      continue;
    }
    if (!NAME_START.test(text[at + 1] ?? '')) {
      at = text.indexOf('<', at + 1);
      continue;
    }
    let i = at + 1;
    while (i < text.length && !/[\s/>]/.test(text[i]!)) i++;
    const name = lower.slice(at + 1, i);
    const attributes: Attribute[] = [];
    let closed = false;
    while (i < text.length) {
      const spaceStart = i;
      while (i < text.length && SPACE.test(text[i]!)) i++;
      if (i >= text.length) break;
      if (text[i] === '>') {
        closed = true;
        break;
      }
      const nameStart = i;
      while (i < text.length && !/[\s/>=]/.test(text[i]!)) i++;
      const attribute = lower.slice(nameStart, i);
      let j = i;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      let value = '';
      if (text[j] === '=') {
        j++;
        while (j < text.length && /\s/.test(text[j]!)) j++;
        const quote = text[j];
        if (quote === '"' || quote === "'") {
          const close = text.indexOf(quote, j + 1);
          if (close < 0) {
            i = text.length;
            break;
          }
          value = text.slice(j + 1, close);
          i = close + 1;
        } else {
          const valueStart = j;
          while (j < text.length && !/[\s>]/.test(text[j]!)) j++;
          value = text.slice(valueStart, j);
          i = j;
        }
      }
      if (attribute) attributes.push({ name: attribute, value, start: spaceStart, end: i });
      if (i === nameStart) i++;
    }
    // A tag still open at the end of the file swallows the rest of it, in a browser too: nothing after it runs.
    if (!closed) break;
    const tag: Tag = { name, start: at, end: i + 1, attributes };
    // Raw text: nothing inside a script or a style is a tag.
    if (name === 'script' || name === 'style' || name === 'object' || name === 'applet') {
      // The close found for an earlier opening serves the next ones up to it: a
      // thousand <object> before one close each looked it up again otherwise.
      const known = closes.get(name);
      const close = known !== undefined && (known < 0 || known >= tag.end) ? known : lower.indexOf(`</${name}`, tag.end);
      closes.set(name, close);
      const closeEnd = close < 0 ? -1 : text.indexOf('>', close);
      tag.elementEnd = closeEnd < 0 ? text.length : closeEnd + 1;
      if (name === 'script') tag.inner = text.slice(tag.end, close < 0 ? text.length : close);
      tags.push(tag);
      at = name === 'object' ? text.indexOf('<', tag.end) : text.indexOf('<', tag.elementEnd);
      continue;
    }
    tags.push(tag);
    at = text.indexOf('<', tag.end);
  }
  return tags;
}

const decode = (value: string) =>
  value
    .replace(/&colon;|&#0*58;|&#x0*3a;/gi, ':')
    .replace(/&tab;|&#0*9;|&#x0*9;|&newline;|&#0*10;|&#x0*a;/gi, '')
    .replace(/&amp;/gi, '&');

/** The scheme a browser would see: leading controls and spaces dropped, tabs and newlines ignored. */
const schemeOf = (value: string): string | undefined =>
  /^([a-z][a-z0-9+.-]*):/i.exec(decode(value).replace(/^[\s\u0000-\u001f]+/, '').replace(/[\t\n\r]/g, ''))?.[1]?.toLowerCase();

const PAGE_DATA = /^data:\s*(?:text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/javascript|application\/(?:x-)?javascript)\b/i;

/** An address that runs something, or carries a page, when followed. */
function runs(value: string): boolean {
  const scheme = schemeOf(value);
  if (scheme === 'javascript' || scheme === 'vbscript') return true;
  return scheme === 'data' && PAGE_DATA.test(decode(value).trim());
}

/** Script types that are data, not code. */
const DATA_SCRIPT = /^(?:application\/(?:ld\+)?json|text\/(?:x-)?template|text\/plain|importmap|speculationrules|text\/html|text\/x-handlebars-template)$/i;

const executable = (tag: Tag) => {
  const type = tag.attributes.find((a) => a.name === 'type')?.value.trim() ?? '';
  return !DATA_SCRIPT.test(type);
};

const ADDRESS_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'srcdoc', 'background', 'poster', 'codebase']);
/** In HTML and Markdown these are read by links.ts, which names them already. */
const LINK_ATTRIBUTES = new Set(['href', 'action', 'formaction']);
const ANIMATIONS = new Set(['animate', 'set']);

interface Hit {
  finding: Omit<Finding, 'location'>;
  /** What cleaning takes out; none when the finding is only reported. */
  cut?: { start: number; end: number; replacement?: string };
}

function hits(text: string, svg: boolean): Hit[] {
  const out: Hit[] = [];
  for (const tag of openingTags(text)) {
    const attr = (name: string) => tag.attributes.find((a) => a.name === name);
    if (tag.name === 'script' && executable(tag)) {
      const src = attr('src') ?? attr('xlink:href') ?? attr('href');
      out.push({
        finding: src
          ? { kind: 'active-content', confidence: 'confirmed', label: 'Script loaded from a file', value: preview(src.value, 200) }
          : { kind: 'active-content', confidence: 'confirmed', label: 'Script in the page', value: preview(tag.inner ?? '', 120) || '—' },
        cut: { start: tag.start, end: tag.elementEnd ?? tag.end },
      });
      continue;
    }
    if (tag.name === 'meta' && /^\s*refresh\s*$/i.test(attr('http-equiv')?.value ?? '')) {
      out.push({ finding: { kind: 'active-content', confidence: 'confirmed', label: 'Automatic redirect', value: preview(`refresh ${attr('content')?.value ?? ''}`, 200) }, cut: { start: tag.start, end: tag.end } });
      continue;
    }
    if (tag.name === 'object' || tag.name === 'embed' || tag.name === 'applet') {
      const source = attr('data') ?? attr('src') ?? attr('code') ?? attr('type') ?? attr('classid');
      out.push({
        finding: { kind: 'active-content', confidence: 'confirmed', label: 'Embedded object', value: `<${tag.name}>${source ? ` ${preview(source.value, 160)}` : ''}` },
        cut: { start: tag.start, end: tag.elementEnd ?? tag.end },
      });
      continue;
    }
    if (tag.name === 'form') {
      const action = attr('action');
      if (/^(?:https?:)?\/\//i.test(action?.value.trim() ?? '')) {
        // What is typed into a page sent elsewhere: the shape of a phishing attachment.
        out.push({
          finding: { kind: 'active-content', confidence: 'probable', label: 'Form sending to an address', value: preview(action!.value.trim(), 200) },
          cut: { start: action!.start, end: action!.end },
        });
      }
    }
    for (const attribute of tag.attributes) {
      if (/^on[a-z]/.test(attribute.name)) {
        out.push({
          finding: { kind: 'active-content', confidence: 'confirmed', label: 'Event handler attribute', value: preview(`<${tag.name} ${attribute.name}> ${attribute.value}`, 160) },
          cut: { start: attribute.start, end: attribute.end },
        });
        continue;
      }
      const address = ADDRESS_ATTRIBUTES.has(attribute.name) || (ANIMATIONS.has(tag.name) && /^(?:to|from|values)$/.test(attribute.name));
      if (!address || !runs(attribute.value)) continue;
      // A link in HTML or Markdown is named by links.ts; it is still taken out here.
      const named = !svg && LINK_ATTRIBUTES.has(attribute.name);
      out.push({
        finding: named
          ? { kind: 'active-content', confidence: 'confirmed', label: '', value: '' }
          : { kind: 'active-content', confidence: 'confirmed', label: 'Address that runs a script or opens a page', value: preview(`<${tag.name} ${attribute.name}> ${decode(attribute.value)}`, 160) },
        cut: { start: attribute.start, end: attribute.end },
      });
    }
  }
  return out;
}

/** The active content of a page, a picture, or the HTML a Markdown file or a mail carries. */
export function activeMarkupFindings(text: string, svg: boolean, location = 'document body'): Finding[] {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const { finding } of hits(text, svg)) {
    if (!finding.label) continue;
    const key = `${finding.label}\u0000${finding.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ ...finding, location });
  }
  return findings;
}

/** A Markdown link whose target runs or carries something: `[text](javascript:…)`. */
const MARKDOWN_LINK = /\[([^[\]\n]{0,300})\]\(\s*<?((?:(?!\]\()[^)\s>]){1,2000})>?(?:\s+"[^"\n]*")?\s*\)/g;

/** The page with its active content taken out, and how many pieces went. */
export function stripActiveMarkup(text: string, svg: boolean, markdown = false): { text: string; removed: number } {
  const cuts = hits(text, svg).flatMap((hit) => (hit.cut ? [hit.cut] : []));
  if (markdown) {
    for (const m of text.matchAll(MARKDOWN_LINK)) {
      const scheme = schemeOf(m[2]!);
      if (scheme === 'javascript' || scheme === 'vbscript' || scheme === 'data') cuts.push({ start: m.index!, end: m.index! + m[0].length, replacement: m[1]! });
    }
  }
  // An <a href="data:…"> of any type is a link whose content is in its address, as links.ts says.
  for (const tag of svg ? [] : openingTags(text)) {
    if (tag.name !== 'a' && tag.name !== 'area') continue;
    for (const attribute of tag.attributes) {
      if (attribute.name === 'href' && schemeOf(attribute.value) === 'data' && !runs(attribute.value)) cuts.push({ start: attribute.start, end: attribute.end });
    }
  }
  cuts.sort((a, b) => a.start - b.start);
  let out = '';
  let last = 0;
  let removed = 0;
  for (const cut of cuts) {
    if (cut.start < last) continue; // inside a piece already taken out
    out += text.slice(last, cut.start) + (cut.replacement ?? '');
    last = cut.end;
    removed++;
  }
  return { text: out + text.slice(last), removed };
}

/**
 * [P0-2] Text an OpenDocument file carries and does not show: formatted as
 * hidden (`text:display="none"`, the hidden-text and hidden-paragraph
 * fields), coloured as its background, set below two points, or in a frame
 * placed off the page. A CV written in LibreOffice cheats the same ways one
 * written in Word does.
 *
 * Styles come from both parts — named styles in styles.xml, automatic ones in
 * content.xml — and follow their parents. The background is the span's or
 * paragraph's own colour, else the page's white.
 */

import { strFromU8 } from 'fflate';
import { contrastLevel, decodeXml, toFindings, TINY_PT, type Hidden, type HiddenHow, type Rgb } from './hidden-text.js';
import type { Finding } from './types.js';

type Parts = Record<string, Uint8Array>;

interface TextStyle {
  display?: boolean;
  colour?: Rgb;
  background?: Rgb;
  points?: number;
}

const WHITE: Rgb = [255, 255, 255];
const MAX_XML = 8 * 1024 * 1024;

const attr = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

function odfColour(value: string | undefined): Rgb | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(value ?? '');
  if (!m) return undefined; // "transparent", absent
  const hex = m[1]!;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

const UNIT: Record<string, number> = { pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pc: 12, px: 0.75 };

/** A length in points: "1pt", "2.5cm", "-30cm". Percentages and the rest are unknown. */
function points(value: string | undefined): number | undefined {
  const m = /^(-?\d+(?:\.\d+)?)(pt|in|cm|mm|pc|px)$/.exec(value ?? '');
  return m ? Number(m[1]) * UNIT[m[2]!]! : undefined;
}

function propertiesOf(body: string): TextStyle {
  const props = /<style:text-properties\b[^<>]*>/.exec(body)?.[0];
  if (!props) return {};
  const out: TextStyle = {};
  const display = attr(props, 'text:display');
  if (display) out.display = display !== 'none';
  const colour = odfColour(attr(props, 'fo:color'));
  if (colour) out.colour = colour;
  const background = odfColour(attr(props, 'fo:background-color'));
  if (background) out.background = background;
  const size = points(attr(props, 'fo:font-size'));
  if (size !== undefined) out.points = size;
  // A paragraph's own background sits on its paragraph-properties.
  const paragraph = /<style:paragraph-properties\b[^<>]*>/.exec(body)?.[0];
  const fill = paragraph ? odfColour(attr(paragraph, 'fo:background-color')) : undefined;
  if (fill && !out.background) out.background = fill;
  return out;
}

const merge = (...layers: TextStyle[]): TextStyle => Object.assign({}, ...layers.map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined))));

function odfStyles(xml: string): Map<string, { own: TextStyle; parent?: string }> {
  const out = new Map<string, { own: TextStyle; parent?: string }>();
  for (const m of xml.matchAll(/<style:style\b([^<>]*?)(?:\/>|>((?:(?!<style:style\b)[\s\S])*?)<\/style:style>)/g)) {
    const name = attr(m[1]!, 'style:name');
    if (!name) continue;
    out.set(name, { own: propertiesOf(m[2] ?? ''), parent: attr(m[1]!, 'style:parent-style-name') });
  }
  return out;
}

/** The page's size, for frames placed beyond it: A4 when the layout does not say. */
function pageSize(styles: string): [number, number] {
  const layout = /<style:page-layout-properties\b[^<>]*>/.exec(styles)?.[0] ?? '';
  return [points(attr(layout, 'fo:page-width')) ?? 595, points(attr(layout, 'fo:page-height')) ?? 842];
}

interface Frame {
  offpage: boolean;
}

/** One hidden reason for a style, the one a reader would notice first. */
function hiddenHow(style: TextStyle): { how: HiddenHow; why: string } | undefined {
  if (style.display === false) return { how: 'vanish', why: 'text:display none' };
  if (style.colour) {
    const background = style.background ?? WHITE;
    const level = contrastLevel(style.colour, background);
    const hex = (rgb: Rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    if (level === 'hidden') return { how: 'invisible', why: `fo:color ${hex(style.colour)} on ${hex(background)}` };
    if (level === 'faint') return { how: 'faint', why: `fo:color ${hex(style.colour)} on ${hex(background)}` };
  }
  if (style.points !== undefined && style.points < TINY_PT) return { how: 'tiny', why: `fo:font-size ${style.points}pt` };
  return undefined;
}

export function hiddenInOdf(parts: Parts): Finding[] {
  const content = parts['content.xml'];
  if (!content || content.length > MAX_XML) return [];
  const stylesXml = parts['styles.xml'] && parts['styles.xml'].length <= MAX_XML ? strFromU8(parts['styles.xml']) : '';
  const xml = strFromU8(content);
  const own = new Map([...odfStyles(stylesXml), ...odfStyles(xml)]);
  const cache = new Map<string, TextStyle>();
  const resolve = (name: string | undefined, depth = 0): TextStyle => {
    if (!name || depth > 16) return {};
    const cached = cache.get(name);
    if (cached) return cached;
    const style = own.get(name);
    const value = style ? merge(resolve(style.parent, depth + 1), style.own) : {};
    cache.set(name, value);
    return value;
  };
  const [width, height] = pageSize(stylesXml);

  // [P0-1] From the first opening to the last closing, as the greedy pattern took it, without retrying from every opening.
  const bodyStart = xml.indexOf('<office:body>');
  const bodyEnd = xml.lastIndexOf('</office:body>');
  const body = bodyStart >= 0 && bodyEnd > bodyStart ? xml.slice(bodyStart + '<office:body>'.length, bodyEnd) : '';
  const found: Hidden[] = [];
  /** Open elements: their style, and frames whose content is off the page. */
  const stack: Array<{ name: string; style: TextStyle; frame?: Frame }> = [{ name: '', style: {} }];
  let run: { how: HiddenHow; why: string; text: string } | undefined;
  const close = () => {
    if (run && run.text.trim()) found.push({ how: run.how, why: run.why, text: run.text.replace(/\s+/g, ' ').trim() });
    run = undefined;
  };
  const emit = (text: string) => {
    const top = stack.at(-1)!;
    const offpage = stack.some((e) => e.frame?.offpage);
    const reason = offpage ? { how: 'offpage' as const, why: 'draw:frame outside the page' } : hiddenHow(top.style);
    if (!reason) {
      if (text.trim()) close();
      return;
    }
    if (run && run.how !== reason.how) close();
    run ??= { ...reason, text: '' };
    run.text += text;
  };

  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w.-]*:[\w.-]+)(?![\w.-])([^<>]*?)(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) {
      emit(decodeXml(m[5]));
      continue;
    }
    const [, closing, name, attrs = '', selfClosing] = m;
    if (closing) {
      if (stack.length > 1 && stack.at(-1)!.name === name) stack.pop();
      if (name === 'text:p' || name === 'text:h') emit(' ');
      continue;
    }
    if (name === 'text:s' || name === 'text:tab' || name === 'text:line-break') {
      emit(' ');
      continue;
    }
    if (name === 'text:hidden-text' || name === 'text:hidden-paragraph') {
      // A field the document shows or not by a condition; is-hidden says it was hidden when saved.
      const value = attr(attrs, 'text:string-value');
      if (attr(attrs, 'text:is-hidden') === 'true' && value) {
        close();
        found.push({ how: 'vanish', why: name, text: decodeXml(value) });
      }
      if (selfClosing) continue;
    }
    const parent = stack.at(-1)!;
    const styleName = attr(attrs, 'text:style-name') ?? attr(attrs, 'draw:text-style-name');
    let style = styleName ? merge(parent.style, resolve(styleName)) : parent.style;
    if (name === 'text:section' && attr(attrs, 'text:display') === 'none') style = merge(style, { display: false });
    let frame: Frame | undefined;
    if (name === 'draw:frame') {
      const x = points(attr(attrs, 'svg:x'));
      const y = points(attr(attrs, 'svg:y'));
      const w = points(attr(attrs, 'svg:width')) ?? 0;
      const h = points(attr(attrs, 'svg:height')) ?? 0;
      const off = (x !== undefined && (x + w <= 0 || x >= width)) || (y !== undefined && (y + h <= 0 || y >= height));
      frame = { offpage: off };
    }
    if (!selfClosing) stack.push({ name: name!, style, frame });
  }
  close();
  return toFindings(found, 'content.xml');
}

/**
 * Text a reader cannot see on a PowerPoint slide.
 *
 * A deck hides text in its own ways: a text box dragged off the edge of the
 * slide, where the editor still shows it and the slideshow never does; a shape
 * marked hidden in the selection pane; type with no fill, or the colour of
 * what is behind it; a run set at one point. A model given the .pptx reads
 * every one of them as part of the slide.
 *
 * Colour is the hard part, because "what is behind it" is whatever is drawn
 * underneath: the shape's own fill, the shapes and pictures under it on the
 * slide, the layout and the master, then the background. A white title over a
 * photograph is the most ordinary slide there is. So the stack is walked, and
 * the moment a picture, a gradient, a table or a theme colour with modifiers is
 * in the way, the background is unknown and the colour is not judged at all.
 */

import type { Finding } from './types.js';
import {
  type Hidden,
  type Rgb,
  MAX_FINDINGS,
  TINY_PT,
  contrastLevel,
  decodeXml,
  hex,
  toFindings,
  inScope,
  type StripScope,
} from './hidden-text.js';

type Parts = Record<string, Uint8Array>;
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A colour, something that is not a flat colour, or nothing drawn at all. */
type Fill = Rgb | 'unknown' | undefined;

interface Theme {
  colours: Map<string, Rgb>;
  clrMap: Map<string, string>;
}

interface Layer {
  box: Box;
  fill: Rgb | 'unknown';
}

/** What sits under a slide: the master's and layout's drawings, their placeholders, the background. */
interface Underlay {
  theme: Theme;
  layers: Layer[];
  placeholders: Map<string, Box>;
  background: Fill;
}

const decoder = new TextDecoder();
const read = (parts: Parts, path: string): string | undefined => (parts[path] ? decoder.decode(parts[path]) : undefined);

/* ---------------------------------------------------------- relations -- */

function related(parts: Parts, path: string, type: string): string | undefined {
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash + 1);
  const rels = read(parts, `${dir}_rels/${path.slice(slash + 1)}.rels`);
  if (!rels) return undefined;
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    if (!new RegExp(`Type="[^"]*/${type}"`).test(tag)) continue;
    const target = /Target="([^"]+)"/.exec(tag)?.[1];
    if (!target) continue;
    const segments = (target.startsWith('/') ? target.slice(1) : dir + target).split('/');
    const out: string[] = [];
    for (const segment of segments) {
      if (segment === '..') out.pop();
      else if (segment !== '.') out.push(segment);
    }
    return out.join('/');
  }
  return undefined;
}

/* ------------------------------------------------------------ colours -- */

const PRESET: Record<string, Rgb> = { white: [255, 255, 255], black: [0, 0, 0] };

function hexColour(value: string | undefined): Rgb | undefined {
  if (!value || !/^[0-9A-Fa-f]{6}$/.test(value)) return undefined;
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

/**
 * The first colour in a fragment. A colour with modifiers — lumMod, tint,
 * shade, alpha — is a different colour from its base, and is left unknown
 * rather than approximated.
 */
function colourIn(fragment: string, theme: Theme): Rgb | 'unknown' | undefined {
  const m = /<a:(srgbClr|sysClr|schemeClr|prstClr)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:\1>)/.exec(fragment);
  if (!m) return undefined;
  if ((m[3] ?? '').trim()) return 'unknown';
  const attrs = m[2] ?? '';
  const val = /\sval="([^"]*)"/.exec(attrs)?.[1];
  switch (m[1]) {
    case 'srgbClr':
      return hexColour(val) ?? 'unknown';
    case 'sysClr':
      return hexColour(/\slastClr="([^"]*)"/.exec(attrs)?.[1]) ?? 'unknown';
    case 'prstClr':
      return (val && PRESET[val]) || 'unknown';
    default: {
      if (!val || val === 'phClr') return 'unknown';
      const slot = theme.clrMap.get(val) ?? val;
      return theme.colours.get(slot) ?? 'unknown';
    }
  }
}

function readTheme(parts: Parts, master: string | undefined): Theme {
  const colours = new Map<string, Rgb>();
  const themePath = master ? related(parts, master, 'theme') : undefined;
  const scheme = /<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec((themePath && read(parts, themePath)) ?? '')?.[1] ?? '';
  for (const m of scheme.matchAll(/<a:(\w+)>([\s\S]*?)<\/a:\1>/g)) {
    const inner = m[2] ?? '';
    const colour = hexColour(/<a:srgbClr val="([^"]+)"/.exec(inner)?.[1] ?? /<a:sysClr\b[^>]*lastClr="([^"]+)"/.exec(inner)?.[1]);
    if (colour) colours.set(m[1]!, colour);
  }
  const clrMap = new Map<string, string>([
    ['bg1', 'lt1'],
    ['tx1', 'dk1'],
    ['bg2', 'lt2'],
    ['tx2', 'dk2'],
  ]);
  const declared = /<p:clrMap\b([^>]*)\/?>/.exec((master && read(parts, master)) ?? '')?.[1] ?? '';
  for (const m of declared.matchAll(/(\w+)="(\w+)"/g)) clrMap.set(m[1]!, m[2]!);
  return { colours, clrMap };
}

/** A shape's own fill from its properties, or from its style when it sets none. */
function fillOf(spPr: string, style: string, theme: Theme): Fill {
  const own = spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>|<a:ln\b[^>]*\/>/g, '').replace(/<a:effectLst\b[\s\S]*?<\/a:effectLst>/g, '');
  const kind = /<a:(solidFill|gradFill|blipFill|pattFill|grpFill|noFill)\b/.exec(own)?.[1];
  if (kind === 'noFill') return undefined;
  if (kind === 'solidFill') return colourIn(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/.exec(own)?.[1] ?? '', theme) ?? 'unknown';
  if (kind) return 'unknown';
  const ref = /<a:fillRef idx="(\d+)"[^>]*>([\s\S]*?)<\/a:fillRef>/.exec(style);
  if (!ref || ref[1] === '0') return undefined;
  // The first fill style of a theme is the flat one; the others are usually gradients.
  return ref[1] === '1' ? (colourIn(ref[2] ?? '', theme) ?? 'unknown') : 'unknown';
}

function backgroundOf(xml: string, theme: Theme): Fill {
  const bg = /<p:bg>([\s\S]*?)<\/p:bg>/.exec(xml)?.[1];
  if (!bg) return undefined;
  const pr = /<p:bgPr\b[^>]*>([\s\S]*?)<\/p:bgPr>/.exec(bg)?.[1];
  if (pr !== undefined) return fillOf(pr, '', theme) ?? 'unknown';
  const ref = /<p:bgRef idx="(\d+)"[^>]*>([\s\S]*?)<\/p:bgRef>/.exec(bg);
  if (ref?.[1] === '1001') return colourIn(ref[2] ?? '', theme) ?? 'unknown';
  return 'unknown';
}

/* ----------------------------------------------------------- geometry -- */

function offsetAndExtent(fragment: string): Box | undefined {
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/.exec(fragment);
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/.exec(fragment);
  if (!off || !ext) return undefined;
  return { x: +off[1]!, y: +off[2]!, w: +ext[1]!, h: +ext[2]! };
}

interface GroupTransform {
  off: Box;
  child: Box;
}

function toSlide(box: Box, groups: GroupTransform[]): Box {
  let b = box;
  for (let i = groups.length - 1; i >= 0; i--) {
    const { off, child } = groups[i]!;
    const sx = child.w ? off.w / child.w : 1;
    const sy = child.h ? off.h / child.h : 1;
    b = { x: off.x + (b.x - child.x) * sx, y: off.y + (b.y - child.y) * sy, w: b.w * sx, h: b.h * sy };
  }
  return b;
}

const contains = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/* -------------------------------------------------------------- trees -- */

interface Shape {
  kind: 'sp' | 'pic' | 'graphicFrame' | 'cxnSp';
  /** Where the element sits in the part. */
  start: number;
  end: number;
  body: string;
  box?: Box;
  hidden: boolean;
  placeholder?: { type: string; idx?: string };
}

/** Every drawn element of a shape tree, in drawing order, groups flattened into slide coordinates. */
function shapes(xml: string): Shape[] {
  const out: Shape[] = [];
  const groups: Array<GroupTransform | undefined> = [];
  const hiddenGroups: boolean[] = [];
  const open: Array<{ kind: Shape['kind']; start: number }> = [];

  for (const m of xml.matchAll(/<(\/?)p:(sp|grpSp|pic|graphicFrame|cxnSp)\b[^>]*?(\/?)>/g)) {
    const [tag, closing, kind, selfClosing] = m;
    const at = m.index!;
    if (kind === 'grpSp') {
      if (closing) {
        groups.pop();
        hiddenGroups.pop();
        continue;
      }
      const head = /<p:grpSpPr\b[^>]*>([\s\S]*?)<\/p:grpSpPr>/.exec(xml.slice(at, at + 4000));
      const off = offsetAndExtent(head?.[1] ?? '');
      const chOff = /<a:chOff x="(-?\d+)" y="(-?\d+)"\s*\/>/.exec(head?.[1] ?? '');
      const chExt = /<a:chExt cx="(\d+)" cy="(\d+)"\s*\/>/.exec(head?.[1] ?? '');
      groups.push(
        off && chOff && chExt ? { off, child: { x: +chOff[1]!, y: +chOff[2]!, w: +chExt[1]!, h: +chExt[2]! } } : undefined,
      );
      const nv = /<p:cNvPr\b[^>]*>/.exec(xml.slice(at, at + 2000))?.[0] ?? '';
      hiddenGroups.push(/\shidden="(?:1|true)"/.test(nv));
      continue;
    }
    if (selfClosing) continue;
    if (!closing) {
      open.push({ kind: kind as Shape['kind'], start: at });
      continue;
    }
    const begun = open.pop();
    if (!begun) continue;
    const end = at + tag!.length;
    const body = xml.slice(begun.start, end);
    const nv = /<p:cNvPr\b[^>]*>/.exec(body)?.[0] ?? '';
    const ph = /<p:ph\b([^>]*)\/?>/.exec(body)?.[1];
    const placement =
      begun.kind === 'graphicFrame'
        ? /<p:xfrm\b[^>]*>([\s\S]*?)<\/p:xfrm>/.exec(body)?.[1]
        : /<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(/<p:spPr\b[^>]*>([\s\S]*?)<\/p:spPr>/.exec(body)?.[1] ?? '')?.[1];
    const local = placement ? offsetAndExtent(placement) : undefined;
    const known = groups.every((g) => g !== undefined);
    out.push({
      kind: begun.kind,
      start: begun.start,
      end,
      body,
      box: local && known ? toSlide(local, groups as GroupTransform[]) : undefined,
      hidden: /\shidden="(?:1|true)"/.test(nv) || hiddenGroups.some(Boolean),
      placeholder:
        ph === undefined
          ? undefined
          : { type: /\stype="(\w+)"/.exec(ph)?.[1] ?? 'body', idx: /\sidx="(\d+)"/.exec(ph)?.[1] },
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

function shapeFill(shape: Shape, theme: Theme): Fill {
  if (shape.kind === 'pic' || shape.kind === 'graphicFrame') return 'unknown';
  if (shape.kind === 'cxnSp') return undefined;
  const spPr = /<p:spPr\b[^>]*>([\s\S]*?)<\/p:spPr>/.exec(shape.body)?.[1] ?? '';
  const style = /<p:style>([\s\S]*?)<\/p:style>/.exec(shape.body)?.[1] ?? '';
  return fillOf(spPr, style, theme);
}

/** The drawings a layout or master puts under every slide, and where its placeholders sit. */
function underlay(parts: Parts, slide: string): Underlay {
  const layout = related(parts, slide, 'slideLayout');
  const master = layout ? related(parts, layout, 'slideMaster') : undefined;
  const theme = readTheme(parts, master);
  const layers: Layer[] = [];
  const placeholders = new Map<string, Box>();
  let background: Fill;

  for (const path of [master, layout]) {
    const xml = path ? read(parts, path) : undefined;
    if (!xml) continue;
    background = backgroundOf(xml, theme) ?? background;
    for (const shape of shapes(xml)) {
      if (!shape.box) continue;
      if (shape.placeholder) {
        // A placeholder on a layout is a position, not a drawing: it is not rendered on the slide.
        placeholders.set(`type:${shape.placeholder.type}`, shape.box);
        if (shape.placeholder.idx !== undefined && path === layout) placeholders.set(`idx:${shape.placeholder.idx}`, shape.box);
        continue;
      }
      const fill = shapeFill(shape, theme);
      if (fill !== undefined) layers.push({ box: shape.box, fill });
    }
  }
  return { theme, layers, placeholders, background };
}

function placeholderBox(placeholder: NonNullable<Shape['placeholder']>, under: Underlay): Box | undefined {
  const type = placeholder.type === 'ctrTitle' ? 'title' : placeholder.type === 'subTitle' ? 'body' : placeholder.type;
  return (
    (placeholder.idx !== undefined ? under.placeholders.get(`idx:${placeholder.idx}`) : undefined) ??
    under.placeholders.get(`type:${placeholder.type}`) ??
    under.placeholders.get(`type:${type}`)
  );
}

/* --------------------------------------------------------------- runs -- */

interface Run {
  text: string;
  start: number;
  end: number;
  rPr: string;
  rPrAttrs: string;
}

function paragraphs(shape: Shape): Run[][] {
  const out: Run[][] = [];
  for (const p of shape.body.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const base = shape.start + p.index! + '<a:p>'.length;
    const runs: Run[] = [];
    for (const r of (p[1] ?? '').matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
      const inner = r[1] ?? '';
      const text = [...inner.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => decodeXml(t[1] ?? '')).join('');
      if (!text) continue;
      const rPr = /<a:rPr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:rPr>)/.exec(inner);
      runs.push({ text, start: base + r.index!, end: base + r.index! + r[0].length, rPrAttrs: rPr?.[1] ?? '', rPr: rPr?.[2] ?? '' });
    }
    if (runs.length) out.push(runs);
  }
  return out;
}

function scanSlide(xml: string, size: Box | undefined, under: Underlay): Hidden[] {
  const found: Hidden[] = [];
  const layers: Layer[] = [...under.layers];

  for (const shape of shapes(xml)) {
    const box = shape.box ?? (shape.placeholder ? placeholderBox(shape.placeholder, under) : undefined);
    const fill = shapeFill(shape, under.theme);
    const all = paragraphs(shape);

    const whole = (how: Hidden['how'], why: string) => {
      const runs = all.flat();
      if (runs.length) found.push({ how, why, text: runs.map((r) => r.text).join(' '), ranges: runs.map((r) => [r.start, r.end]) });
    };

    if (shape.hidden) {
      whole('vanish', 'hidden="1"');
    } else if (box && size && (box.x + box.w <= 0 || box.y + box.h <= 0 || box.x >= size.w || box.y >= size.h)) {
      whole('offpage', 'placed outside the slide');
    } else {
      // What is behind this shape's text: its own fill, else what was drawn before it.
      let behind: Fill = fill;
      if (behind === undefined && shape.kind !== 'graphicFrame') {
        if (box) {
          const cx = box.x + box.w / 2;
          const cy = box.y + box.h / 2;
          // The topmost drawing under the shape's centre; none, and the background shows.
          behind = [...layers].reverse().find((layer) => contains(layer.box, cx, cy))?.fill;
        } else {
          // Nowhere to place it: only an empty slide leaves the background certain.
          behind = layers.length ? 'unknown' : undefined;
        }
        behind ??= under.background ?? [255, 255, 255];
      }

      for (const runs of all) {
        let current: Hidden | undefined;
        for (const run of runs) {
          const hidden = classify(run, shape.kind === 'graphicFrame' ? 'unknown' : behind, under.theme);
          const range: [number, number] = [run.start, run.end];
          if (hidden && current && current.how === hidden.how && current.why === hidden.why) {
            current.text += run.text;
            current.ranges!.push(range);
          } else if (hidden) {
            current = { ...hidden, text: run.text, ranges: [range] };
            found.push(current);
          } else {
            current = undefined;
          }
        }
      }
    }

    if (box && fill !== undefined) layers.push({ box, fill });
  }
  return found;
}

function classify(run: Run, behind: Fill, theme: Theme): Omit<Hidden, 'text'> | undefined {
  const size = /\ssz="(\d+)"/.exec(run.rPrAttrs)?.[1];
  // The outline and the highlight carry fills of their own; the text's is what is left.
  const own = run.rPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>|<a:ln\b[^>]*\/>/g, '');
  const highlight = /<a:highlight>([\s\S]*?)<\/a:highlight>/.exec(own)?.[1];
  const paint = own.replace(/<a:highlight>[\s\S]*?<\/a:highlight>/, '');
  if (/<a:noFill\s*\/>/.test(paint)) return { how: 'invisible', why: 'a:noFill' };
  if (size !== undefined && +size > 0 && +size / 100 < TINY_PT) return { how: 'tiny', why: `sz ${+size / 100} pt` };
  const solid = /<a:solidFill>([\s\S]*?)<\/a:solidFill>/.exec(paint)?.[1];
  const colour = solid ? colourIn(solid, theme) : undefined;
  if (!colour || colour === 'unknown') return undefined;
  const background = highlight ? colourIn(highlight, theme) : behind;
  if (!background || background === 'unknown') return undefined;
  const level = contrastLevel(colour, background);
  if (!level) return undefined;
  return {
    how: level === 'hidden' ? 'invisible' : 'faint',
    why: `colour ${hex(colour).slice(1).toUpperCase()} on ${hex(background).slice(1).toUpperCase()}`,
  };
}

/* ---------------------------------------------------------------- API -- */

function slides(parts: Parts): string[] {
  return Object.keys(parts)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
}

function scan(parts: Parts): Map<string, Hidden[]> {
  const sz = /<p:sldSz\b[^>]*\scx="(\d+)"[^>]*\scy="(\d+)"/.exec(read(parts, 'ppt/presentation.xml') ?? '');
  const size = sz ? { x: 0, y: 0, w: +sz[1]!, h: +sz[2]! } : undefined;
  const out = new Map<string, Hidden[]>();
  for (const path of slides(parts)) {
    const xml = read(parts, path)!;
    const under = underlay(parts, path);
    under.background = backgroundOf(xml, under.theme) ?? under.background;
    const found = scanSlide(xml, size, under);
    if (found.length) out.set(path, found);
  }
  return out;
}

export function hiddenInPptx(parts: Parts): Finding[] {
  const findings: Finding[] = [];
  for (const [path, found] of scan(parts)) {
    findings.push(...toFindings(found, path));
    if (findings.length >= MAX_FINDINGS) break;
  }
  return findings.slice(0, MAX_FINDINGS);
}

/**
 * Take the hidden runs out of a deck, in place: the <a:r> elements only, so
 * every shape, its position and its paragraphs stay where they were.
 */
export function stripHiddenPptx(parts: Parts, scope: StripScope = {}): number {
  let removed = 0;
  for (const [path, found] of scan(parts)) {
    const items = found.filter(inScope(scope));
    if (!items.length) continue;
    const ranges = items.flatMap((item) => item.ranges ?? []).sort((x, y) => y[0] - x[0]);
    let xml = read(parts, path)!;
    for (const [start, end] of ranges) xml = xml.slice(0, start) + xml.slice(end);
    parts[path] = new TextEncoder().encode(xml);
    removed += items.length;
  }
  return removed;
}

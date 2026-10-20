/**
 * [F-2.1] What a page or a mail fetches when it is opened.
 *
 * A picture, a stylesheet, a script or a frame loaded from a server tells
 * that server who opened the document, when, and from which address — a read
 * receipt the reader never agreed to. A one-pixel picture exists for nothing
 * else and is called a tracking pixel. Local and data: resources are not
 * fetched and are not reported.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';

const REMOTE = /^(?:https?:)?\/\//i;
const TAGS = /<(img|script|iframe|frame|link|source|video|audio|embed|object|input|image)\b[^<>]*>/gi;
const CSS_URL = /url\(\s*['"]?((?:https?:)?\/\/(?:(?!url\()[^'")\s])+)['"]?\s*\)/gi;
const MARKDOWN_IMAGE = /!\[([^[\]\n]{0,300})\]\(\s*<?((?:https?:)?\/\/(?:(?!\]\()[^)\s>])+)>?(?:\s+"[^"\n]*")?\s*\)/g;
const MAX = 50;

interface Resource {
  kind: string;
  url: string;
  pixel: boolean;
  /** What to cut, and what to put in its place, when it is removed. */
  start: number;
  end: number;
  replacement: string;
}

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined);

function tiny(tag: string): boolean {
  const size = (name: string) => {
    const value = attribute(tag, name) ?? new RegExp(`${name}\\s*:\\s*(\\d+)px`, 'i').exec(attribute(tag, 'style') ?? '')?.[1];
    return value !== undefined && Number.parseFloat(value) <= 1;
  };
  return size('width') && size('height');
}

function resources(text: string, markdown: boolean): Resource[] {
  const out: Resource[] = [];
  const lower = text.toLowerCase();
  for (const m of text.matchAll(TAGS)) {
    if (out.length >= MAX) break;
    const tag = m[0];
    const name = m[1]!.toLowerCase();
    if (name === 'link' && !/stylesheet|icon|preload|prefetch/i.test(attribute(tag, 'rel') ?? '')) continue;
    if (name === 'input' && (attribute(tag, 'type') ?? '').toLowerCase() !== 'image') continue;
    const url = [attribute(tag, name === 'link' ? 'href' : 'src'), attribute(tag, 'data'), attribute(tag, 'poster'), attribute(tag, 'background'), attribute(tag, 'xlink:href'), attribute(tag, 'href')]
      .find((v) => v !== undefined && REMOTE.test(v.trim()));
    if (!url) continue;
    let end = m.index! + tag.length;
    // An element with content is removed up to its closing tag.
    if (['script', 'iframe', 'object', 'video', 'audio'].includes(name)) {
      const close = lower.indexOf(`</${name}`, end);
      if (close >= 0) end = lower.indexOf('>', close) + 1 || end;
    }
    out.push({ kind: name, url: url.trim(), pixel: name === 'img' && tiny(tag), start: m.index!, end, replacement: '' });
  }
  for (const m of text.matchAll(CSS_URL)) {
    if (out.length >= MAX) break;
    out.push({ kind: 'css', url: m[1]!, pixel: false, start: m.index!, end: m.index! + m[0].length, replacement: 'none' });
  }
  if (markdown) {
    for (const m of text.matchAll(MARKDOWN_IMAGE)) {
      if (out.length >= MAX) break;
      out.push({ kind: 'img', url: m[2]!, pixel: false, start: m.index!, end: m.index! + m[0].length, replacement: m[1]! });
    }
  }
  return out;
}

export function remoteFindings(text: string, location: string, markdown = false): Finding[] {
  if (!/\/\//.test(text)) return [];
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const resource of resources(text, markdown)) {
    const key = `${resource.kind}\u0000${resource.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(
      resource.pixel
        ? { kind: 'active-content', confidence: 'confirmed', location, label: 'Tracking pixel', value: preview(resource.url, 300) }
        : { kind: 'active-content', confidence: 'probable', location, label: 'Remote resource loaded on opening', value: preview(`${resource.kind}: ${resource.url}`, 300) },
    );
  }
  return findings;
}

/** The text with every remote resource taken out: elements removed, CSS urls set to none, Markdown images left as their alt text. */
export function stripRemoteResources(text: string, markdown = false): { text: string; removed: number } {
  const found = resources(text, markdown).sort((a, b) => b.start - a.start);
  let out = text;
  let last = Number.POSITIVE_INFINITY;
  let removed = 0;
  for (const resource of found) {
    if (resource.end > last) continue; // nested in one already removed
    out = out.slice(0, resource.start) + resource.replacement + out.slice(resource.end);
    last = resource.start;
    removed++;
  }
  return { text: out, removed };
}

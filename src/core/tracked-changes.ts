/**
 * Tracked changes in a Word document.
 *
 * [C5] A deletion made with "Track changes" on is not a deletion: the text
 * stays in the file inside <w:del>, as <w:delText>, with the reviser's name
 * and the minute they made it. Word shows it struck through, or not at all in
 * "Simple markup"; the file carries it either way, to anyone who opens the XML
 * or hands the document to a model. The deleted text is the finding.
 *
 * Accepting the changes is how it goes: deletions and moved-from text are
 * removed, insertions and moved-to text become ordinary runs, the record of
 * formatting changes is dropped. It changes what the document contains, so it
 * is never done unasked.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';

const MAX_PER_KIND = 20;

const BODY_PARTS = /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;

export interface Element {
  start: number;
  end: number;
  /** The content between the tags; empty for a self-closing element. */
  inner: string;
  /** The opening tag, for its attributes. */
  open: string;
}

/** Whether the character after a tag name ends the name: `<w:del>` and `<w:del ` but not `<w:delText`. */
const ends = (code: number) => code === 0x3e || code === 0x2f || code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;

/**
 * Every element called `name`, outermost first, nesting of the same name
 * respected. indexOf all the way: the parts can be megabytes, and a regex
 * that looks for a closing tag rescans from every unclosed opening.
 */
export function elements(xml: string, name: string): Element[] {
  const out: Element[] = [];
  const opener = `<${name}`;
  const closer = `</${name}>`;
  let at = xml.indexOf(opener);
  while (at >= 0) {
    if (!ends(xml.charCodeAt(at + opener.length))) {
      at = xml.indexOf(opener, at + 1);
      continue;
    }
    const tagEnd = xml.indexOf('>', at);
    if (tagEnd < 0) break;
    const open = xml.slice(at, tagEnd + 1);
    if (open.endsWith('/>')) {
      out.push({ start: at, end: tagEnd + 1, inner: '', open });
      at = xml.indexOf(opener, tagEnd);
      continue;
    }
    // Find the matching close, counting nested openings of the same name.
    let depth = 1;
    let cursor = tagEnd + 1;
    let close = -1;
    // [P0-1] The next closing tag is looked up again only once passed: a
    // thousand nested openings before one close each rescanned to it.
    let nextClose = -1;
    while (depth > 0) {
      if (nextClose < cursor) nextClose = xml.indexOf(closer, cursor);
      if (nextClose < 0) break;
      let nextOpen = xml.indexOf(opener, cursor);
      while (nextOpen >= 0 && nextOpen < nextClose && !ends(xml.charCodeAt(nextOpen + opener.length))) {
        nextOpen = xml.indexOf(opener, nextOpen + 1);
      }
      if (nextOpen >= 0 && nextOpen < nextClose) {
        const nestedEnd = xml.indexOf('>', nextOpen);
        if (nestedEnd >= 0 && xml[nestedEnd - 1] !== '/') depth++;
        cursor = (nestedEnd < 0 ? nextOpen : nestedEnd) + 1;
      } else {
        depth--;
        cursor = nextClose + closer.length;
        if (depth === 0) close = nextClose;
      }
    }
    if (close < 0) break;
    out.push({ start: at, end: close + closer.length, inner: xml.slice(tagEnd + 1, close), open });
    at = xml.indexOf(opener, close + closer.length);
  }
  return out;
}

const decode = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** The text a run sequence carries, deleted or not. */
function runText(inner: string): string {
  return [...inner.matchAll(/<w:(?:t|delText)(?:\s[^>]*)?>([^<]*)<\/w:(?:t|delText)>/g)].map((m) => decode(m[1] ?? '')).join('');
}

const KINDS = [
  { element: 'w:del', label: 'Deleted text still in the file (tracked changes)', confidence: 'confirmed' as const },
  { element: 'w:moveFrom', label: 'Moved text still at its old place (tracked changes)', confidence: 'confirmed' as const },
  // Inserted text is on the page; what the file adds is that it was inserted,
  // by whom and when, and that the original is what the deletion beside it holds.
  { element: 'w:ins', label: 'Inserted text not yet accepted (tracked changes)', confidence: 'probable' as const },
];

/** The labels a tracked change is reported under, for interfaces that offer to accept them. */
export const TRACKED_LABELS: ReadonlySet<string> = new Set(KINDS.map((kind) => kind.label));

export function trackedChangeFindings(parts: Record<string, Uint8Array>): Finding[] {
  const findings: Finding[] = [];
  const decoder = new TextDecoder();
  for (const path of Object.keys(parts).filter((p) => BODY_PARTS.test(p)).sort()) {
    const xml = decoder.decode(parts[path]);
    if (!/<w:(?:del|ins|moveFrom)[\s>]/.test(xml)) continue;
    for (const kind of KINDS) {
      const seen = new Set<string>();
      for (const element of elements(xml, kind.element)) {
        const text = runText(element.inner).replace(/\s+/g, ' ').trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        findings.push({ kind: 'identity', confidence: kind.confidence, location: path, label: kind.label, value: preview(text, 160) });
        if (seen.size >= MAX_PER_KIND) break;
      }
    }
  }
  return findings;
}

function cut(xml: string, ranges: Array<{ start: number; end: number }>, replace: (index: number) => string = () => ''): string {
  let out = '';
  let last = 0;
  ranges
    .slice()
    .sort((a, b) => a.start - b.start)
    .forEach((range, index) => {
      if (range.start < last) return; // nested inside one already cut
      out += xml.slice(last, range.start) + replace(index);
      last = range.end;
    });
  return out + xml.slice(last);
}

/** Elements that record a change of properties; accepting keeps the new ones and drops the record. */
const PROPERTY_CHANGES = ['rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'tblPrExChange', 'trPrChange', 'tcPrChange', 'tblGridChange', 'numberingChange'];
/** Markers with no content of their own. */
const MARKERS = /<w:(?:moveFromRangeStart|moveFromRangeEnd|moveToRangeStart|moveToRangeEnd|cellIns|cellDel|cellMerge)\b[^<>]*\/>/g;

/**
 * Accept every tracked change in one part. Returns the new XML and how many
 * revisions were accepted.
 */
export function acceptChanges(xml: string): { xml: string; accepted: number } {
  let accepted = 0;
  let out = xml;

  // What a deletion or a move away leaves behind goes, content and all.
  for (const name of ['w:del', 'w:moveFrom', ...PROPERTY_CHANGES.map((n) => `w:${n}`)]) {
    const found = elements(out, name);
    accepted += found.length;
    out = cut(out, found);
  }
  out = out.replace(MARKERS, '');

  // What an insertion or a move to brought in stays, as ordinary runs.
  for (const name of ['w:ins', 'w:moveTo']) {
    const found = elements(out, name);
    accepted += found.length;
    out = cut(out, found, (index) => found.slice().sort((a, b) => a.start - b.start)[index]!.inner);
  }
  return { xml: out, accepted };
}

export function acceptChangesInParts(parts: Record<string, Uint8Array>): number {
  let accepted = 0;
  for (const path of Object.keys(parts).filter((p) => BODY_PARTS.test(p))) {
    const xml = new TextDecoder().decode(parts[path]);
    if (!/<w:(?:del|ins|moveFrom|moveTo|\w+PrChange|tblGridChange|numberingChange)[\s>/]/.test(xml)) continue;
    const result = acceptChanges(xml);
    if (result.accepted) {
      parts[path] = new TextEncoder().encode(result.xml);
      accepted += result.accepted;
    }
  }
  return accepted;
}

/**
 * What the clipboard hands over alongside the text.
 *
 * Copying from a web page — a chat interface, a document editor — puts two
 * things on the clipboard: the text, and an HTML version of it. A plain text
 * field takes the text and drops the rest. A rich mail editor takes the HTML,
 * and keeps whatever of it it does not sanitise away: fonts, colours, inline
 * styles, sometimes the class names and data attributes the source page used
 * to lay out its own interface. Those are the page's fingerprints, carried into
 * an email by a paste.
 *
 * What this module does not do is name the application. It cannot know which
 * page the HTML came from unless the HTML says so, and guessing from a class
 * name would be exactly the kind of claim this tool refuses to make. It lists
 * what is there, and the person who pasted it can recognise it.
 *
 * It reads a string, with patterns that stay inside one attribute and have no
 * nested quantifier: clipboard HTML can be a whole copied page, and a pattern
 * that backtracks would freeze the tab on paste.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';

/** Clipboard HTML past this is a copied page, not a passage; the head is enough. */
const MAX_HTML = 2 * 1024 * 1024;
const LISTED = 6;
const LOCATION = 'clipboard (HTML)';

function distinct(values: Iterable<string>): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const clean = value.trim();
    if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
  }
  return [...seen.values()];
}

function listed(values: string[]): string {
  const head = values.slice(0, LISTED).join(', ');
  return values.length > LISTED ? `${head}, …` : head;
}

/** The handful of entities a serialised style attribute actually uses. */
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&amp;/gi, '&');
}

export function inspectClipboardHtml(input: string): Finding[] {
  const html = input.length > MAX_HTML ? input.slice(0, MAX_HTML) : input;
  if (!html.trim()) return [];
  const findings: Finding[] = [];

  /*
   * The Windows clipboard wraps HTML in a header that can record the address
   * of the page it was copied from. Browsers usually strip it before a page
   * sees the data, but not every browser on every system does, and when it is
   * there it is the plainest statement of origin the clipboard can make.
   */
  const source = /^SourceURL:(\S{1,2048})/m.exec(html)?.[1];
  if (source) {
    findings.push({
      kind: 'provenance',
      confidence: 'confirmed',
      location: LOCATION,
      label: 'Address of the page the text was copied from',
      value: preview(source, 120),
    });
  }

  const generator =
    /<meta\b[^>]{0,300}\bname\s*=\s*["']?generator["']?[^>]{0,300}\bcontent\s*=\s*["']([^"']{1,200})["']/i.exec(html)?.[1] ??
    /<meta\b[^>]{0,300}\bcontent\s*=\s*["']([^"']{1,200})["'][^>]{0,300}\bname\s*=\s*["']?generator\b/i.exec(html)?.[1];
  if (generator) {
    findings.push({
      kind: 'provenance',
      confidence: 'confirmed',
      location: LOCATION,
      label: 'Software named in the copied HTML',
      value: preview(generator, 120),
    });
  }

  const classes = distinct(
    [...html.matchAll(/\bclass\s*=\s*(?:"([^"]{0,2000})"|'([^']{0,2000})')/gi)].flatMap((m) =>
      (m[1] ?? m[2] ?? '').split(/\s+/),
    ),
  );
  if (classes.length) {
    findings.push({
      kind: 'provenance',
      confidence: 'probable',
      location: LOCATION,
      label: 'Class names carried by the copied text',
      value: `${classes.length} — ${listed(classes)}`,
    });
  }

  const data = distinct(
    [...html.matchAll(/\sdata-([a-z0-9][a-z0-9_-]{0,60})\s*=/gi)].map((m) => `data-${m[1]}`),
  );
  if (data.length) {
    findings.push({
      kind: 'provenance',
      confidence: 'probable',
      location: LOCATION,
      label: 'Page attributes carried by the copied text',
      value: listed(data),
    });
  }

  /*
   * Read the style attribute first, then the declaration inside it. A browser
   * writes the quotes around a font name as `&quot;` when the attribute itself
   * is double-quoted — the common case — and the semicolon that ends that
   * entity also ends a CSS declaration. Matching `font-family` straight in the
   * raw HTML stopped there, and reported the font as "&quot".
   */
  const styleValues = [...html.matchAll(/\bstyle\s*=\s*(?:"([^"]{0,4000})"|'([^']{0,4000})')/gi)].map(
    (m) => decodeEntities(m[1] ?? m[2] ?? ''),
  );
  const fonts = distinct(
    styleValues.flatMap((style) =>
      [...style.matchAll(/font-family\s*:\s*([^;}]{1,200})/gi)].map((m) =>
        (m[1] ?? '').replace(/["']/g, '').replace(/\s+/g, ' '),
      ),
    ),
  );
  if (fonts.length) {
    findings.push({
      kind: 'provenance',
      confidence: 'probable',
      location: LOCATION,
      label: 'Fonts carried by the copied text',
      value: fonts.slice(0, 3).map((font) => preview(font, 60)).join(' · '),
    });
  }

  const styles = (html.match(/\bstyle\s*=\s*["']/gi) ?? []).length;
  if (styles) {
    findings.push({
      kind: 'provenance',
      confidence: 'informational',
      location: LOCATION,
      label: 'Inline styles carried by the copied text',
      value: String(styles),
    });
  }

  return findings;
}

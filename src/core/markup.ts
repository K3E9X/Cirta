/**
 * Metadata in text-based formats: SVG, HTML and Markdown front matter.
 *
 * These carry provenance in plain sight rather than in a binary container.
 * An SVG exported from a design tool keeps an RDF block and the editor's own
 * namespaced attributes; an HTML page keeps a generator tag; a Markdown file
 * keeps whatever the generating pipeline wrote into its front matter. All three
 * are structured, so removal is verifiable in the same way a ZIP part is.
 *
 * Some of what lives here is not metadata at all. An SVG <title> is what a
 * screen reader announces, and JSON-LD is what a search engine indexes.
 * Those are reported and deliberately left in place.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';
import { fingerprint, BODY_TEXT } from './fingerprint.js';
import { scanContent } from './archive.js';
import { scanText, cleanText, isArrangementFinding } from './text.js';
import { collectTextContent, mapTextContent } from './xml.js';
import { describeC2pa } from './c2pa.js';
import { findSourceTypes } from './sourcetype.js';
import { byConfidence } from './types.js';
import { hiddenInHtml, stripHiddenHtml } from './hidden-text.js';
import { remoteFindings } from './beacons.js';
import { trackingFindings } from './tracking.js';
import { activeMarkupFindings } from './markup-active.js';
import { htmlLinkTargets, linkFindings, markdownLinkTargets } from './links.js';
import { findHtmlLinks } from './url.js';
import { replaceSpans, spans } from './linear.js';

export type MarkupFormat = 'svg' | 'html' | 'markdown';

/** HTML and SVG comments: [P0-1] found with indexOf, as a lazy pattern rescanned from every unclosed one. */
const comments = (text: string) => spans(text, '<!--', '-->').map(([start, end]) => ({ index: start, 0: text.slice(start, end), 1: text.slice(start + 4, end - 3) }));
const dropGeneratorComments = (text: string) => replaceSpans(text, '<!--', '-->', (full) => (GENERATOR_HINT.test(full.slice(4, -3)) ? '' : full));

/** Producer strings frequently written into comments and generator tags. */
const GENERATOR_HINT = /generator|generated|created\s+(?:with|by)|exported|produced\s+by/i;

/* ------------------------------------------------------------------- SVG -- */

/** Namespaces an editor injects, which name the software and sometimes the file. */
const EDITOR_NAMESPACES = ['inkscape', 'sodipodi', 'krita', 'serif', 'figma', 'sketch'];

function inspectSvg(text: string): Finding[] {
  const findings: Finding[] = [];

  const metadata = /<metadata[^<>]*>((?:(?!<metadata)[\s\S])*?)<\/metadata>/i.exec(text);
  if (metadata) {
    const inner = metadata[1] ?? '';
    if (/c2pa|contentcredentials/i.test(inner)) {
      // Same treatment a manifest gets in any other container, including the
      // tool it credits and the reminder that its signature is unchecked.
      findings.push(...describeC2pa(inner, '<metadata>'));
    } else {
      findings.push({
        kind: 'provenance',
        confidence: 'confirmed',
        location: '<metadata>',
        label: 'SVG metadata block',
        value: `RDF/Dublin Core block, ${inner.trim().length} characters`,
      });
    }
  }

  for (const namespace of EDITOR_NAMESPACES) {
    if (new RegExp(`xmlns:${namespace}=|\\s${namespace}:[a-z-]+=`, 'i').test(text)) {
      findings.push({
        kind: 'provenance',
        confidence: 'confirmed',
        location: `${namespace}: attributes`,
        label: 'Editor namespace',
        value: namespace,
      });
    }
  }

  // Illustrator and similar write "Generator: ..." into a leading comment.
  for (const match of comments(text)) {
    const body = (match[1] ?? '').trim();
    if (body && GENERATOR_HINT.test(body)) {
      findings.push({
        kind: 'provenance',
        confidence: 'confirmed',
        location: 'comment',
        label: 'Generator comment',
        value: body,
      });
    }
  }

  for (const tag of ['title', 'desc'] as const) {
    const match = new RegExp(`<${tag}[^<>]*>((?:(?!<${tag})[\\s\\S])*?)</${tag}>`, 'i').exec(text);
    const value = match?.[1]?.trim();
    if (value) {
      findings.push({
        kind: 'identity',
        confidence: 'probable',
        location: `<${tag}>`,
        label: tag === 'title' ? 'SVG title (accessibility)' : 'SVG description (accessibility)',
        value,
      });
    }
  }

  return findings;
}

function redactSvg(text: string): string {
  let out = text.replace(/<metadata[^<>]*>(?:(?!<metadata)[\s\S])*?<\/metadata>/gi, '');
  out = dropGeneratorComments(out);
  for (const namespace of EDITOR_NAMESPACES) {
    out = out.replace(new RegExp(`\\sxmlns:${namespace}="[^"]*"`, 'gi'), '');
    out = out.replace(new RegExp(`\\s${namespace}:[a-z-]+="[^"]*"`, 'gi'), '');
    out = out.replace(new RegExp(`<${namespace}:[^<>]*/>`, 'gi'), '');
    // [P0-1] Innermost first, again until none is left: a body that stops at the namespace's next tag cannot rescan to the end.
    const element = new RegExp(`<${namespace}:([a-z-]+)(?![a-z-])[^<>]*>(?:(?!</?${namespace}:)[\\s\\S])*?</${namespace}:\\1>`, 'gi');
    for (let pass = 0, before = ''; pass < 16 && before !== out; pass++) {
      before = out;
      out = out.replace(element, '');
    }
  }
  // <title> and <desc> stay: they are what a screen reader reads out.
  return out;
}

/* ------------------------------------------------------------------ HTML -- */

const HTML_META: Array<{ name: string; label: string; kind: Finding['kind']; confidence: Finding['confidence'] }> = [
  { name: 'generator', label: 'Generator meta tag', kind: 'provenance', confidence: 'confirmed' },
  { name: 'author', label: 'Author meta tag', kind: 'identity', confidence: 'confirmed' },
  { name: 'creator', label: 'Creator meta tag', kind: 'identity', confidence: 'confirmed' },
  { name: 'copyright', label: 'Copyright meta tag', kind: 'identity', confidence: 'probable' },
  { name: 'date', label: 'Date meta tag', kind: 'timestamp', confidence: 'probable' },
];

function metaContent(text: string, name: string): string | undefined {
  // Attribute order varies, so match name= and content= independently.
  const tags = text.matchAll(/<meta\s([^<>]*)>/gi);
  for (const tag of tags) {
    const attributes = tag[1] ?? '';
    const nameMatch = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(attributes);
    if (nameMatch?.[1]?.toLowerCase() !== name) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(attributes);
    if (content?.[1]) return content[1];
  }
  return undefined;
}

function inspectHtml(text: string): Finding[] {
  const findings: Finding[] = [];

  for (const meta of HTML_META) {
    const value = metaContent(text, meta.name);
    if (value) {
      findings.push({
        kind: meta.kind,
        confidence: meta.confidence,
        location: `<meta name="${meta.name}">`,
        label: meta.label,
        value,
      });
    }
  }

  for (const match of comments(text)) {
    const body = (match[1] ?? '').trim();
    if (body && GENERATOR_HINT.test(body)) {
      findings.push({
        kind: 'provenance',
        confidence: 'confirmed',
        location: 'comment',
        label: 'Generator comment',
        value: body,
      });
    }
  }

  // `data-ai-*` attributes are how a generator marks up individual elements it
  // produced. They are invisible to a reader, carry no styling or behaviour, and
  // survive every copy-paste of the markup.
  const dataAi = [...text.matchAll(/\sdata-ai[\w-]*\s*=\s*["'][^"']*["']/gi)].map((m) => m[0].trim());
  if (dataAi.length) {
    findings.push({
      kind: 'provenance',
      confidence: 'confirmed',
      location: 'data-ai* attributes',
      label: 'AI provenance data attributes',
      value: `${dataAi.length} attribute${dataAi.length > 1 ? 's' : ''} — ${preview(dataAi.join(' '), 80)}`,
    });
  }

  // JSON-LD is indexed by search engines; it is content, so it is reported only.
  // [P0-1] Each script, then its type: the type inside the tag pattern backtracked across a long tag.
  const jsonLd = [...text.matchAll(/<script\b([^<>]*)>((?:(?!<script\b)[\s\S])*?)<\/script>/gi)].map((m) => [m[1], m[2]] as const).find(([attrs]) => /type\s*=\s*["']application\/ld\+json["']/i.test(attrs!)) ?? null;
  if (jsonLd?.[1]?.trim()) {
    findings.push({
      kind: 'identity',
      confidence: 'probable',
      location: '<script type="application/ld+json">',
      label: 'JSON-LD structured data',
      value: `${jsonLd[1].trim().length} characters, may name an author or publisher`,
    });
  }

  return findings;
}

function redactHtml(text: string): string {
  let out = text;
  for (const meta of HTML_META) {
    out = out.replace(/<meta\s([^<>]*)>\s*/gi, (full, attributes: string) => {
      const nameMatch = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(attributes);
      return nameMatch?.[1]?.toLowerCase() === meta.name ? '' : full;
    });
  }
  out = dropGeneratorComments(out);
  // Unlike JSON-LD, a data-ai-* attribute changes nothing a reader or a search
  // engine sees, so there is nothing to weigh against removing it.
  out = out.replace(/\sdata-ai[\w-]*\s*=\s*["'][^"']*["']/gi, '');
  // JSON-LD stays: removing it changes how the page is indexed.
  return out;
}

/* -------------------------------------------------------------- Markdown -- */

/** Front-matter keys that name a person, a tool or a generation run. */
const FRONT_MATTER_KEYS = new Map<string, { label: string; kind: Finding['kind']; confidence: Finding['confidence'] }>(
  [
    ['author', { label: 'Author', kind: 'identity', confidence: 'confirmed' }],
    ['authors', { label: 'Authors', kind: 'identity', confidence: 'confirmed' }],
    ['creator', { label: 'Creator', kind: 'identity', confidence: 'confirmed' }],
    ['generator', { label: 'Generator', kind: 'provenance', confidence: 'confirmed' }],
    ['generated_by', { label: 'Generated by', kind: 'provenance', confidence: 'confirmed' }],
    ['created_with', { label: 'Created with', kind: 'provenance', confidence: 'confirmed' }],
    ['ai_generated', { label: 'AI-generated flag', kind: 'provenance', confidence: 'confirmed' }],
    ['ai', { label: 'AI flag', kind: 'provenance', confidence: 'confirmed' }],
    ['model', { label: 'Model', kind: 'provenance', confidence: 'confirmed' }],
    ['tool', { label: 'Tool', kind: 'provenance', confidence: 'confirmed' }],
    ['session', { label: 'Session', kind: 'environment', confidence: 'confirmed' }],
    ['source_path', { label: 'Source path', kind: 'environment', confidence: 'confirmed' }],
    ['date', { label: 'Date', kind: 'timestamp', confidence: 'probable' }],
    ['created', { label: 'Created', kind: 'timestamp', confidence: 'probable' }],
    ['modified', { label: 'Modified', kind: 'timestamp', confidence: 'probable' }],
  ],
);

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

/**
 * Generated Markdown often carries its provenance outside the front matter:
 * an HTML comment left by the pipeline, or a signature line at the end of the
 * document. Both are matched on an explicit generation phrase rather than on a
 * vendor name, so prose that merely mentions a model is not flagged.
 */
const MARKDOWN_ATTRIBUTION =
  /^[*_>\s-]*(?:g[ée]n[ée]r[ée]e?\s+(?:par|avec)|generated\s+(?:by|with)|created\s+(?:by|with)|written\s+by|produit\s+par|r[ée]dig[ée]\s+par)\b.{0,120}$/i;

function inspectMarkdown(text: string): Finding[] {
  const findings: Finding[] = [];

  for (const match of comments(text)) {
    const body = (match[1] ?? '').trim();
    if (body && GENERATOR_HINT.test(body)) {
      findings.push({
        kind: 'provenance',
        confidence: 'confirmed',
        location: 'HTML comment',
        label: 'Generator comment',
        value: body,
      });
    }
  }

  // Signature lines cluster at the end, so only the tail is examined.
  const lines = text.split(/\r?\n/);
  for (const [offset, line] of lines.slice(-8).entries()) {
    if (!line.trim() || !MARKDOWN_ATTRIBUTION.test(line)) continue;
    findings.push({
      kind: 'provenance',
      confidence: 'confirmed',
      location: `line ${lines.length - Math.min(8, lines.length) + offset + 1}`,
      label: 'Attribution line',
      value: line.trim(),
    });
  }

  const block = FRONT_MATTER.exec(text);
  if (!block) return findings;

  for (const line of (block[1] ?? '').split(/\r?\n/)) {
    const entry = /^([A-Za-z_][\w-]*)\s*:\s*(?!\s)(.*)$/.exec(line);
    if (!entry) continue;
    const key = entry[1]!.toLowerCase();
    const described = FRONT_MATTER_KEYS.get(key);
    if (!described || !entry[2]?.trim()) continue;
    findings.push({
      kind: described.kind,
      confidence: described.confidence,
      location: `front matter: ${entry[1]}`,
      label: described.label,
      value: entry[2].trim(),
    });
  }
  return findings;
}

function redactMarkdown(text: string): string {
  const block = FRONT_MATTER.exec(text);
  if (!block) return text;

  const kept = (block[1] ?? '').split(/\r?\n/).filter((line) => {
    const entry = /^([A-Za-z_][\w-]*)\s*:/.exec(line);
    return !entry || !FRONT_MATTER_KEYS.has(entry[1]!.toLowerCase());
  });

  const body = text.slice(block[0].length);
  // Drop the delimiters entirely when nothing meaningful is left inside them.
  if (kept.every((line) => line.trim() === '')) return body;
  return `---\n${kept.join('\n')}\n---\n${body}`;
}

/* ------------------------------------------------------------------ body -- */

/**
 * Invisible characters carried by what a reader actually sees.
 *
 * For Markdown that is the whole file; for HTML and SVG it is the text between
 * tags, never the markup itself. Exotic whitespace is reported but not removed
 * here: a no-break space before a colon is French typography, and a formatted
 * document is exactly where that distinction matters.
 */
/** The words a reader sees in a piece of markup. */
export function markupText(text: string, format: MarkupFormat): string {
  return bodyText(text, format);
}

function bodyText(text: string, format: MarkupFormat): string {
  return format === 'markdown' ? text : collectTextContent(text);
}

function inspectBodyText(text: string, format: MarkupFormat): Finding[] {
  const scan = scanText(bodyText(text, format));
  const findings: Finding[] = scan.findings
    // A Markdown file *is* the text, so its line layout is the author's. In
    // HTML and SVG the lines belong to the markup.
    .filter((finding) => format === 'markdown' || !isArrangementFinding(finding))
    .map((finding) => ({
      ...finding,
      location: `document body (${finding.location})`,
    }));
  for (const payload of scan.decoded) {
    findings.push({
      kind: 'invisible-character',
      confidence: 'confirmed',
      location: 'document body',
      label: 'Hidden payload in document text',
      value: payload,
    });
  }
  return findings;
}

/** Strip invisible characters from the readable text, leaving markup alone. */
function cleanBodyText(text: string, format: MarkupFormat): string {
  const strip = (value: string) => cleanText(value, { normalizeSpaces: false }).text;
  return format === 'markdown' ? strip(text) : mapTextContent(text, strip);
}

/* ---------------------------------------------------------------- public -- */

/** Identify a markup format from its content, since extensions are unreliable. */
export function detectMarkupFormat(text: string, hint?: string): MarkupFormat | undefined {
  const head = text.slice(0, 4096);
  if (/<svg[\s>]/i.test(head)) return 'svg';
  if (/<!doctype\s+html|<html[\s>]|<head[\s>]/i.test(head)) return 'html';
  if (FRONT_MATTER.test(text)) return 'markdown';
  if (hint === 'markdown' || hint === 'svg' || hint === 'html') return hint;
  return undefined;
}

/** The text-and-target mismatches only: the lookalike-domain pass already runs on the whole text. */
const linksShown = (findings: Finding[]) => findings.filter((f) => f.label === 'Link text shows a different address');

export function inspectMarkup(text: string, format: MarkupFormat): Finding[] {
  const findings =
    format === 'svg' ? inspectSvg(text) : format === 'html' ? inspectHtml(text) : inspectMarkdown(text);
  findings.push(...findSourceTypes(text, 'metadata'));
  findings.push(...scanContent(text, 'document body'));
  findings.push(...inspectBodyText(text, format));
  // Markdown carries inline HTML through to the page it renders as.
  if (format !== 'svg') findings.push(...hiddenInHtml(text, 'document body'));
  // [F-2.1] What opening the page fetches from elsewhere.
  if (format !== 'svg') findings.push(...remoteFindings(text, 'document body', format === 'markdown'));
  // [R3] Scripts, event handlers, addresses that run, refreshes and plug-in objects.
  findings.push(...activeMarkupFindings(text, format === 'svg'));
  findings.push(...trackingFindings(text, 'links'));
  // [F-P2 2.1] Links that run, carry a page, or bounce through a redirector;
  // and link text that shows one address on a link to another.
  if (format === 'html') findings.push(...linkFindings(htmlLinkTargets(text), 'links'), ...linksShown(findHtmlLinks(text)));
  if (format === 'markdown') {
    const links = markdownLinkTargets(text);
    findings.push(...linkFindings([...links.map((l) => l.target), ...htmlLinkTargets(text)], 'links'));
    const anchors = links.map((l) => `<a href="${l.target.replace(/"/g, '&quot;')}">${l.text}</a>`).join('\n');
    findings.push(...linksShown(findHtmlLinks(anchors)));
  }
  // The body goes to fingerprint() as a source, so a local path or a session
  // identifier sitting in a trailing "generated from …" line is found. Without
  // it a Markdown draft was quieter than the same bytes saved as .txt, which is
  // the same asymmetry, only pointing the other way. BODY_TEXT suppresses tool
  // matching: a page *about* an assistant was not written *by* one.
  const body: Finding = {
    kind: 'provenance',
    confidence: 'informational',
    location: 'document body',
    label: BODY_TEXT,
    value: bodyText(text, format),
  };
  findings.push(...fingerprint([...findings, body]));
  return findings.sort(byConfidence);
}

export function redactMarkup(text: string, format: MarkupFormat, options: { removeHidden?: boolean } = {}): string {
  return redactMarkupCounted(text, format, options).text;
}

/** The cleaned markup, and how many hidden passages were taken out on request. */
export function redactMarkupCounted(
  text: string,
  format: MarkupFormat,
  { removeHidden = false }: { removeHidden?: boolean } = {},
): { text: string; hiddenRemoved: number } {
  const hidden = removeHidden && format !== 'svg' ? stripHiddenHtml(text) : { html: text, removed: 0 };
  const source = hidden.html;
  const stripped =
    format === 'svg' ? redactSvg(source) : format === 'html' ? redactHtml(source) : redactMarkdown(source);
  return { text: cleanBodyText(stripped, format), hiddenRemoved: hidden.removed };
}

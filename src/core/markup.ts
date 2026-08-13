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
import { fingerprint } from './fingerprint.js';
import { scanContent } from './archive.js';
import { scanText, cleanText } from './text.js';
import { collectTextContent, mapTextContent } from './xml.js';
import { byConfidence } from './types.js';

export type MarkupFormat = 'svg' | 'html' | 'markdown';

const COMMENT = /<!--([\s\S]*?)-->/g;

/** Producer strings frequently written into comments and generator tags. */
const GENERATOR_HINT = /generator|generated|created\s+(?:with|by)|exported|produced\s+by/i;

/* ------------------------------------------------------------------- SVG -- */

/** Namespaces an editor injects, which name the software and sometimes the file. */
const EDITOR_NAMESPACES = ['inkscape', 'sodipodi', 'krita', 'serif', 'figma', 'sketch'];

function inspectSvg(text: string): Finding[] {
  const findings: Finding[] = [];

  const metadata = /<metadata[^>]*>([\s\S]*?)<\/metadata>/i.exec(text);
  if (metadata) {
    const inner = metadata[1] ?? '';
    findings.push({
      kind: 'provenance',
      confidence: 'confirmed',
      location: '<metadata>',
      label: 'SVG metadata block',
      value: /c2pa|contentcredentials/i.test(inner)
        ? 'RDF block containing C2PA content credentials'
        : `RDF/Dublin Core block, ${inner.trim().length} characters`,
      ...(/c2pa|contentcredentials/i.test(inner) ? { affectsVerifiability: true } : {}),
    });
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
  for (const match of text.matchAll(COMMENT)) {
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
    const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(text);
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
  let out = text.replace(/<metadata[^>]*>[\s\S]*?<\/metadata>/gi, '');
  out = out.replace(COMMENT, (full, body: string) => (GENERATOR_HINT.test(body) ? '' : full));
  for (const namespace of EDITOR_NAMESPACES) {
    out = out.replace(new RegExp(`\\sxmlns:${namespace}="[^"]*"`, 'gi'), '');
    out = out.replace(new RegExp(`\\s${namespace}:[a-z-]+="[^"]*"`, 'gi'), '');
    out = out.replace(new RegExp(`<${namespace}:[^>]*/>`, 'gi'), '');
    out = out.replace(new RegExp(`<${namespace}:([a-z-]+)[^>]*>[\\s\\S]*?</${namespace}:\\1>`, 'gi'), '');
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
  const tags = text.matchAll(/<meta\s+([^>]*)>/gi);
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

  for (const match of text.matchAll(COMMENT)) {
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

  // JSON-LD is indexed by search engines; it is content, so it is reported only.
  const jsonLd = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i.exec(text);
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
    out = out.replace(/<meta\s+([^>]*)>\s*/gi, (full, attributes: string) => {
      const nameMatch = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(attributes);
      return nameMatch?.[1]?.toLowerCase() === meta.name ? '' : full;
    });
  }
  out = out.replace(COMMENT, (full, body: string) => (GENERATOR_HINT.test(body) ? '' : full));
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
  /^\s*[*_>\s-]*(?:g[ée]n[ée]r[ée]e?\s+(?:par|avec)|generated\s+(?:by|with)|created\s+(?:by|with)|written\s+by|produit\s+par|r[ée]dig[ée]\s+par)\b.{0,120}$/i;

function inspectMarkdown(text: string): Finding[] {
  const findings: Finding[] = [];

  for (const match of text.matchAll(COMMENT)) {
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
    const entry = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
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
function bodyText(text: string, format: MarkupFormat): string {
  return format === 'markdown' ? text : collectTextContent(text);
}

function inspectBodyText(text: string, format: MarkupFormat): Finding[] {
  const scan = scanText(bodyText(text, format));
  const findings: Finding[] = scan.findings.map((finding) => ({
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

export function inspectMarkup(text: string, format: MarkupFormat): Finding[] {
  const findings =
    format === 'svg' ? inspectSvg(text) : format === 'html' ? inspectHtml(text) : inspectMarkdown(text);
  findings.push(...scanContent(text, 'document body'));
  findings.push(...inspectBodyText(text, format));
  findings.push(...fingerprint(findings));
  return findings.sort(byConfidence);
}

export function redactMarkup(text: string, format: MarkupFormat): string {
  const stripped =
    format === 'svg' ? redactSvg(text) : format === 'html' ? redactHtml(text) : redactMarkdown(text);
  return cleanBodyText(stripped, format);
}

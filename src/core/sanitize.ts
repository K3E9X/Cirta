/**
 * [F-2.5] An ingestion firewall: the text of a document as a person reading
 * it sees it, for a model to be handed instead of the file.
 *
 * A model given a file reads everything in it — the white run in a CV, the
 * line under a box in an invoice, a comment in a README, a hidden slide —
 * and an instruction hidden there is obeyed by a pipeline nobody watches.
 * What comes out here is what a reader sees: hidden text, comments, scripts,
 * notes and invisible characters left out, tracked deletions not read,
 * hidden sheets, rows and slides skipped. The hidden instructions found are
 * listed apart, so a pipeline can stop on them instead of passing the rest.
 */

import { strFromU8, unzipSync } from 'fflate';
import type { Finding, Format, InspectOptions } from './types.js';
import { notebookText, parseNotebook } from './notebook.js';
import { rtfText } from './rtf.js';
import { redactLatex } from './latex.js';
import { UnsupportedFormatError } from './errors.js';
import { inspectFile } from './index.js';
import { AIMED_LABEL, stripHiddenDocx, stripHiddenHtml } from './hidden-text.js';
import { stripHiddenPptx } from './hidden-pptx.js';
import { acceptChangesInParts } from './tracked-changes.js';
import { cleanText, decodeTextInput } from './text.js';
import { collectTextContent } from './xml.js';
import { htmlLines } from './mail.js';
import { parseMail, decodeWords } from './mime.js';
import { slideText } from './ooxml.js';
import { attr, sharedStrings, sheets, whiteStyles } from './xlsx-active.js';
import { removeUnrendered, replaceSpans } from './linear.js';
import { elements } from './tracked-changes.js';
import { visiblePdfText } from './xray.js';
import { preview } from './types.js';
import { markdownLinkTargets } from './links.js';
import { mismatchedAnchors, URL_PATTERN } from './url.js';

export interface SanitizedText {
  format: Format;
  /** What a person reading the document sees, invisible characters removed. */
  text: string;
  /** Instructions to a model found hidden in the file, with where. */
  hiddenInstructions: Array<{ location: string; text: string }>;
  /** Hidden passages left out of the text. */
  hiddenRemoved: number;
  /** Kinds of invisible character removed from the text. */
  invisibleRemoved: number;
  /**
   * [R7] Links whose shown address is not where they go: link text naming
   * another site, or an address written in lookalike letters. The text marks
   * each one with its real target, `shown [→ target]`.
   */
  deceptiveLinks: Array<{ shown: string; target: string }>;
}

type Parts = Record<string, Uint8Array>;

const UNRENDERED = ['noscript', 'template', 'script', 'style', 'head'];

/** HTML as lines of the text it shows: hidden elements, comments, scripts, styles and templates out. */
function htmlText(html: string): { text: string; removed: number } {
  const stripped = stripHiddenHtml(html, { everything: true });
  // A block emptied of its hidden text leaves no blank line where it stood.
  const lines = htmlLines(removeUnrendered(stripped.html, UNRENDERED)).split('\n').filter((line) => line.trim());
  return { text: lines.join('\n'), removed: stripped.removed };
}

function wordText(parts: Parts): { text: string; removed: number } {
  // What the document says once its changes are accepted: deleted text is not read.
  acceptChangesInParts(parts);
  const removed = stripHiddenDocx(parts, { everything: true });
  const order = Object.keys(parts)
    .filter((p) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(p))
    .sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)));
  const text = order.map((p) => collectTextContent(strFromU8(parts[p]!)).trim()).filter(Boolean).join('\n\n');
  return { text, removed };
}

function slidesText(parts: Parts): { text: string; removed: number } {
  const removed = stripHiddenPptx(parts, { everything: true });
  const number = (p: string) => Number(/(?<!\d)(\d+)\.xml$/.exec(p)?.[1] ?? 0);
  const slides = Object.keys(parts)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => number(a) - number(b))
    .map((p) => strFromU8(parts[p]!))
    .filter((xml) => !/<p:sld\b[^<>]*\sshow="(0|false)"/.test(xml));
  return { text: slides.map(slideText).filter(Boolean).join('\n\n'), removed };
}

function sheetText(parts: Parts): { text: string; removed: number } {
  const white = whiteStyles(parts);
  const shared = sharedStrings(parts);
  let removed = 0;
  const out: string[] = [];
  for (const sheet of sheets(parts)) {
    if (sheet.hidden) {
      removed++;
      continue;
    }
    const xml = strFromU8(parts[sheet.path]!);
    const hiddenCols = [...xml.matchAll(/<col\b[^<>]*>/g)]
      .filter((m) => /\shidden="(1|true)"/.test(m[0]))
      .map((m) => [Number(attr(m[0], 'min')), Number(attr(m[0], 'max'))] as const);
    const column = (ref: string) => [...(/^[A-Z]+/.exec(ref)?.[0] ?? '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    const lines: string[] = [];
    for (const row of elements(xml, 'row')) {
      if (/\shidden="(1|true)"/.test(row.open)) {
        removed++;
        continue;
      }
      const cells: string[] = [];
      for (const cell of elements(row.inner, 'c')) {
        const ref = attr(cell.open, 'r') ?? '';
        const col = column(ref);
        if (hiddenCols.some(([min, max]) => col >= min && col <= max)) continue;
        if (white.has(Number(attr(cell.open, 's') ?? -1))) {
          removed++;
          continue;
        }
        const type = attr(cell.open, 't');
        const raw = type === 'inlineStr' ? /<t\b[^<>]*>([^<]*)<\/t>/.exec(cell.inner)?.[1] : /<v>([^<]*)<\/v>/.exec(cell.inner)?.[1];
        if (raw === undefined || raw === '') continue;
        cells.push(type === 's' ? shared[Number(raw)] ?? '' : raw);
      }
      if (cells.length) lines.push(cells.join('\t'));
    }
    if (lines.length) out.push(`${sheet.name}\n${lines.join('\n')}`);
  }
  return { text: out.join('\n\n'), removed };
}

function mailText(data: Uint8Array): { text: string; removed: number } {
  const mail = parseMail(data);
  const subject = mail.headers.find((h) => h.name === 'subject')?.value;
  let removed = 0;
  const bodies: string[] = [];
  const html = mail.parts.filter((p) => !p.attachment && p.type === 'text/html');
  // An alternative HTML body is what a mail client shows; the plain one otherwise.
  const shown = html.length ? html : mail.parts.filter((p) => !p.attachment && p.type.startsWith('text/'));
  for (const part of shown) {
    if (part.type === 'text/html') {
      const visible = htmlText(part.text ?? '');
      removed += visible.removed;
      bodies.push(visible.text);
    } else bodies.push((part.text ?? '').trim());
  }
  const attachments = mail.parts.filter((p) => p.attachment).map((p) => p.filename ?? p.type);
  return {
    text: [subject ? `Subject: ${decodeWords(subject)}` : '', ...bodies, attachments.length ? `[attachments: ${attachments.join(', ')}]` : '']
      .filter(Boolean)
      .join('\n\n'),
    removed,
  };
}

export async function sanitizeForLlm(data: Uint8Array, hint?: string, options: Pick<InspectOptions, 'xray'> = {}): Promise<SanitizedText> {
  const report = await inspectFile(data, hint, { xray: options.xray });
  const hiddenInstructions = report.findings
    .filter((f: Finding) => f.label === AIMED_LABEL)
    .map((f) => ({ location: f.location, text: f.value.replace(/ — [^—]*$/, '').trim() }));

  let body: { text: string; removed: number };
  switch (report.format) {
    case 'pdf': {
      if (!options.xray) {
        throw new UnsupportedFormatError('Telling what a reader of a PDF sees needs the PDF renderer, which is not available here.', 'renderer-unavailable');
      }
      const visible = await visiblePdfText(data, options.xray);
      if (visible.pagesChecked < visible.pagesTotal) {
        throw new UnsupportedFormatError(
          `Only ${visible.pagesChecked} of ${visible.pagesTotal} pages could be rendered in time; the rest cannot be vouched for.`,
          'renderer-unavailable',
          `${visible.pagesChecked}/${visible.pagesTotal}`,
        );
      }
      body = { text: visible.pages.join('\n\n'), removed: visible.hidden.length };
      break;
    }
    case 'docx':
      body = wordText(unzipSync(data));
      break;
    case 'pptx':
      body = slidesText(unzipSync(data));
      break;
    case 'xlsx':
      body = sheetText(unzipSync(data));
      break;
    case 'odt':
    case 'ods':
    case 'odp': {
      const parts = unzipSync(data);
      body = { text: collectTextContent(parts['content.xml'] ? strFromU8(parts['content.xml']) : '').trim(), removed: 0 };
      break;
    }
    case 'html':
      body = htmlText(decodeTextInput(data, { allowBinary: true }));
      break;
    case 'markdown': {
      const markdown = decodeTextInput(data, { allowBinary: true });
      const stripped = stripHiddenHtml(markdown, { everything: true });
      body = { text: replaceSpans(stripped.html, '<!--', '-->').trim(), removed: stripped.removed };
      break;
    }
    case 'eml':
      body = mailText(data);
      break;
    case 'ipynb': {
      // [F-2.2] The sources and what the outputs printed; pictures and escape codes left out.
      const notebook = parseNotebook(decodeTextInput(data, { allowBinary: true }));
      body = { text: notebook ? notebookText(notebook) : '', removed: 0 };
      break;
    }
    case 'rtf':
      // [F-P2 2.2] The running text; text formatted hidden (\v) is not told apart.
      body = { text: rtfText(data), removed: 0 };
      break;
    case 'text':
      body = { text: decodeTextInput(data, { allowBinary: hint === 'text' }), removed: 0 };
      break;
    case 'latex': {
      // [F-P2 2.2] The source without its comments: what the author meant to typeset.
      const cleaned = redactLatex(decodeTextInput(data, { allowBinary: true }));
      body = { text: cleaned.text ?? '', removed: Number(cleaned.notes.find((n) => n.code === 'removed:latex-comments')?.detail ?? 0) };
      break;
    }
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'gif':
    case 'tiff':
    case 'heic':
    case 'avif':
      body = { text: '', removed: 0 };
      break;
    default:
      throw new UnsupportedFormatError(`Text for a model is not extracted from ${report.format} files.`, 'unsupported');
  }

  const cleaned = cleanText(body.text, { normalizeSpaces: false, normalize: 'when-flagged' });
  const plain = cleaned.text.replace(/\n{3,}/g, '\n\n').trim();
  const deceptiveLinks = deceptive(data, report.format, plain);
  return {
    format: report.format,
    text: markTargets(plain, deceptiveLinks),
    deceptiveLinks,
    hiddenInstructions: hiddenInstructions.map((i) => ({ ...i, text: preview(i.text, 500) })),
    hiddenRemoved: body.removed,
    invisibleRemoved: cleaned.removed.length,
  };
}

/**
 * [R7] The links a reader would be misled by. A model handed the text reads
 * « https://paypal.com/login » as a destination and may repeat it as one; the
 * text says where it really goes.
 */
function deceptive(data: Uint8Array, format: Format, text: string): Array<{ shown: string; target: string }> {
  const found = new Map<string, string>();
  const html: string[] = [];
  if (format === 'html') html.push(decodeTextInput(data, { allowBinary: true }));
  if (format === 'markdown') {
    const markdown = decodeTextInput(data, { allowBinary: true });
    html.push(markdown, markdownLinkTargets(markdown).map((l) => `<a href="${l.target.replace(/"/g, '&quot;')}">${l.text}</a>`).join('\n'));
  }
  if (format === 'eml') for (const part of parseMail(data).parts) if (part.type === 'text/html' && part.text) html.push(part.text);
  for (const source of html) for (const anchor of mismatchedAnchors(source)) if (!found.has(anchor.address)) found.set(anchor.address, anchor.href);
  // An address in letters from another alphabet: where it goes is its punycode.
  for (const m of text.matchAll(URL_PATTERN)) {
    const host = m[0].split('/')[2] ?? '';
    if (!/[^\x00-\x7f]/.test(host) || found.has(m[0])) continue;
    try {
      found.set(m[0], new URL(m[0]).href);
    } catch {
      // Not an address after all.
    }
  }
  return [...found].filter(([shown, target]) => shown !== target).map(([shown, target]) => ({ shown, target }));
}

/** Each shown address followed by its real target, in one pass, longest first. */
function markTargets(text: string, links: Array<{ shown: string; target: string }>): string {
  if (!links.length) return text;
  const targets = new Map(links.map((l) => [l.shown, l.target]));
  const pattern = new RegExp([...targets.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return text.replace(pattern, (shown) => `${shown} [→ ${targets.get(shown)}]`);
}

/**
 * Comments in Office packages, wherever a producer put them.
 *
 * [C6] A workbook comment written by openpyxl lives at xl/comments/comment1.xml;
 * Excel writes xl/comments1.xml; threaded comments, a person registry with
 * directory account ids, PowerPoint's legacy and modern comment parts each have
 * their own place and shape. Matching on one path missed the comment, its
 * author and its text entirely. A part is recognised here by its root element.
 *
 * A comment's author is metadata and is anonymised. Its text is what someone
 * chose to write — content, reported and left unless removal is asked for.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';
import { elements } from './tracked-changes.js';

export const ANONYMOUS = 'Author';
const MAX_TEXTS = 20;

export interface CommentParts {
  /** Spreadsheet legacy comments: <comments> with <authors>. */
  sheet: string[];
  /** Spreadsheet threaded comments. */
  threaded: string[];
  /** The person registry threaded comments name. */
  persons: string[];
  /** word/comments.xml and its companions. */
  word: string[];
  wordExtras: string[];
  /** PowerPoint comments, legacy and modern. */
  slide: string[];
  /** PowerPoint comment author lists, legacy and modern. */
  slideAuthors: string[];
}

const decoder = new TextDecoder();
const read = (parts: Record<string, Uint8Array>, path: string) => decoder.decode(parts[path]);

/** The local name of a part's root element, after any prolog. */
export function rootOf(xml: string): { prefix: string; name: string } | undefined {
  const m = /^\s*(?:<\?[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:([\w.-]+):)?([\w.-]+)[\s>/]/.exec(xml.slice(0, 4000));
  return m ? { prefix: m[1] ?? '', name: m[2]! } : undefined;
}

export function commentParts(parts: Record<string, Uint8Array>): CommentParts {
  const found: CommentParts = { sheet: [], threaded: [], persons: [], word: [], wordExtras: [], slide: [], slideAuthors: [] };
  for (const path of Object.keys(parts).sort()) {
    if (!path.endsWith('.xml')) continue;
    const top = path.split('/')[0];
    if (top !== 'xl' && top !== 'word' && top !== 'ppt') continue;
    const root = rootOf(read(parts, path))?.name;
    if (!root) continue;
    if (top === 'xl' && root === 'comments') found.sheet.push(path);
    else if (top === 'xl' && root === 'ThreadedComments') found.threaded.push(path);
    else if (top === 'xl' && root === 'personList') found.persons.push(path);
    else if (top === 'word' && root === 'comments') found.word.push(path);
    else if (top === 'word' && /^comments(?:Ex|Ids|Extensible)$/.test(root)) found.wordExtras.push(path);
    else if (top === 'ppt' && root === 'cmLst') found.slide.push(path);
    else if (top === 'ppt' && (root === 'cmAuthorLst' || root === 'authorLst')) found.slideAuthors.push(path);
  }
  return found;
}

const decode = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** Every text node of a comment body, whatever namespace its <t> carries. */
const textOf = (inner: string) =>
  [...inner.matchAll(/<(?:[\w.-]+:)?(?:t|text)(?:\s[^>]*)?>([^<]*)<\/(?:[\w.-]+:)?(?:t|text)>/g)]
    .map((m) => decode(m[1] ?? ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

function commentTexts(parts: Record<string, Uint8Array>, found: CommentParts): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const take = (path: string, element: string) => {
    for (const comment of elements(read(parts, path), element)) {
      const text = textOf(comment.inner);
      if (text) out.push({ path, text });
    }
  };
  for (const path of found.sheet) take(path, 'comment');
  for (const path of found.threaded) take(path, 'threadedComment');
  for (const path of found.word) take(path, 'w:comment');
  for (const path of found.slide) {
    const prefix = rootOf(read(parts, path))?.prefix;
    take(path, prefix ? `${prefix}:cm` : 'cm');
  }
  return out;
}

const AUTHOR_ELEMENT = /<(?:[\w.-]+:)?(?:cmAuthor|author)\b[^<>]*>/g;
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

export function commentFindings(parts: Record<string, Uint8Array>): Finding[] {
  const found = commentParts(parts);
  const findings: Finding[] = [];

  // Word's authors are reported with tracked-change authors, from w:author.
  const authors = new Set<string>();
  const accounts = new Set<string>();
  for (const path of found.sheet) {
    for (const m of read(parts, path).matchAll(/<author>([^<]*)<\/author>/g)) authors.add(decode(m[1] ?? '').trim());
  }
  for (const path of found.persons) {
    for (const m of read(parts, path).matchAll(/<person\b[^<>]*>/g)) {
      authors.add(decode(attr(m[0], 'displayName') ?? '').trim());
      const user = attr(m[0], 'userId');
      if (user) accounts.add(`${decode(user)}${attr(m[0], 'providerId') ? ` (${attr(m[0], 'providerId')})` : ''}`);
    }
  }
  for (const path of found.slideAuthors) {
    for (const m of read(parts, path).matchAll(AUTHOR_ELEMENT)) {
      authors.add(decode(attr(m[0], 'name') ?? '').trim());
      const user = attr(m[0], 'userId');
      if (user) accounts.add(`${decode(user)}${attr(m[0], 'providerId') ? ` (${attr(m[0], 'providerId')})` : ''}`);
    }
  }
  authors.delete('');
  authors.delete(ANONYMOUS);
  if (authors.size) {
    findings.push({ kind: 'identity', confidence: 'confirmed', location: 'comments', label: 'Comment authors', value: [...authors].join(', ') });
  }
  for (const account of accounts) {
    findings.push({ kind: 'identity', confidence: 'confirmed', location: 'comments', label: 'Comment author account', value: account });
  }

  const seen = new Set<string>();
  for (const { path, text } of commentTexts(parts, found)) {
    if (seen.has(text)) continue;
    seen.add(text);
    findings.push({ kind: 'identity', confidence: 'probable', location: path, label: 'Comment text', value: preview(text, 160) });
    if (seen.size >= MAX_TEXTS) break;
  }
  return findings;
}

/** Comment authors and accounts replaced, in place. The text is untouched. */
export function anonymizeComments(parts: Record<string, Uint8Array>): void {
  const found = commentParts(parts);
  const write = (path: string, xml: string) => (parts[path] = new TextEncoder().encode(xml));
  for (const path of found.sheet) write(path, read(parts, path).replace(/<author>[^<]*<\/author>/g, `<author>${ANONYMOUS}</author>`));
  for (const path of [...found.persons, ...found.slideAuthors]) {
    write(
      path,
      read(parts, path).replace(/<(?:[\w.-]+:)?(?:person|cmAuthor|author)\b[^<>]*>/g, (tag) =>
        tag
          .replace(/\s(displayName|name)="[^"]*"/, ` $1="${ANONYMOUS}"`)
          .replace(/\sinitials="[^"]*"/, ' initials="A"')
          .replace(/\s(?:userId|providerId)="[^"]*"/g, ''),
      ),
    );
  }
}

/** How many comments a set of parts holds, for the note that says they went. */
export function countComments(parts: Record<string, Uint8Array>): number {
  return commentTexts(parts, commentParts(parts)).length;
}

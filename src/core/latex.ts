/**
 * [F-P2 2.2] LaTeX sources.
 *
 * A .tex file sent to a co-author, a journal or arXiv travels with what was
 * never meant to be typeset:
 *
 *   % comments            notes to self, the reviewer's name, a figure that
 *                         was dropped and why
 *   comment environments  whole passages kept out of the PDF but in the file
 *   \author, \thanks      who wrote it and who paid for it, often an e-mail
 *   \hypersetup, \pdfinfo the PDF's own author field, set from the source
 *   \input, \include,     absolute paths: the account name and the layout
 *   \includegraphics,     of the author's disk
 *   \bibliography …
 *
 * A % is a comment only outside verbatim material: \verb, the verbatim,
 * lstlisting and minted environments, the argument of \url and \href, and
 * after a backslash (\%). Cleaning removes the text of each comment and keeps
 * the % itself: at the end of a line it swallows the newline, and taking it
 * out would put a space in the typeset text. The body of a comment
 * environment goes. The author, the thanks and the paths are the document's
 * own: reported, kept, and named as kept.
 */

import type { Finding, InspectResult, Note, RedactResult } from './types.js';
import { byConfidence, preview } from './types.js';
import { inspectPlainText } from './plaintext.js';
import { cleanText } from './text.js';
import { fingerprint } from './fingerprint.js';

const VERBATIM = /^(?:verbatim\*?|Verbatim\*?|BVerbatim|LVerbatim|lstlisting|minted|alltt|filecontents\*?|comment)$/;
const VERBATIM_ARGUMENT = /^(?:url|href|path|nolinkurl)$/;

export function looksLikeLatex(text: string, hint?: string): boolean {
  if (hint === 'latex' || /\.(?:tex|ltx|sty|cls|dtx)$/i.test(hint ?? '')) return true;
  return /^\s*(?:%.*\n\s*)*\\(?:documentclass|documentstyle)\b/.test(text) || /\\begin\{document\}/.test(text);
}

interface Span {
  start: number;
  end: number;
}

interface Scan {
  /** Each comment, from its % to the end of its line, the newline left out. */
  comments: Span[];
  /** The body of each comment environment. */
  hidden: Span[];
}

/** One pass over the source, keeping track of what is verbatim. */
function scan(text: string): Scan {
  const comments: Span[] = [];
  const hidden: Span[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      const word = /^[a-zA-Z@]+\*?/.exec(text.slice(i + 1, i + 40))?.[0];
      if (!word) {
        i += 2;
        continue;
      }
      const after = i + 1 + word.length;
      if (word === 'verb' || word === 'verb*') {
        const delimiter = text[after];
        const close = delimiter ? text.indexOf(delimiter, after + 1) : -1;
        const newline = text.indexOf('\n', after);
        i = close < 0 || (newline >= 0 && newline < close) ? after + 1 : close + 1;
        continue;
      }
      if (word === 'begin') {
        const env = /^\s*\{([^}]*)\}/.exec(text.slice(after, after + 64));
        if (env && VERBATIM.test(env[1]!)) {
          const bodyStart = after + env[0].length;
          const endTag = `\\end{${env[1]}}`;
          const close = text.indexOf(endTag, bodyStart);
          const bodyEnd = close < 0 ? text.length : close;
          if (env[1] === 'comment') hidden.push({ start: bodyStart, end: bodyEnd });
          i = close < 0 ? text.length : close + endTag.length;
          continue;
        }
      }
      if (VERBATIM_ARGUMENT.test(word)) {
        let at = after;
        while (text[at] === ' ') at++;
        if (text[at] === '{') {
          let depth = 0;
          for (; at < text.length; at++) {
            if (text[at] === '{') depth++;
            else if (text[at] === '}' && --depth === 0) break;
            else if (text[at] === '\n' && text[at + 1] === '\n') break;
          }
          i = at + 1;
          continue;
        }
      }
      i = after;
      continue;
    }
    if (c === '%') {
      const newline = text.indexOf('\n', i);
      const end = newline < 0 ? text.length : newline;
      comments.push({ start: i, end: text[end - 1] === '\r' ? end - 1 : end });
      i = end;
      continue;
    }
    i++;
  }
  return { comments, hidden };
}

/** The text of a command's first braced argument, nested braces included. */
function argumentsOf(text: string, command: string): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`\\\\${command}\\*?\\s*(?:\\[[^\\]]*\\]\\s*)?\\{`, 'g');
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    let depth = 1;
    let at = m.index + m[0].length;
    const start = at;
    for (; at < text.length && depth > 0; at++) {
      if (text[at] === '\\') at++;
      else if (text[at] === '{') depth++;
      else if (text[at] === '}') depth--;
    }
    out.push(text.slice(start, at - 1));
  }
  return out;
}

/** The source with comments blanked, so a commented-out \author is not read as one. */
function uncommented(text: string, { comments, hidden }: Scan): string {
  let out = '';
  let at = 0;
  for (const span of [...comments, ...hidden].sort((a, b) => a.start - b.start)) {
    if (span.start < at) continue;
    out += text.slice(at, span.start) + ' '.repeat(span.end - span.start);
    at = span.end;
  }
  return out + text.slice(at);
}

const ABSOLUTE = /^(?:\/|~\/|[A-Za-z]:[\\/]|\\\\)/;
const PATH_COMMANDS = ['input', 'include', 'includegraphics', 'includepdf', 'includeonly', 'bibliography', 'addbibresource', 'graphicspath', 'lstinputlisting', 'inputminted', 'import', 'subimport', 'subfile'];
const MAX_QUOTED = 50;

export function inspectLatex(text: string): InspectResult {
  const found = scan(text);
  const source = uncommented(text, found);
  const findings: Finding[] = [];

  const comments = found.comments.map((s) => text.slice(s.start + 1, s.end).replace(/^%+/, '').trim()).filter(Boolean);
  for (const [n, comment] of comments.slice(0, MAX_QUOTED).entries()) {
    findings.push({ kind: 'identity', confidence: 'probable', location: `comment ${n + 1}`, label: 'LaTeX comment', value: preview(comment, 200) });
  }
  if (comments.length > MAX_QUOTED) findings.push({ kind: 'identity', confidence: 'probable', location: 'comments', label: 'LaTeX comments', value: `${comments.length} comments, the first ${MAX_QUOTED} quoted` });
  for (const span of found.hidden) {
    const body = text.slice(span.start, span.end).trim();
    if (body) findings.push({ kind: 'identity', confidence: 'probable', location: '\\begin{comment}', label: 'Text in a comment environment', value: preview(body, 200) });
  }

  for (const author of argumentsOf(source, 'author')) {
    const value = author.replace(/\\thanks\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '').trim();
    if (value) findings.push({ kind: 'identity', confidence: 'confirmed', location: '\\author', label: 'Author', value: preview(value, 200) });
  }
  for (const thanks of argumentsOf(source, 'thanks')) findings.push({ kind: 'identity', confidence: 'probable', location: '\\thanks', label: 'Acknowledgement note (\\thanks)', value: preview(thanks.trim(), 200) });
  for (const command of ['email', 'affiliation', 'address', 'orcid']) {
    for (const value of argumentsOf(source, command)) findings.push({ kind: 'identity', confidence: command === 'email' ? 'confirmed' : 'probable', location: `\\${command}`, label: 'Author contact', value: preview(value.trim(), 200) });
  }
  for (const setup of [...argumentsOf(source, 'hypersetup'), ...argumentsOf(source, 'pdfinfo')]) {
    const author = /pdfauthor\s*=\s*\{([^}]*)\}|pdfauthor\s*=\s*([^,}\n]+)|\/Author\s*\(([^)]*)\)/.exec(setup);
    const value = (author?.[1] ?? author?.[2] ?? author?.[3])?.trim();
    if (value) findings.push({ kind: 'identity', confidence: 'confirmed', location: '\\hypersetup', label: 'PDF author set by the source', value });
  }

  const paths = new Set<string>();
  for (const command of PATH_COMMANDS) {
    for (const argument of argumentsOf(source, command)) {
      for (const path of argument.split(/[,{}]/).map((p) => p.trim()).filter(Boolean)) if (ABSOLUTE.test(path)) paths.add(path);
    }
  }
  for (const path of paths) findings.push({ kind: 'environment', confidence: 'confirmed', location: 'file references', label: 'Local path in the source', value: path });

  findings.push(...inspectPlainText(text).filter((f) => f.kind === 'invisible-character' || f.kind === 'deceptive-link'));
  return { format: 'latex', findings: [...findings, ...fingerprint(findings)].sort(byConfidence), notes: [{ code: 'scope:latex' }] };
}

export function redactLatex(text: string): RedactResult {
  const before = inspectLatex(text).findings;
  const found = scan(text);
  let out = '';
  let at = 0;
  // A comment keeps its %; a comment environment keeps its \begin and \end.
  const spans = [...found.comments.map((s) => ({ ...s, start: s.start + 1 })), ...found.hidden.map((s) => ({ ...s, keepNewline: true }))].sort((a, b) => a.start - b.start);
  for (const span of spans) {
    if (span.start < at) continue;
    out += text.slice(at, span.start) + ('keepNewline' in span ? '\n' : '');
    at = span.end;
  }
  out += text.slice(at);
  const cleaned = cleanText(out, { normalizeSpaces: false, normalize: 'when-flagged' }).text;
  const notes: Note[] = [{ code: 'scope:latex' }];
  if (found.comments.length) notes.push({ code: 'removed:latex-comments', detail: String(found.comments.length + found.hidden.length) });
  return { format: 'latex', data: new TextEncoder().encode(cleaned), text: cleaned, removed: before, notes };
}

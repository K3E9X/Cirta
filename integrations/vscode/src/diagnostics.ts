/**
 * [F-P2 2.6] What Cirta finds, as editor diagnostics — without the editor, so
 * it can be tested on its own. extension.ts turns these into VS Code's types.
 *
 * An invisible character is placed where it is: its location ends with its
 * code point (U+200B), and in a text file every occurrence gets its own range, so
 * the editor underlines the very spot. Anything else — an author in a
 * document's properties, a macro — belongs to the file, not to a line, and is
 * placed at its start.
 */

import type { Finding } from '../../../src/core/types.js';
import { translateLabel, translateLocation, translateValue, type Lang } from '../../../src/shared/french.js';

export interface PlainDiagnostic {
  /** Zero-based, as VS Code counts. */
  range: { line: number; character: number; endLine: number; endCharacter: number };
  severity: 'error' | 'warning' | 'information';
  message: string;
  /** The finding's label, which a quick fix or a filter can match on. */
  code: string;
}

const SEVERITY: Record<Finding['confidence'], PlainDiagnostic['severity']> = {
  confirmed: 'error',
  probable: 'warning',
  informational: 'information',
};

const MAX_PER_CHARACTER = 200;

/** Every place a code point occurs in the text, as line and column (UTF-16 units, as the editor counts). */
function occurrences(text: string, codePoint: number): Array<{ line: number; character: number; length: number }> {
  const needle = String.fromCodePoint(codePoint);
  const out: Array<{ line: number; character: number; length: number }> = [];
  let line = 0;
  let lineStart = 0;
  let from = 0;
  for (let at = text.indexOf(needle, from); at >= 0 && out.length < MAX_PER_CHARACTER; at = text.indexOf(needle, from)) {
    for (let i = text.indexOf('\n', lineStart); i >= 0 && i < at; i = text.indexOf('\n', lineStart)) {
      line++;
      lineStart = i + 1;
    }
    out.push({ line, character: at - lineStart, length: needle.length });
    from = at + needle.length;
  }
  return out;
}

export function toDiagnostics(findings: Finding[], lang: Lang, text?: string): PlainDiagnostic[] {
  const out: PlainDiagnostic[] = [];
  for (const finding of findings) {
    const message = `${translateLabel(finding.label, lang)} — ${translateValue(finding, lang)} (${translateLocation(finding.location, lang)})`;
    const base = { severity: SEVERITY[finding.confidence], message, code: finding.label };
    // "U+200B" in plain text, "document body (U+200B)" in Markdown, HTML, SVG.
    const codePoint = /(?:^|\()U\+([0-9A-F]{4,6})\)?$/.exec(finding.location)?.[1];
    const places = text !== undefined && codePoint ? occurrences(text, parseInt(codePoint, 16)) : [];
    if (places.length) {
      for (const place of places) out.push({ ...base, range: { line: place.line, character: place.character, endLine: place.line, endCharacter: place.character + place.length } });
    } else {
      out.push({ ...base, range: { line: 0, character: 0, endLine: 0, endCharacter: 0 } });
    }
  }
  return out;
}

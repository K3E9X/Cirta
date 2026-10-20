import { describe, expect, it } from 'vitest';
import { removeUnrendered, replaceSpans, spans } from '../src/core/linear.js';
import { splitOutsideQuotes } from '../src/core/mime.js';
import { literalStrings } from '../src/core/pdf.js';
import { rng } from './helpers/mutate.js';

/*
 * [P0-1] The scans that replaced backtracking patterns give what those
 * patterns gave: compared on random strings built from the pieces that
 * matter — openings, closings, escapes — with the old pattern as the oracle.
 */

function strings(pieces: string[], seed: number, count = 20_000): string[] {
  const random = rng(seed);
  return Array.from({ length: count }, () => Array.from({ length: Math.floor(random() * 14) }, () => pieces[Math.floor(random() * pieces.length)]).join(''));
}

describe('[P0-1] linear scans, against the patterns they replace', () => {
  it('spans and replaceSpans: /<!--[\\s\\S]*?-->/g', () => {
    for (const text of strings(['<!--', '-->', '<!-', '--', '>', 'a', '-'], 1)) {
      expect(replaceSpans(text, '<!--', '-->'), text).toBe(text.replace(/<!--[\s\S]*?-->/g, ''));
      expect(spans(text, '<!--', '-->').map(([a, b]) => text.slice(a, b)), text).toEqual(text.match(/<!--[\s\S]*?-->/g) ?? []);
    }
  });

  it('removeUnrendered: comments and unrendered elements, case and spacing as the pattern had them', () => {
    const names = ['noscript', 'template', 'script', 'style', 'head'];
    const pattern = /<!--[\s\S]*?-->|<(noscript|template|script|style|head)\b[\s\S]*?<\/\1\s*>/gi;
    for (const text of strings(['<!--', '-->', '<script>', '</script>', '</SCRIPT >', '<Style a>', '</style>', '<head>', '</head>', '<scripts>', '<', 'x', ' '], 2)) {
      expect(removeUnrendered(text, names), text).toBe(text.replace(pattern, ''));
    }
  });

  it('literalStrings: /\\(((?:[^()\\\\]|\\\\[\\s\\S])*)\\)/g', () => {
    for (const text of strings(['(', ')', '\\', 'a', '\\(', '\\)'], 3)) {
      expect(literalStrings(text), text).toEqual([...text.matchAll(/\(((?:[^()\\]|\\[\s\S])*)\)/g)].map((m) => m[1]));
    }
  });

  it('splitOutsideQuotes: split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)', () => {
    for (const text of strings([';', '"', 'a', '=', ' '], 4)) {
      expect(splitOutsideQuotes(text), text).toEqual(text.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/));
    }
  });
});

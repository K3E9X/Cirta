/**
 * [P0-1] What `open[\s\S]*?close` matches, found without a regular
 * expression. A regex tries again from every opening that has no closing
 * after it, each time to the end of the input: quadratic, minutes on a file
 * made of openings. Here an opening without a closing ends the search, since
 * no later opening has one either.
 */

/** The text without the first match of a global pattern that `drop` accepts: a tag found first, its attribute read after. */
export function removeFirst(text: string, pattern: RegExp, drop: (match: string) => boolean): string {
  for (const m of text.matchAll(pattern)) {
    if (drop(m[0])) return text.slice(0, m.index) + text.slice(m.index + m[0].length);
  }
  return text;
}

/** Every `open … close` span, the first closing after each opening, as the lazy pattern takes them. */
export function spans(text: string, open: string, close: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let at = text.indexOf(open);
  while (at >= 0) {
    const end = text.indexOf(close, at + open.length);
    if (end < 0) break;
    out.push([at, end + close.length]);
    at = text.indexOf(open, end + close.length);
  }
  return out;
}

/** The text with each `open … close` span replaced, as `text.replace(/open[\s\S]*?close/g, …)` does. */
export function replaceSpans(text: string, open: string, close: string, by: (span: string) => string = () => ''): string {
  let out = '';
  let from = 0;
  for (const [start, end] of spans(text, open, close)) {
    out += text.slice(from, start) + by(text.slice(start, end));
    from = end;
  }
  return out + text.slice(from);
}

/**
 * HTML comments and the elements a reader never sees rendered, removed as
 * `/<!--[\s\S]*?-->|<(name|…)\b[\s\S]*?<\/\1\s*>/gi` removes them: the earliest
 * opening first, each running to its first closing. A kind whose closing is
 * gone for good is no longer looked for.
 */
export function removeUnrendered(html: string, names: readonly string[]): string {
  const opening = new RegExp(`<!--|<(${names.join('|')})\\b`, 'gi');
  const closings = new Map<string, RegExp>();
  const exhausted = new Set<string>();
  let out = '';
  let from = 0;
  for (let m = opening.exec(html); m; m = opening.exec(html)) {
    const kind = m[1]?.toLowerCase() ?? '--';
    if (exhausted.has(kind)) continue;
    let end: number;
    if (kind === '--') {
      const close = html.indexOf('-->', m.index + 4);
      end = close < 0 ? -1 : close + 3;
    } else {
      let closing = closings.get(kind);
      if (!closing) closings.set(kind, (closing = new RegExp(`</${kind}\\s*>`, 'gi')));
      closing.lastIndex = m.index + m[0].length;
      const found = closing.exec(html);
      end = found ? found.index + found[0].length : -1;
    }
    if (end < 0) {
      exhausted.add(kind);
      opening.lastIndex = m.index + 1;
      continue;
    }
    out += html.slice(from, m.index);
    from = end;
    opening.lastIndex = end;
  }
  return out + html.slice(from);
}

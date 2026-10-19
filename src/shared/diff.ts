/**
 * [F-2.7] The before and after of a cleaned text, line by line, for the page
 * to show what changed. What cleaning removes is mostly invisible, so a diff
 * of the raw text would show two identical lines: showInvisible() writes each
 * such character as its code point.
 */

export type DiffLine = { kind: 'same' | 'removed' | 'added'; text: string };
export type Shown = DiffLine | { kind: 'skip'; count: number };

/** Above this many cells the table is not built: the changed middle is shown as one block. */
const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ kind: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length * midB.length > MAX_CELLS) {
    return [...head, ...midA.map((text): DiffLine => ({ kind: 'removed', text })), ...midB.map((text): DiffLine => ({ kind: 'added', text })), ...tail];
  }

  // Longest common subsequence, lengths from the end so the walk goes forward.
  const n = midA.length;
  const m = midB.length;
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = midA[i] === midB[j] ? lcs[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(lcs[(i + 1) * (m + 1) + j]!, lcs[i * (m + 1) + j + 1]!);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      middle.push({ kind: 'same', text: midA[i++]! });
      j++;
    } else if (lcs[(i + 1) * (m + 1) + j]! >= lcs[i * (m + 1) + j + 1]!) middle.push({ kind: 'removed', text: midA[i++]! });
    else middle.push({ kind: 'added', text: midB[j++]! });
  }
  while (i < n) middle.push({ kind: 'removed', text: midA[i++]! });
  while (j < m) middle.push({ kind: 'added', text: midB[j++]! });
  return [...head, ...middle, ...tail];
}

/** The changes with `context` unchanged lines around each; longer unchanged runs folded into a count. */
export function hunks(diff: DiffLine[], context = 3): Shown[] {
  const keep = diff.map(() => false);
  diff.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (let k = Math.max(0, index - context); k <= Math.min(diff.length - 1, index + context); k++) keep[k] = true;
  });
  const out: Shown[] = [];
  let skipped = 0;
  diff.forEach((line, index) => {
    if (keep[index]) {
      if (skipped) out.push({ kind: 'skip', count: skipped });
      skipped = 0;
      out.push(line);
    } else skipped++;
  });
  if (skipped) out.push({ kind: 'skip', count: skipped });
  return out;
}

/** Format controls, odd spaces, control characters, variation selectors and fillers: everything a reader would not see. */
const UNSEEN = /(?![ \t\n\r])[\p{Cf}\p{Cc}\p{Zs}\p{Zl}\p{Zp}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}ᅟᅠㅤﾠ⠀]/gu;

export function showInvisible(text: string): string {
  return text.replace(UNSEEN, (c) => `⟨U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`);
}

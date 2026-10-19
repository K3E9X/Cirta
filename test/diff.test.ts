import { describe, expect, it } from 'vitest';
import { hunks, lineDiff, showInvisible } from '../src/shared/diff.js';

describe('[F-2.7] the before and after of a text', () => {
  it('diffs by line, keeping order', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
    ]);
    expect(lineDiff('x', 'x')).toEqual([{ kind: 'same', text: 'x' }]);
  });

  it('folds long unchanged runs, keeping context around each change', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l10', 'L10');
    const shown = hunks(lineDiff(before, after), 2);
    expect(shown).toEqual([
      { kind: 'skip', count: 8 },
      { kind: 'same', text: 'l8' },
      { kind: 'same', text: 'l9' },
      { kind: 'removed', text: 'l10' },
      { kind: 'added', text: 'L10' },
      { kind: 'same', text: 'l11' },
      { kind: 'same', text: 'l12' },
      { kind: 'skip', count: 7 },
    ]);
  });

  it('stays fast on large inputs, falling back to one block when the table would be too big', () => {
    const a = Array.from({ length: 20_000 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 20_000 }, (_, i) => `b${i}`).join('\n');
    const started = Date.now();
    const diff = lineDiff(a, b);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(diff.filter((d) => d.kind === 'removed')).toHaveLength(20_000);
    expect(diff.filter((d) => d.kind === 'added')).toHaveLength(20_000);
  });

  it('shows what cannot be seen: an invisible character becomes its code point', () => {
    expect(showInvisible('Bon​jour !‮')).toBe('Bon⟨U+200B⟩jour⟨U+00A0⟩!⟨U+202E⟩');
    expect(showInvisible('tab\there é')).toBe('tab\there é');
    expect(showInvisible('😀\u{E0041}')).toBe('😀⟨U+E0041⟩');
  });
});

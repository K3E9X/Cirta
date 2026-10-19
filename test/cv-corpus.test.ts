import { describe, expect, it } from 'vitest';
import { nodeXrayEngine } from '../src/cli/xray-engine.js';
import { inspectFile } from '../src/core/index.js';
import { AIMED_LABEL, HIDDEN_LABELS } from '../src/core/hidden-text.js';
import { STUFFING_LABEL } from '../src/core/keywords.js';
import { corpus, type Kind } from './helpers/cv-corpus.js';

/*
 * [P0-2] The acceptance test: twenty synthetic CVs in five formats. Hidden
 * keywords and hidden orders to a model are found at least nine times in ten,
 * and none of the ten honest CVs — some with a white title on a dark band —
 * is reported as hiding anything.
 */

const engine = await nodeXrayEngine();
const cvs = await corpus();
const verdicts = await Promise.all(
  cvs.map(async (cv) => {
    const { findings } = await inspectFile(cv.bytes, cv.name, { xray: engine });
    const seen: Kind = findings.some((f) => f.label === AIMED_LABEL) ? 'instruction' : findings.some((f) => f.label === STUFFING_LABEL) ? 'stuffing' : 'clean';
    return { ...cv, seen, hidden: findings.filter((f) => HIDDEN_LABELS.has(f.label)) };
  }),
);

describe('[P0-2] twenty CVs', () => {
  it('holds 10 honest, 6 with hidden keywords (white, 1 pt, off the page, under a layer), 4 with an order to a model, in five formats', () => {
    const count = (kind: Kind) => cvs.filter((cv) => cv.kind === kind).length;
    expect([count('clean'), count('stuffing'), count('instruction')]).toEqual([10, 6, 4]);
    expect(new Set(cvs.filter((cv) => cv.kind === 'stuffing').map((cv) => cv.technique))).toEqual(new Set(['white', 'tiny', 'offpage', 'layer']));
    expect(new Set(cvs.map((cv) => cv.name.split('.').pop()))).toEqual(new Set(['pdf', 'docx', 'odt', 'html', 'rtf']));
  });

  it('finds what each trapped CV hides, and calls it by its name: recall of 90 % or more', () => {
    const trapped = verdicts.filter((v) => v.kind !== 'clean');
    const right = trapped.filter((v) => v.seen === v.kind);
    // Every miss named, so a regression says which file and which trick.
    const misses = trapped.filter((v) => v.seen !== v.kind).map((v) => `${v.name}: expected ${v.kind}, saw ${v.seen}`);
    expect(right.length / trapped.length, misses.join('\n')).toBeGreaterThanOrEqual(0.9);
    // Today, all of them.
    expect(misses).toEqual([]);
  });

  it('reports nothing hidden in any of the ten honest CVs', () => {
    const accused = verdicts.filter((v) => v.kind === 'clean' && v.hidden.length).map((v) => `${v.name}: ${v.hidden.map((f) => f.label).join(', ')}`);
    expect(accused).toEqual([]);
  });

  it('is confirmed wherever a trap is found, so a recruiter can sort by it', () => {
    for (const v of verdicts.filter((x) => x.kind !== 'clean')) {
      const label = v.kind === 'instruction' ? AIMED_LABEL : STUFFING_LABEL;
      expect(v.hidden.find((f) => f.label === label)?.confidence, v.name).toBe('confirmed');
    }
  });
});

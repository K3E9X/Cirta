import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRules, RulesError } from '../src/core/rules.js';
import { ABANDONED } from '../src/core/rules.js';
import { regexRisk } from '../src/core/regex-risk.js';
import { nodeRulesRunner } from '../src/cli/rules-worker.js';
import { runCli } from './helpers/cli.js';

/*
 * [R1] A rules file is a file like any other: copied from a wiki, a ticket, a
 * colleague. `(a+)+$` against forty letters and a « ! » held the command line
 * for minutes and froze the page, which keeps rules from one visit to the next.
 */

const rule = (pattern: string, id = 'r') => `rules:\n  - id: ${id}\n    label: Règle ${id}\n    level: confirmed\n    pattern: '${pattern}'\n`;

describe('[R1] patterns that can take exponential time are refused when read', () => {
  it('refuses the brief’s pattern at once, naming the rule and the part', () => {
    const start = performance.now();
    expect(() => parseRules(rule('(a+)+$'))).toThrow(RulesError);
    expect(() => parseRules(rule('(a+)+$'))).toThrow(/rule r: pattern refused, its time can grow exponentially \(a repetition inside a repeated group\): \(a\+\)\+/);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it.each(['(a+)+$', '(\\w+\\s?)+$', '(.*a)+', '(a*)*', '((a+)b?)+', '(x+x+)+y', '(?:a+){2,}'])('a repetition inside a repeated group: %s', (pattern) => {
    expect(regexRisk(pattern)?.kind).toBe('nested-quantifier');
  });

  it.each(['(a|ab)+$', '(a|)+', '(\\w|\\d)+', '(\\d+|\\d+\\.)+'])('alternatives that can match the same text, repeated: %s', (pattern) => {
    expect(regexRisk(pattern)?.kind).toBe('ambiguous-alternation');
  });

  it.each([
    '(\\d{2,4}-)+',
    '(?:foo|bar)+',
    'DOS-\\d{6}',
    '[a-z0-9-]+\\.corp\\.exemple',
    '(?:\\d{3}[ -]?)+',
    '\\b(?:ACME|Orion)-\\d+\\b',
    '^(?:\\+33|0)[1-9](?:[ .-]?\\d{2}){4}$',
    '[\\w.+-]+@[\\w-]+\\.[\\w.]+',
    '(?:\\w+\\.)+\\w+',
    '(?<!\\w)x(?=y)',
  ])('a pattern that leaves one way to match is kept: %s', (pattern) => {
    expect(regexRisk(pattern)).toBeUndefined();
  });
});

describe('[R1] a rule that is merely slow is stopped at its time budget', () => {
  const slow = parseRules(`${rule('\\d*\\d*\\d*!', 'lente')}  - id: projet\n    label: Projet\n    words: [Orion]\n  - id: ref\n    label: Référence\n    pattern: 'REF-\\d+'\n`);
  const text = `Orion REF-42 ${'1'.repeat(20_000)}`;

  it('abandons it, says so at the rule’s level, and still runs the others', async () => {
    const start = performance.now();
    const found = await nodeRulesRunner(500)([{ text, location: 'document body' }], slow);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(found.map((f) => [f.label, f.value])).toEqual([
      ['Projet', 'Orion'],
      ['Référence', 'REF-42'],
      [ABANDONED, 'Règle lente'],
    ]);
    expect(found.find((f) => f.label === ABANDONED)?.confidence).toBe('confirmed');
  });

  it('gives what the rules give in this thread when none overruns', async () => {
    const rules = parseRules(`${rule('REF-\\d+')}  - id: projet\n    label: Projet\n    words: [Orion]\n`);
    const found = await nodeRulesRunner()([{ text: 'Orion REF-1 REF-2', location: 'a' }, { text: 'REF-3', location: 'b' }], rules);
    expect(found.map((f) => [f.location, f.value])).toEqual([
      ['a', 'REF-1'],
      ['a', 'REF-2'],
      ['a', 'Orion'],
      ['b', 'REF-3'],
    ]);
  });
});

describe('[R1] from the command line', () => {
  const dir = (files: Record<string, string>) => {
    const d = mkdtempSync(join(tmpdir(), 'cirta-r1-'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text);
    return d;
  };

  it('refuses the brief’s rule in under two seconds more than a harmless one, in French', () => {
    const d = dir({ 'a.txt': `${'a'.repeat(40)}!`, 'bad.yaml': rule('(a+)+$'), 'ok.yaml': rule('b+') });
    let start = performance.now();
    runCli(['inspect', '--rules', join(d, 'ok.yaml'), join(d, 'a.txt')]);
    const baseline = performance.now() - start;
    start = performance.now();
    const run = runCli(['inspect', '--lang', 'fr', '--rules', join(d, 'bad.yaml'), join(d, 'a.txt')]);
    expect(performance.now() - start - baseline).toBeLessThan(2000);
    expect(run.status).toBe(2);
    expect(run.stderr.toString()).toContain('règle r : motif refusé, son temps peut croître de façon exponentielle (une répétition dans un groupe répété) : (a+)+');
  });

  it('reports a rule it had to stop, and verify fails on it', () => {
    const d = dir({ 'n.txt': `${'1'.repeat(20_000)}`, 'slow.yaml': rule('\\d*\\d*\\d*!', 'lente') });
    const inspect = runCli(['inspect', '--lang', 'fr', '--rules', join(d, 'slow.yaml'), join(d, 'n.txt')]);
    expect(inspect.stdout.toString()).toContain('Règle abandonnée : trop lente');
    expect(inspect.stdout.toString()).toContain('Règle lente');
    expect(runCli(['verify', '--rules', join(d, 'slow.yaml'), join(d, 'n.txt')]).status).toBe(1);
  });
});

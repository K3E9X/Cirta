/**
 * [R1] Whether a pattern someone wrote can take exponential time.
 *
 * A rules file is the user's, but it is also a file: copied from a colleague,
 * a wiki, a ticket. `(a+)+$` against forty letters and an exclamation mark
 * held the command line for minutes, and in the browser it froze the analysis
 * for good, as the rules are kept from one visit to the next.
 *
 * Two families account for the exponential cases, and both can be read off
 * the pattern before it runs:
 *
 * - a repeated group whose inside can itself repeat, where one run can end
 *   and the next begin on the same character: `(a+)+`, `(\w+\s?)+`, `(.*a)+`;
 * - a repeated alternation whose branches can start the same way, or one of
 *   which matches nothing: `(a|ab)+`, `(\w|\d)+`, `(a|)+`.
 *
 * `(\d{2,4}-)+` and `(?:foo|bar)+` are not refused: a separator, or branches
 * that start differently, leave one way to match. What this cannot see — a
 * pattern that is merely quadratic, `\d*\d*!` — is stopped at run time by the
 * interfaces, which give each rule a time budget (rules-runner.ts).
 *
 * The pattern is known to compile; this reads it, it does not validate it.
 */

/** A set of characters, as which of the probe characters it contains. */
type CharSet = Uint8Array;

/** Every Latin character, then one in 64 of the rest of the basic plane, then a few beyond it. */
const PROBES: string[] = (() => {
  const out: string[] = [];
  for (let c = 0; c < 0x180; c++) out.push(String.fromCharCode(c));
  for (let c = 0x180; c < 0x10000; c += 64) if (c < 0xd800 || c > 0xdfff) out.push(String.fromCharCode(c));
  out.push(' ', ' ', '​', '\u{1f600}', '\u{20000}');
  return out;
})();

const empty = (): CharSet => new Uint8Array(PROBES.length);
const full = (): CharSet => new Uint8Array(PROBES.length).fill(1);
const union = (a: CharSet, b: CharSet): CharSet => a.map((x, i) => x | b[i]!);
const overlaps = (a: CharSet, b: CharSet): boolean => a.some((x, i) => x === 1 && b[i] === 1);

type Node =
  | { type: 'char'; set: CharSet }
  | { type: 'assert' }
  | { type: 'seq'; items: Node[] }
  | { type: 'alt'; branches: Node[] }
  | { type: 'group'; body: Node; look: boolean }
  | { type: 'repeat'; body: Node; min: number; max: number; source: string };

class Reader {
  at = 0;
  constructor(
    readonly text: string,
    readonly flags: string,
  ) {}

  /** The set a one-character piece of the pattern matches, found by asking the engine. */
  set(source: string): CharSet {
    const test = new RegExp(`^(?:${source})$`, this.flags.replace(/[gmy]/g, ''));
    const set = empty();
    PROBES.forEach((probe, i) => (set[i] = test.test(probe) ? 1 : 0));
    return set;
  }

  alternation(): Node {
    const branches = [this.sequence()];
    while (this.text[this.at] === '|') {
      this.at++;
      branches.push(this.sequence());
    }
    return branches.length === 1 ? branches[0]! : { type: 'alt', branches };
  }

  sequence(): Node {
    const items: Node[] = [];
    while (this.at < this.text.length && this.text[this.at] !== '|' && this.text[this.at] !== ')') {
      const start = this.at;
      const atom = this.atom();
      items.push(this.quantified(atom, start));
    }
    return { type: 'seq', items };
  }

  quantified(atom: Node, start: number): Node {
    const c = this.text[this.at];
    let min = -1;
    let max = -1;
    if (c === '*' || c === '+' || c === '?') {
      min = c === '+' ? 1 : 0;
      max = c === '?' ? 1 : Infinity;
      this.at++;
    } else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(this.text.slice(this.at, this.at + 24));
      if (m) {
        min = Number(m[1]);
        max = m[2] === undefined ? min : m[3] ? Number(m[3]) : Infinity;
        this.at += m[0].length;
      }
    }
    if (min < 0) return atom;
    if (this.text[this.at] === '?') this.at++;
    if (atom.type === 'assert') return atom;
    return this.quantified({ type: 'repeat', body: atom, min, max, source: this.text.slice(start, this.at) }, start);
  }

  atom(): Node {
    const c = this.text[this.at]!;
    if (c === '(') return this.group();
    if (c === '[') return this.characterClass();
    if (c === '\\') return this.escape();
    this.at++;
    if (c === '^' || c === '$') return { type: 'assert' };
    if (c === '.') return { type: 'char', set: this.set('.') };
    return { type: 'char', set: this.set(c.replace(/[.*+?^${}()|[\]\\/]/, '\\$&')) };
  }

  group(): Node {
    const head = /^\((\?(?:[:=!]|<[=!]|<[^>]*>|[a-z-]*:))?/.exec(this.text.slice(this.at, this.at + 64))![0];
    this.at += head.length;
    const look = /^\(\?<?[=!]$/.test(head);
    const body = this.alternation();
    this.at++; // ')'
    return look ? { type: 'assert' } : { type: 'group', body, look };
  }

  characterClass(): Node {
    const start = this.at;
    this.at++;
    if (this.text[this.at] === '^') this.at++;
    // `[]` and `[^]` close at once in JavaScript.
    while (this.at < this.text.length && this.text[this.at] !== ']') this.at += this.text[this.at] === '\\' ? 2 : 1;
    this.at++;
    return { type: 'char', set: this.set(this.text.slice(start, this.at)) };
  }

  escape(): Node {
    const rest = this.text.slice(this.at, this.at + 16);
    if (/^\\[bB]/.test(rest)) {
      this.at += 2;
      return { type: 'assert' };
    }
    // A back-reference matches whatever its group took: anything, for this purpose.
    const backref = /^\\(?:[1-9]\d*|k<[^>]*>)/.exec(rest);
    if (backref) {
      this.at += backref[0].length;
      return { type: 'char', set: full() };
    }
    const m = /^\\(?:[pP]\{[^}]*\}|x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|c[a-zA-Z]|0|[\s\S])/.exec(rest)!;
    this.at += m[0].length;
    return { type: 'char', set: this.set(m[0]) };
  }
}

/** Whether a node can match nothing, and the characters it can start with. */
function nullable(node: Node): boolean {
  switch (node.type) {
    case 'char':
      return false;
    case 'assert':
      return true;
    case 'seq':
      return node.items.every(nullable);
    case 'alt':
      return node.branches.some(nullable);
    case 'group':
      return nullable(node.body);
    case 'repeat':
      return node.min === 0 || nullable(node.body);
  }
}

function first(node: Node): CharSet {
  switch (node.type) {
    case 'char':
      return node.set;
    case 'assert':
      return empty();
    case 'seq': {
      let set = empty();
      for (const item of node.items) {
        set = union(set, first(item));
        if (!nullable(item)) break;
      }
      return set;
    }
    case 'alt':
      return node.branches.map(first).reduce(union, empty());
    case 'group':
      return first(node.body);
    case 'repeat':
      return first(node.body);
  }
}

export type RegexRisk = { kind: 'nested-quantifier' | 'ambiguous-alternation'; near: string };

/**
 * Inside a repeated group: each inner repetition, with what can follow it
 * within one turn — wrapping to the group's start when the rest can be empty.
 */
function inside(node: Node, follow: CharSet, outer: string): RegexRisk | undefined {
  switch (node.type) {
    case 'char':
    case 'assert':
      return undefined;
    case 'group':
      return inside(node.body, follow, outer);
    case 'seq': {
      for (let i = 0; i < node.items.length; i++) {
        const rest: Node = { type: 'seq', items: node.items.slice(i + 1) };
        const next = nullable(rest) ? union(first(rest), follow) : first(rest);
        const risk = inside(node.items[i]!, next, outer);
        if (risk) return risk;
      }
      return undefined;
    }
    case 'alt': {
      const firsts = node.branches.map(first);
      for (let i = 0; i < firsts.length; i++) {
        if (nullable(node.branches[i]!)) return { kind: 'ambiguous-alternation', near: outer };
        for (let j = i + 1; j < firsts.length; j++) if (overlaps(firsts[i]!, firsts[j]!)) return { kind: 'ambiguous-alternation', near: outer };
      }
      for (const branch of node.branches) {
        const risk = inside(branch, follow, outer);
        if (risk) return risk;
      }
      return undefined;
    }
    case 'repeat': {
      // A run of fixed length ends where it must; one that can stop early and
      // whose characters can also start what follows can split two ways.
      if (node.max > 1 && node.min !== node.max && overlaps(first(node.body), follow)) return { kind: 'nested-quantifier', near: outer };
      return inside(node.body, node.max > 1 ? union(follow, first(node.body)) : follow, outer);
    }
  }
}

function walk(node: Node): RegexRisk | undefined {
  switch (node.type) {
    case 'char':
    case 'assert':
      return undefined;
    case 'group':
      return walk(node.body);
    case 'seq':
      for (const item of node.items) {
        const risk = walk(item);
        if (risk) return risk;
      }
      return undefined;
    case 'alt':
      for (const branch of node.branches) {
        const risk = walk(branch);
        if (risk) return risk;
      }
      return undefined;
    case 'repeat':
      if (node.max > 1) {
        const risk = inside(node.body, first(node.body), node.source);
        if (risk) return risk;
        // A body that can match nothing can repeat any number of times between two characters.
        if (nullable(node.body)) return { kind: 'nested-quantifier', near: node.source };
      }
      return walk(node.body);
  }
}

/** The first part of a pattern that can make it take exponential time, if any. */
export function regexRisk(pattern: string, flags = ''): RegexRisk | undefined {
  const reader = new Reader(pattern, flags);
  const tree = reader.alternation();
  return walk(tree);
}

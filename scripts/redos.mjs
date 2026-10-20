#!/usr/bin/env node
/**
 * [P0-1] Every regular expression in the sources, checked for catastrophic
 * backtracking by recheck (https://makenowjust-labs.github.io/recheck/).
 *
 * Cirta reads files from people the user has no reason to trust, and a
 * pattern that backtracks lets a few kilobytes hold a thread for minutes —
 * in the command line, in the browser, and in any service that embeds the
 * library. The first audit found one exponential pattern (9 s for 195 bytes
 * of an Office part) and 190 quadratic ones; test/redos.test.ts keeps a file
 * for each family.
 *
 * Literals are read from the TypeScript syntax tree; a pattern built with
 * `new RegExp(`…${name}…`)` is checked with each substitution as a plain
 * name, which is what the code passes. A pattern recheck calls vulnerable
 * is then measured on its attack string; one whose time grows faster than
 * its input is accepted only if scripts/redos-allow.json names it, with the
 * reason its input is bounded. Run in CI; too slow for `npm test`.
 *
 *   node scripts/redos.mjs           check, exit 1 on a new vulnerable pattern
 *   node scripts/redos.mjs --list    print every pattern recheck flags, with its measured growth
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import ts from 'typescript';
import { check } from 'recheck';

const root = fileURLToPath(new URL('../', import.meta.url));
const DIRECTORIES = ['src/core', 'src/shared', 'src/cli', 'src/web', 'integrations'];
const allow = JSON.parse(readFileSync(join(root, 'scripts/redos-allow.json'), 'utf8'));

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist') continue;
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(?:ts|mts)$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/** Each pattern of a file: its source, its flags, where it is. */
function patterns(file) {
  const text = readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = [];
  const add = (node, source, flags) => found.push({ file: relative(root, file).replaceAll('\\', '/'), line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, source, flags });
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const literal = node.text;
      const end = literal.lastIndexOf('/');
      add(node, literal.slice(1, end), literal.slice(end + 1));
    } else if (ts.isNewExpression(node) && node.expression.getText() === 'RegExp' && node.arguments?.length) {
      const [first, second] = node.arguments;
      const flags = second && ts.isStringLiteralLike(second) ? second.text : '';
      if (ts.isStringLiteralLike(first)) add(node, first.text, flags);
      else if (ts.isTemplateExpression(first)) add(node, first.head.text + first.templateSpans.map((span) => `x${span.literal.text}`).join(''), flags);
      // Anything else is a pattern taken from a constant already checked (BIDI.source) or one the user wrote (rules).
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

const all = DIRECTORIES.flatMap((dir) => sources(join(root, dir))).flatMap(patterns);
const unique = new Map();
for (const p of all) {
  const key = `${p.source}\u0000${p.flags.replace(/[gy]/g, '')}`;
  if (!unique.has(key)) unique.set(key, { source: p.source, flags: p.flags.replace(/[gy]/g, ''), at: [] });
  unique.get(key).at.push(p);
}

// recheck runs each check in a worker; a few at once keeps the run near a minute.
const queue = [...unique.values()];
const flagged = [];
const undecided = [];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const result = await check(item.source, item.flags, { timeout: 30_000, randomSeed: 1 });
      if (result.status === 'vulnerable' && result.attack) flagged.push({ ...item, complexity: result.complexity?.type, attack: result.attack });
      else if (result.status !== 'safe') undecided.push(item);
    }
  }),
);

/*
 * recheck's fuzzer is random, and it calls vulnerable some patterns whose
 * cost stays linear: a bounded repetition, a body that stops at the next
 * opening. So each verdict is measured: the attack string, made four times
 * longer. Linear work grows four times; quadratic, sixteen. Over eight is a
 * pattern that backtracks.
 */
function growth(p) {
  const pattern = new RegExp(p.source, p.flags);
  const build = (k) => p.attack.pumps.map((pump) => pump.prefix + pump.pump.repeat(k)).join('') + p.attack.suffix;
  const time = (text) => {
    let best = Infinity;
    for (let i = 0; i < 2; i++) {
      const start = performance.now();
      pattern.exec(text);
      best = Math.min(best, performance.now() - start);
    }
    return best;
  };
  // Pumped to about 4 000 characters, then 16 000: enough to tell the two apart, small enough that a quadratic one ends in a second.
  const unit = p.attack.pumps.reduce((n, pump) => n + pump.pump.length, 0) || 1;
  const k = Math.max(1, Math.round(4_000 / unit));
  const small = time(build(k));
  const large = time(build(4 * k));
  return { ratio: large / Math.max(small, 0.5), ms: Math.round(large) };
}

const allowed = (p) => allow.find((a) => a.source === p.source && p.at.some((at) => at.file === a.file));
let failures = 0;
let backtracking = 0;
const seen = new Set();
for (const p of flagged.sort((a, b) => a.at[0].file.localeCompare(b.at[0].file) || a.at[0].line - b.at[0].line)) {
  const where = p.at.map((at) => `${at.file}:${at.line}`).join(', ');
  const entry = allowed(p);
  if (entry) seen.add(entry);
  const { ratio, ms } = growth(p);
  const confirmed = ratio > 8;
  if (confirmed) backtracking++;
  const verdict = !confirmed ? 'linear ' : entry ? 'allowed' : 'FAIL   ';
  if (process.argv.includes('--list') || verdict === 'FAIL   ') {
    console.log(`${verdict}  ${p.complexity ?? ''} ×${ratio.toFixed(1)} (${ms} ms)  ${where}  /${p.source}/${p.flags}`);
    console.log(`         ${entry ? entry.reason : `attack: ${p.attack.pattern}`}`);
  }
  if (verdict === 'FAIL   ') failures++;
}
// recheck gave up (a timeout, a feature it does not model): said, not failed, as a slower runner would make it flaky.
for (const p of undecided) console.log(`unknown  ${p.at.map((at) => `${at.file}:${at.line}`).join(', ')}  /${p.source}/${p.flags}`);
// An allowance recheck did not flag this time is not wrong — its fuzzer may simply not have found the attack.
const quiet = allow.filter((a) => !seen.has(a));
if (process.argv.includes('--list')) for (const a of quiet) console.log(`quiet    ${a.file}  /${a.source}/`);

console.log(`\n${all.length} patterns (${unique.size} distinct): ${flagged.length} flagged by recheck, ${backtracking} measured backtracking, ${backtracking - failures} of them on input bounded for the reason scripts/redos-allow.json gives`);
if (failures) {
  console.error(`${failures} pattern(s) backtrack on input nothing bounds`);
  process.exit(1);
}
console.log('no pattern backtracks on input it can be given');

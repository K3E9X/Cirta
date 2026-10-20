/**
 * [F-2.3] An organisation's own rules: the names of internal projects, its
 * private domains, the prefixes of its identifiers. Each rule has a label and
 * a level and matches either a list of words (whole words, any case) or a
 * regular expression. The file is YAML — the small subset rules need — or
 * JSON; anything it cannot read is refused with the rule and the reason.
 *
 * A pattern is the author's own and runs as written: a pattern that
 * backtracks badly is slow on long documents, as it would be anywhere.
 */

import type { Confidence, Finding, FindingKind } from './types.js';
import { preview } from './types.js';
import { UnsupportedFormatError } from './errors.js';

export interface Rule {
  id: string;
  label: string;
  level: Confidence;
  kind: FindingKind;
  words?: string[];
  pattern?: string;
  flags?: string;
  /** Compiled once, global. */
  regex: RegExp;
}

/** A rules file that cannot be read: refused, with the line or the rule and why. */
export class RulesError extends UnsupportedFormatError {
  constructor(detail: string) {
    super(`Rules file not read: ${detail}`, 'rules-invalid', detail);
    this.name = 'RulesError';
  }
}

const LEVELS = new Set(['confirmed', 'probable', 'informational']);
const KINDS = new Set(['identity', 'provenance', 'timestamp', 'environment', 'invisible-character', 'deceptive-link', 'active-content', 'deceptive-name']);
const MAX_RULES = 500;
const MAX_PER_RULE = 50;
const MAX_TEXT = 4 * 1024 * 1024;

/* ------------------------------------------------------------ YAML subset -- */

interface Line {
  indent: number;
  text: string;
  number: number;
}

function stripComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
}

function scalar(raw: string, at: number): unknown {
  const text = raw.trim();
  if (text.startsWith('[') && text.endsWith(']')) {
    const items: string[] = [];
    let current = '';
    let quote = '';
    for (let i = 1; i < text.length - 1; i++) {
      const c = text[i]!;
      if (quote) {
        current += c;
        if (c === '\\' && quote === '"') current += text[++i] ?? '';
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
        current += c;
      } else if (c === ',') {
        items.push(current);
        current = '';
      } else current += c;
    }
    if (current.trim()) items.push(current);
    return items.map((item) => String(scalar(item, at)));
  }
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new RulesError(`line ${at}: unterminated string`);
    return text.slice(1, -1).replace(/\\(.)/g, (_, c: string) => ({ n: '\n', t: '\t', '"': '"', '\\': '\\' })[c] ?? `\\${c}`);
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new RulesError(`line ${at}: unterminated string`);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

function block(lines: Line[], start: number, indent: number): { value: unknown; next: number } {
  const first = lines[start];
  if (!first) return { value: undefined, next: start };
  if (first.text.startsWith('- ') || first.text === '-') {
    const list: unknown[] = [];
    let i = start;
    while (i < lines.length && lines[i]!.indent === indent && (lines[i]!.text.startsWith('- ') || lines[i]!.text === '-')) {
      const line = lines[i]!;
      const rest = line.text.slice(1).trimStart();
      const inner = line.indent + (line.text.length - rest.length);
      if (!rest) {
        const nested = block(lines, i + 1, lines[i + 1]?.indent ?? inner);
        list.push(nested.value);
        i = nested.next;
      } else if (/^[^"'[][^:]*:(\s|$)/.test(rest)) {
        // "- key: value" opens a mapping whose other keys sit under "key".
        const virtual: Line[] = [{ indent: inner, text: rest, number: line.number }];
        let j = i + 1;
        while (j < lines.length && lines[j]!.indent > indent) virtual.push(lines[j++]!);
        list.push(block(virtual, 0, inner).value);
        i = j;
      } else {
        list.push(scalar(rest, line.number));
        i++;
      }
    }
    return { value: list, next: i };
  }
  const map: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length && lines[i]!.indent === indent) {
    const line = lines[i]!;
    const m = /^([^:]+):(?:\s+(?!\s)(.*))?$/.exec(line.text);
    if (!m) throw new RulesError(`line ${line.number}: expected "key: value"`);
    const key = m[1]!.trim();
    if (m[2] !== undefined && m[2].trim() !== '') {
      map[key] = scalar(m[2], line.number);
      i++;
    } else {
      const child = lines[i + 1];
      if (child && child.indent > indent) {
        const nested = block(lines, i + 1, child.indent);
        map[key] = nested.value;
        i = nested.next;
      } else {
        map[key] = undefined;
        i++;
      }
    }
  }
  if (i < lines.length && lines[i]!.indent > indent) throw new RulesError(`line ${lines[i]!.number}: unexpected indentation`);
  return { value: map, next: i };
}

function parseYaml(text: string): unknown {
  const lines: Line[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    if (raw.includes('\t')) throw new RulesError(`line ${index + 1}: tabs are not allowed in indentation`);
    const content = stripComment(raw).trimEnd();
    if (!content.trim() || content.trim() === '---') return;
    lines.push({ indent: content.length - content.trimStart().length, text: content.trim(), number: index + 1 });
  });
  if (!lines.length) return undefined;
  return block(lines, 0, lines[0]!.indent).value;
}

/* ------------------------------------------------------------------ rules -- */

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseRules(text: string): Rule[] {
  const trimmed = text.trim();
  let data: unknown;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      data = JSON.parse(trimmed);
    } catch (error) {
      throw new RulesError(`not valid JSON: ${(error as Error).message}`);
    }
  } else data = parseYaml(text);
  const list = Array.isArray(data) ? data : (data as { rules?: unknown } | undefined)?.rules;
  if (!Array.isArray(list)) throw new RulesError('expected a list of rules, under "rules:"');
  if (list.length > MAX_RULES) throw new RulesError(`at most ${MAX_RULES} rules`);

  return list.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new RulesError(`rule ${index + 1}: expected a mapping`);
    const raw = entry as Record<string, unknown>;
    const id = String(raw.id ?? `rule-${index + 1}`);
    const where = `rule ${id}`;
    const label = raw.label === undefined ? undefined : String(raw.label);
    if (!label) throw new RulesError(`${where}: a label is required`);
    const level = String(raw.level ?? 'probable');
    if (!LEVELS.has(level)) throw new RulesError(`${where}: level must be confirmed, probable or informational`);
    const kind = String(raw.kind ?? 'identity');
    if (!KINDS.has(kind)) throw new RulesError(`${where}: unknown kind ${kind}`);
    const words = raw.words === undefined ? undefined : Array.isArray(raw.words) ? raw.words.map(String).filter((w) => w.trim()) : [String(raw.words)];
    const pattern = raw.pattern === undefined ? undefined : String(raw.pattern);
    const flags = raw.flags === undefined ? '' : String(raw.flags);
    if (!words?.length && !pattern) throw new RulesError(`${where}: give words or a pattern`);
    if (!/^[imsu]*$/.test(flags)) throw new RulesError(`${where}: flags may only be i, m, s, u`);
    let regex: RegExp;
    try {
      regex = pattern
        ? new RegExp(pattern, `g${flags}`)
        : new RegExp(`(?<![\\p{L}\\p{N}])(?:${words!.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
    } catch (error) {
      throw new RulesError(`${where}: ${(error as Error).message}`);
    }
    return { id, label, level: level as Confidence, kind: kind as FindingKind, words, pattern, flags, regex };
  });
}

export function ruleFindings(input: string, rules: Rule[], location: string): Finding[] {
  const text = input.length > MAX_TEXT ? input.slice(0, MAX_TEXT) : input;
  const findings: Finding[] = [];
  for (const rule of rules) {
    const seen = new Set<string>();
    rule.regex.lastIndex = 0;
    for (const m of text.matchAll(rule.regex)) {
      if (!m[0] || seen.has(m[0]) || seen.size >= MAX_PER_RULE) continue;
      seen.add(m[0]);
      findings.push({ kind: rule.kind, confidence: rule.level, location, label: rule.label, value: preview(m[0], 200) });
    }
  }
  return findings;
}

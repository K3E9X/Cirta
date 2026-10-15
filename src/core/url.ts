/**
 * Links that read as one address and resolve to another.
 *
 * This is the same deception the rest of the tool looks for — characters that
 * are not what they appear to be — applied where it does the most damage. A
 * zero-width space in a paragraph leaks a mark; a Cyrillic `а` in a hostname
 * takes somebody's password.
 *
 * The case that matters is the one an ordinary mixed-script check misses.
 * `аpple.com` with one Cyrillic letter mixes two scripts and is easy to catch.
 * `аррӏе.com` is written *entirely* in Cyrillic — no mixture, every character
 * from one consistent script — and renders pixel-for-pixel as `apple.com`. That
 * is the whole-script confusable Xudong Zheng demonstrated in 2017 against
 * every major browser, and it is why this module compares a label's *skeleton*
 * rather than counting its scripts.
 *
 * What is deliberately not here: guessing at brands. A list of names to protect
 * would be a maintenance treadmill, would miss every target not on it, and
 * would accuse a legitimate site that happens to resemble one. The report says
 * what the address is built from and what it renders as, and leaves the reader
 * to recognise what it imitates. That is the same line the credential scan
 * draws when it refuses to match product names.
 *
 * Nothing here is ever rewritten. Editing a link in someone's document changes
 * where it goes, which is a decision no tool should make silently.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';

/* ------------------------------------------------------------- punycode -- */

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

/**
 * Decode one `xn--` label back to the characters a browser displays.
 *
 * RFC 3492, written out rather than pulled from a dependency: the whole point
 * of this tool is that it ships no network calls and few moving parts, and the
 * algorithm is forty lines. Returns undefined for anything malformed, because a
 * label that does not decode is not a claim worth making.
 */
export function decodePunycode(label: string): string | undefined {
  const input = label.toLowerCase().startsWith('xn--') ? label.slice(4) : undefined;
  if (input === undefined) return undefined;

  const delimiter = input.lastIndexOf('-');
  const output: number[] = [];
  if (delimiter > 0) {
    for (const char of input.slice(0, delimiter)) {
      const cp = char.codePointAt(0)!;
      if (cp >= 0x80) return undefined; // basic section must be ASCII
      output.push(cp);
    }
  }

  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  let index = delimiter > 0 ? delimiter + 1 : 0;
  if (index >= input.length) return undefined;

  while (index < input.length) {
    const previous = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) return undefined;
      const code = input.charCodeAt(index++);
      const digit =
        code >= 0x30 && code <= 0x39 ? code - 0x30 + 26
        : code >= 0x61 && code <= 0x7a ? code - 0x61
        : code >= 0x41 && code <= 0x5a ? code - 0x41
        : BASE;
      if (digit >= BASE) return undefined;
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
      if (!Number.isSafeInteger(i) || !Number.isSafeInteger(w)) return undefined;
    }
    bias = adapt(i - previous, output.length + 1, previous === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    if (n > 0x10ffff) return undefined;
    output.splice(i++, 0, n);
  }

  try {
    return String.fromCodePoint(...output);
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------- skeleton -- */

/**
 * Characters that render as a Latin letter without being one.
 *
 * A curated subset of the Unicode confusables data, not the whole of it: the
 * full table is tens of thousands of entries, most of them mappings no attacker
 * would reach for, and shipping it would dwarf the rest of this package. What
 * is here covers the Cyrillic and Greek letters that are pixel-identical to
 * Latin in ordinary fonts, which is what every demonstrated IDN attack has used,
 * plus the fullwidth forms. A homograph built from something rarer will not be
 * named — the mixed-script and non-Latin checks below still catch it.
 */
const CONFUSABLE = new Map<string, string>([
  // Cyrillic
  ['а', 'a'], ['б', '6'], ['в', 'b'], ['г', 'r'], ['е', 'e'], ['ѕ', 's'],
  ['і', 'i'], ['ј', 'j'], ['к', 'k'], ['м', 'm'], ['н', 'h'], ['о', 'o'],
  ['р', 'p'], ['с', 'c'], ['т', 't'], ['у', 'y'], ['х', 'x'], ['ԁ', 'd'],
  ['ӏ', 'l'], ['ԛ', 'q'], ['ԝ', 'w'], ['ғ', 'f'], ['ҽ', 'e'], ['ƅ', 'b'],
  // Greek
  ['α', 'a'], ['ο', 'o'], ['ρ', 'p'], ['ν', 'v'], ['κ', 'k'], ['τ', 't'],
  ['υ', 'u'], ['χ', 'x'], ['ι', 'i'], ['ε', 'e'], ['σ', 'o'], ['μ', 'u'],
  ['γ', 'y'], ['η', 'n'], ['ϲ', 'c'], ['ϳ', 'j'], ['ѵ', 'v'],
  // Armenian and Cherokee, both used in published proofs of concept
  ['օ', 'o'], ['ս', 'u'], ['ց', 'g'], ['ո', 'n'], ['Ꭺ', 'a'], ['Ꮯ', 'c'],
  ['Ꭼ', 'e'], ['Ꮋ', 'h'], ['Ꭻ', 'j'], ['Ꮶ', 'k'], ['Ꮮ', 'l'], ['Ꮲ', 'p'],
  // Latin letters carrying marks that vanish at small sizes
  ['ạ', 'a'], ['ȧ', 'a'], ['ḅ', 'b'], ['ċ', 'c'], ['ḍ', 'd'], ['ė', 'e'],
  ['ḥ', 'h'], ['ı', 'i'], ['ḷ', 'l'], ['ṃ', 'm'], ['ṇ', 'n'], ['ȯ', 'o'],
  ['ṛ', 'r'], ['ṣ', 's'], ['ṭ', 't'], ['ụ', 'u'], ['ẉ', 'w'], ['ỵ', 'y'],
]);

/**
 * What a label looks like, with every lookalike folded onto its Latin twin.
 *
 * Fullwidth forms fold by arithmetic rather than by table, and combining marks
 * are dropped: a dot under a letter disappears at the size a hostname is read
 * at, which is the whole point of using one.
 */
export function skeleton(label: string): string {
  let out = '';
  for (const char of label.normalize('NFD').replace(/\p{M}+/gu, '')) {
    const cp = char.codePointAt(0)!;
    if (cp >= 0xff21 && cp <= 0xff3a) out += String.fromCodePoint(cp - 0xff21 + 0x61);
    else if (cp >= 0xff41 && cp <= 0xff5a) out += String.fromCodePoint(cp - 0xff41 + 0x61);
    else out += CONFUSABLE.get(char.toLowerCase()) ?? char.toLowerCase();
  }
  return out;
}

/* ----------------------------------------------------------------- scan -- */

const SCRIPT_NAMES = [
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Cherokee', /\p{Script=Cherokee}/u],
  ['Han', /\p{Script=Han}/u],
] as const;

const LATIN = /\p{Script=Latin}/u;
const ASCII_HOST = /^[a-z0-9.-]+$/;

/** Format and ignorable characters have no business in a hostname at all. */
const INVISIBLE_IN_HOST = /[­​-‏⁠-⁤⁪-⁯﻿‪-‮⁦-⁩]/u;

/**
 * URLs as they appear in running text.
 *
 * Only explicit schemes are matched. A bare `example.com` in a sentence is a
 * word as often as it is an address, and reporting on every one of those would
 * bury the findings that matter under prose.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`)\]}]+/gi;

interface Deception {
  url: string;
  label: string;
  value: string;
  confidence: Finding['confidence'];
}

function examine(raw: string): Deception[] {
  const out: Deception[] = [];

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return out;
  }

  // The authority section before an "@" is credentials, not a destination.
  // A browser shown "https://paypal.com@evil.example" goes to evil.example,
  // and the part a reader recognises is the part that is ignored.
  if (parsed.username || parsed.password) {
    const shown = decodeURIComponent(parsed.username);
    out.push({
      url: raw,
      label: 'Link that reads as one site and resolves to another',
      value:
        `the part before "@" is a username, not a destination: this goes to ` +
        `${parsed.hostname}, while "${preview(shown, 40)}" is what a reader sees first`,
      confidence: 'confirmed',
    });
  }

  // punycode.hostname is already lowercased and IDNA-processed by URL, so read
  // the raw authority too — that is where an invisible character survives.
  const authority = raw.slice(raw.indexOf('//') + 2).split(/[/?#]/)[0] ?? '';
  if (INVISIBLE_IN_HOST.test(authority)) {
    out.push({
      url: raw,
      label: 'Invisible character inside a hostname',
      value: 'a format or bidi control sits in the authority, where nothing renders it',
      confidence: 'confirmed',
    });
  }

  for (const label of parsed.hostname.split('.')) {
    if (!label) continue;
    const decoded = decodePunycode(label);
    const display = decoded ?? label;
    if (/^[a-z0-9-]*$/.test(display)) continue; // plain ASCII label, nothing to say

    const scripts = SCRIPT_NAMES.filter(([, p]) => p.test(display)).map(([name]) => name);
    const hasLatin = LATIN.test(display);
    const folded = skeleton(display);

    if (scripts.length && hasLatin) {
      out.push({
        url: raw,
        label: 'Hostname mixing two alphabets',
        value:
          `"${display}" draws on Latin and ${scripts.join(' and ')} at once` +
          (decoded ? `, written in the address bar as ${label}` : '') +
          (ASCII_HOST.test(folded) ? ` — it renders as "${folded}"` : ''),
        confidence: 'confirmed',
      });
      continue;
    }

    // The dangerous shape: one consistent non-Latin script whose skeleton is
    // ordinary ASCII. No mixture to detect, and it renders as a name a reader
    // already trusts.
    if (scripts.length && !hasLatin && ASCII_HOST.test(folded) && folded !== display) {
      out.push({
        url: raw,
        label: 'Hostname written entirely in a lookalike alphabet',
        value:
          `"${display}" is ${scripts.join(' and ')} throughout, so nothing about it is mixed — ` +
          `but it renders as "${folded}"` +
          (decoded ? `. The address is really ${label}` : ''),
        confidence: 'confirmed',
      });
      continue;
    }

    if (decoded) {
      out.push({
        url: raw,
        label: 'Internationalised hostname',
        value: `${label} is displayed as "${display}" — legitimate for a non-Latin name, and the shape a homograph also takes`,
        confidence: 'informational',
      });
    }
  }

  return out;
}

/**
 * Deceptive links anywhere in a piece of text.
 *
 * Grouped one finding per distinct deception rather than per URL, so a document
 * repeating the same bad link reports it once.
 */
export function findDeceptiveUrls(text: string, location = 'links'): Finding[] {
  const seen = new Set<string>();
  const findings: Finding[] = [];

  for (const match of text.matchAll(URL_PATTERN)) {
    for (const found of examine(match[0])) {
      const key = `${found.label}\u0000${found.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        kind: 'invisible-character',
        confidence: found.confidence,
        location,
        label: found.label,
        value: `${preview(found.url, 60)} — ${found.value}`,
      });
    }
  }

  return findings;
}

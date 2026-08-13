/**
 * Detection and removal of invisible characters in text.
 *
 * IMPORTANT — what this does not do:
 * Anthropic's text watermark is a statistical signal in token choice, not a
 * character embedded in the string. Nothing in this file detects or removes it,
 * and no local tool can: reading that signal requires Anthropic's secret key.
 * This module handles a different and unrelated class of marking — codepoints
 * that render as nothing but survive copy/paste.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';

const CP = {
  SOFT_HYPHEN: 0x00ad,
  MONGOLIAN_VOWEL_SEP: 0x180e,
  ZWSP: 0x200b,
  ZWNJ: 0x200c,
  ZWJ: 0x200d,
  LRM: 0x200e,
  RLM: 0x200f,
  WORD_JOINER: 0x2060,
  ZWNBSP: 0xfeff,
  VS15: 0xfe0e,
  VS16: 0xfe0f,
} as const;

/** True for codepoints that render as nothing on their own. */
function isInvisible(cp: number): boolean {
  return (
    cp === CP.SOFT_HYPHEN ||
    cp === CP.MONGOLIAN_VOWEL_SEP ||
    (cp >= 0x200b && cp <= 0x200f) || // ZWSP..RLM
    (cp >= 0x202a && cp <= 0x202e) || // bidi embedding/override
    (cp >= 0x2060 && cp <= 0x2064) || // word joiner, invisible operators
    (cp >= 0x2066 && cp <= 0x2069) || // bidi isolates
    (cp >= 0x206a && cp <= 0x206f) || // deprecated format controls
    cp === CP.ZWNBSP ||
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors 1-16
    (cp >= 0xe0000 && cp <= 0xe007f) || // tag characters
    (cp >= 0xe0100 && cp <= 0xe01ef) // variation selectors 17-256
  );
}

function describe(cp: number): string {
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag character';
  if (cp >= 0xfe00 && cp <= 0xfe0f) return `variation selector ${cp - 0xfe00 + 1}`;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return `variation selector ${cp - 0xe0100 + 17}`;
  switch (cp) {
    case CP.SOFT_HYPHEN:
      return 'soft hyphen';
    case CP.MONGOLIAN_VOWEL_SEP:
      return 'Mongolian vowel separator';
    case CP.ZWSP:
      return 'zero-width space';
    case CP.ZWNJ:
      return 'zero-width non-joiner';
    case CP.ZWJ:
      return 'zero-width joiner';
    case CP.LRM:
      return 'left-to-right mark';
    case CP.RLM:
      return 'right-to-left mark';
    case CP.WORD_JOINER:
      return 'word joiner';
    case CP.ZWNBSP:
      return 'zero-width no-break space (BOM)';
    default:
      if (cp >= 0x202a && cp <= 0x202e) return 'bidirectional override';
      if (cp >= 0x2066 && cp <= 0x2069) return 'bidirectional isolate';
      return 'format control';
  }
}

/** Non-ASCII whitespace that renders as a space but is not U+0020. */
const EXOTIC_SPACES = new Map<number, string>([
  [0x00a0, 'no-break space'],
  [0x1680, 'Ogham space mark'],
  [0x2000, 'en quad'],
  [0x2001, 'em quad'],
  [0x2002, 'en space'],
  [0x2003, 'em space'],
  [0x2004, 'three-per-em space'],
  [0x2005, 'four-per-em space'],
  [0x2006, 'six-per-em space'],
  [0x2007, 'figure space'],
  [0x2008, 'punctuation space'],
  [0x2009, 'thin space'],
  [0x200a, 'hair space'],
  [0x202f, 'narrow no-break space'],
  [0x205f, 'medium mathematical space'],
  [0x3000, 'ideographic space'],
]);

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const LETTER = /\p{L}/u;

function isPictographic(cp: number | undefined): boolean {
  return cp !== undefined && PICTOGRAPHIC.test(String.fromCodePoint(cp));
}

function isLetter(cp: number | undefined): boolean {
  return cp !== undefined && LETTER.test(String.fromCodePoint(cp));
}

/**
 * Decide whether an invisible codepoint is doing legitimate typographic work.
 *
 * Emoji sequences and several writing systems rely on joiners and variation
 * selectors. Stripping those unconditionally corrupts "👩‍💻" into "👩💻" and
 * breaks Persian and Indic word forms, so they are preserved in the positions
 * where they carry meaning and removed everywhere else.
 */
function isFunctional(cp: number, prev: number | undefined, next: number | undefined): boolean {
  switch (cp) {
    case CP.ZWJ:
      // Emoji ZWJ sequence: 👨‍👩‍👧. Also joins Indic consonant clusters.
      return (isPictographic(prev) && isPictographic(next)) || (isLetter(prev) && isLetter(next));
    case CP.ZWNJ:
      // Persian/Arabic and Indic orthography place ZWNJ between letters.
      return isLetter(prev) && isLetter(next);
    case CP.VS15:
    case CP.VS16:
      // Selects text vs emoji presentation for the preceding character.
      return isPictographic(prev);
    default:
      return false;
  }
}

export class BinaryInputError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BinaryInputError';
  }
}

/**
 * Decode bytes as text, refusing anything that is not.
 *
 * Without this guard, piping a document into the text cleaner silently
 * destroys it: the bytes are decoded lossily, invisible-character removal is
 * applied to the wreckage, and the result is written back out. A PDF that goes
 * through it comes out larger and unparseable. Refusing is the only safe
 * answer, because there is no way to put the lost bytes back.
 */
export function decodeTextInput(data: Uint8Array): string {
  // A NUL byte does not occur in text and is the cheapest reliable signal.
  if (data.includes(0)) {
    throw new BinaryInputError('input contains NUL bytes, so it is not text');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new BinaryInputError('input is not valid UTF-8');
  }
}

export interface TextScan {
  findings: Finding[];
  /** Payloads recovered from steganographic encodings, if any. */
  decoded: string[];
}

/**
 * Recover data hidden in tag characters (U+E0000-E007F map to ASCII) and in
 * variation-selector byte encodings. Returns printable payloads only, so that
 * incidental emoji modifiers do not produce noise.
 */
function decodePayloads(codepoints: number[]): string[] {
  const out: string[] = [];

  const tagBytes = codepoints
    .filter((cp) => cp >= 0xe0001 && cp <= 0xe007f)
    .map((cp) => cp - 0xe0000);
  if (tagBytes.length >= 3) {
    const text = String.fromCharCode(...tagBytes);
    if (/^[\x20-\x7e\s]+$/.test(text)) out.push(`tag characters → "${text}"`);
  }

  // Variation-selector encoding: byte b → U+FE00+b (b<16) or U+E0100+(b-16).
  const vsBytes: number[] = [];
  for (const cp of codepoints) {
    if (cp >= 0xfe00 && cp <= 0xfe0f) vsBytes.push(cp - 0xfe00);
    else if (cp >= 0xe0100 && cp <= 0xe01ef) vsBytes.push(cp - 0xe0100 + 16);
  }
  if (vsBytes.length >= 3) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(vsBytes));
      if (/^[\x20-\x7e\s]+$/.test(text)) out.push(`variation selectors → "${text}"`);
    } catch {
      // Not valid UTF-8; the selectors are presentational rather than a payload.
    }
  }

  return out;
}

export function scanText(input: string): TextScan {
  const codepoints = [...input].map((c) => c.codePointAt(0)!);
  const counts = new Map<number, number>();
  const carriers: number[] = [];

  for (let i = 0; i < codepoints.length; i++) {
    const cp = codepoints[i]!;
    if (isInvisible(cp)) {
      if (isFunctional(cp, codepoints[i - 1], codepoints[i + 1])) continue;
      counts.set(cp, (counts.get(cp) ?? 0) + 1);
      carriers.push(cp);
    } else if (EXOTIC_SPACES.has(cp)) {
      counts.set(cp, (counts.get(cp) ?? 0) + 1);
    }
  }

  const findings: Finding[] = [];
  for (const [cp, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    const name = EXOTIC_SPACES.get(cp) ?? describe(cp);
    findings.push({
      kind: 'invisible-character',
      // Exotic whitespace is often ordinary typography — a non-breaking space
      // before a colon is a French convention, not a marker.
      confidence: EXOTIC_SPACES.has(cp) ? 'informational' : 'confirmed',
      location: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
      label: name,
      value: `${count} occurrence${count > 1 ? 's' : ''}`,
    });
  }

  // Bidi overrides are not just untidy. Boucher & Anderson showed they can
  // reorder how a reviewer reads source code while the compiler sees something
  // else (Trojan Source, CVE-2021-42574), so they are called out separately
  // rather than buried among the other format controls.
  const bidi = carriers.filter((cp) => (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069));
  if (bidi.length) {
    findings.unshift({
      kind: 'invisible-character',
      confidence: 'confirmed',
      location: 'bidirectional controls',
      label: 'Text reordering controls',
      value: `${bidi.length} control${bidi.length > 1 ? 's' : ''} that can make text display differently from how it is stored (CVE-2021-42574)`,
    });
  }

  return { findings, decoded: decodePayloads(carriers) };
}

export interface CleanTextOptions {
  /** Replace exotic whitespace with U+0020. Default true. */
  normalizeSpaces?: boolean;
  /** Apply Unicode NFC normalization. Default true. */
  normalize?: boolean;
}

export interface CleanTextResult {
  text: string;
  removed: Finding[];
  decoded: string[];
}

export function cleanText(input: string, options: CleanTextOptions = {}): CleanTextResult {
  const { normalizeSpaces = true, normalize = true } = options;
  const scan = scanText(input);

  const codepoints = [...input].map((c) => c.codePointAt(0)!);
  const kept: string[] = [];

  for (let i = 0; i < codepoints.length; i++) {
    const cp = codepoints[i]!;
    if (isInvisible(cp)) {
      if (isFunctional(cp, codepoints[i - 1], codepoints[i + 1])) kept.push(String.fromCodePoint(cp));
      continue;
    }
    if (normalizeSpaces && EXOTIC_SPACES.has(cp)) {
      kept.push(' ');
      continue;
    }
    kept.push(String.fromCodePoint(cp));
  }

  let text = kept.join('');
  if (normalize) text = text.normalize('NFC');

  return { text, removed: scan.findings, decoded: scan.decoded };
}

/** Render a short human-readable summary of a scan, used by CLI and web. */
export function summarizeText(scan: TextScan): string {
  if (scan.findings.length === 0) return 'No invisible characters found.';
  const total = scan.findings.reduce((n, f) => n + (parseInt(f.value, 10) || 0), 0);
  return `${total} invisible character${total > 1 ? 's' : ''} across ${scan.findings.length} type${
    scan.findings.length > 1 ? 's' : ''
  }${scan.decoded.length ? `; ${scan.decoded.map(preview).join(', ')}` : ''}`;
}

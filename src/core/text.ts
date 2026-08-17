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
  COMBINING_GRAPHEME_JOINER: 0x034f,
  ARABIC_LETTER_MARK: 0x061c,
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

/**
 * Format characters that belong to a writing system rather than to a carrier.
 *
 * Every one of these is category Cf, so the generic backstop below would strip
 * them — and that would be data loss, not cleaning. The Arabic number signs
 * prefix a numeral, the end-of-ayah marks punctuate Quranic text, and the
 * musical controls beam notes together. They are invisible, but they are what
 * the document says.
 */
function isScriptFunctional(cp: number): boolean {
  return (
    (cp >= 0x0600 && cp <= 0x0605) || // Arabic number signs
    cp === 0x06dd || // Arabic end of ayah
    cp === 0x070f || // Syriac abbreviation mark
    cp === 0x08e2 || // Arabic disputed end of ayah
    cp === 0x110bd || // Kaithi number sign
    cp === 0x110cd || // Kaithi number sign above
    (cp >= 0x1d173 && cp <= 0x1d17a) // musical beam/phrase/tie controls
  );
}

/**
 * True for codepoints that render as nothing on their own.
 *
 * The enumerated cases come first because they carry names worth reporting.
 * The `Cf` clause behind them is the backstop: Unicode keeps adding format
 * characters, and a list that only knows the ones written down here silently
 * passes every future carrier through. Several invisibles below are *not* `Cf`
 * — Hangul fillers are `Lo`, the Mongolian selectors and the grapheme joiner
 * are `Mn` — so the backstop replaces neither the list nor the reverse.
 */
function isInvisible(cp: number): boolean {
  return (
    cp === CP.SOFT_HYPHEN ||
    cp === CP.COMBINING_GRAPHEME_JOINER ||
    cp === CP.ARABIC_LETTER_MARK ||
    cp === 0x115f || // Hangul choseong filler
    cp === 0x1160 || // Hangul jungseong filler
    cp === 0x3164 || // Hangul filler — category Lo, so Unicode calls it a letter
    cp === 0xffa0 || // halfwidth Hangul filler
    cp === 0x2800 || // braille pattern blank, guarded below
    cp === 0x17b4 || // Khmer vowel inherent AQ
    cp === 0x17b5 || // Khmer vowel inherent AA
    (cp >= 0x180b && cp <= 0x180e) || // Mongolian free variation selectors, vowel separator
    (cp >= 0x200b && cp <= 0x200f) || // ZWSP..RLM
    (cp >= 0x202a && cp <= 0x202e) || // bidi embedding/override
    (cp >= 0x2060 && cp <= 0x2064) || // word joiner, invisible operators
    (cp >= 0x2066 && cp <= 0x2069) || // bidi isolates
    (cp >= 0x206a && cp <= 0x206f) || // deprecated format controls
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors 1-16
    (cp >= 0xfff9 && cp <= 0xfffb) || // interlinear annotation anchors
    cp === CP.ZWNBSP ||
    (cp >= 0xe0000 && cp <= 0xe007f) || // tag characters
    (cp >= 0xe0100 && cp <= 0xe01ef) || // variation selectors 17-256
    (!isScriptFunctional(cp) && OTHER_FORMAT.test(String.fromCodePoint(cp)))
  );
}

const OTHER_FORMAT = /\p{Cf}/u;

function describe(cp: number): string {
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag character';
  if (cp >= 0xfe00 && cp <= 0xfe0f) return `variation selector ${cp - 0xfe00 + 1}`;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return `variation selector ${cp - 0xe0100 + 17}`;
  switch (cp) {
    case CP.SOFT_HYPHEN:
      return 'soft hyphen';
    case CP.COMBINING_GRAPHEME_JOINER:
      return 'combining grapheme joiner';
    case CP.ARABIC_LETTER_MARK:
      return 'Arabic letter mark';
    case 0x115f:
    case 0x1160:
    case 0x3164:
    case 0xffa0:
      return 'Hangul filler';
    case 0x2800:
      return 'blank braille cell';
    case 0x17b4:
    case 0x17b5:
      return 'Khmer inherent vowel';
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
      if (cp >= 0x180b && cp <= 0x180d) return 'Mongolian free variation selector';
      if (cp >= 0x202a && cp <= 0x202e) return 'bidirectional override';
      if (cp >= 0x2066 && cp <= 0x2069) return 'bidirectional isolate';
      if (cp >= 0xfff9 && cp <= 0xfffb) return 'interlinear annotation anchor';
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

const isBraille = (cp: number | undefined): boolean =>
  cp !== undefined && cp >= 0x2800 && cp <= 0x28ff;

/**
 * Decide whether an invisible codepoint is doing legitimate typographic work.
 *
 * Emoji sequences and several writing systems rely on joiners and variation
 * selectors. Stripping those unconditionally corrupts "👩‍💻" into "👩💻" and
 * breaks Persian and Indic word forms, so they are preserved in the positions
 * where they carry meaning and removed everywhere else.
 */
function isFunctional(cp: number, prev: number | undefined, next: number | undefined): boolean {
  // A blank braille cell is a space *in braille*, and a carrier anywhere else.
  // Neighbouring braille is what tells the two apart.
  if (cp === 0x2800) return isBraille(prev) || isBraille(next);
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

/**
 * Why a byte string was refused as text.
 *
 * A code rather than a sentence, for the same reason notes are codes: the
 * library reports in English and each front-end words things for its own
 * audience. Without it the command line printed an English sentence above a
 * French explanation of the same refusal.
 */
export type BinaryReason = 'signature' | 'nul-bytes' | 'control-dense' | 'not-utf8';

export class BinaryInputError extends Error {
  readonly reason: BinaryReason;
  /** The format name, when `reason` is `'signature'`. */
  readonly signature?: string;

  constructor(reason: BinaryReason, message: string, signature?: string) {
    super(message);
    this.name = 'BinaryInputError';
    this.reason = reason;
    if (signature !== undefined) this.signature = signature;
  }
}

const latin1 = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

/**
 * Formats that are not text whatever their bytes happen to decode to.
 *
 * The NUL-byte test below catches most of these, but not reliably: a PDF whose
 * streams are uncompressed contains no NUL byte and is valid UTF-8, so it went
 * straight through the earlier guard and into the text cleaner. A signature is
 * a fact about the format rather than a guess about the bytes, so it is checked
 * first. Text formats this tool handles — SVG, HTML, Markdown — are deliberately
 * absent: they belong in the text path.
 */
const BINARY_SIGNATURES: ReadonlyArray<readonly [Uint8Array, string]> = [
  [latin1('PK\x03\x04'), 'a ZIP container (DOCX, ODT, XLSX, PPTX, EPUB)'],
  [latin1('PK\x05\x06'), 'an empty ZIP container'],
  [latin1('PK\x07\x08'), 'a spanned ZIP container'],
  [latin1('%PDF-'), 'a PDF'],
  [latin1('\x89PNG\r\n\x1a\n'), 'a PNG image'],
  [latin1('\xff\xd8\xff'), 'a JPEG image'],
  [latin1('GIF87a'), 'a GIF image'],
  [latin1('GIF89a'), 'a GIF image'],
  [latin1('II*\x00'), 'a TIFF image'],
  [latin1('MM\x00*'), 'a TIFF image'],
  [latin1('\x1f\x8b'), 'a gzip archive'],
  [latin1('\xfd7zXZ\x00'), 'an xz archive'],
  [latin1('7z\xbc\xaf\x27\x1c'), 'a 7-Zip archive'],
  [latin1('Rar!\x1a\x07'), 'a RAR archive'],
  [latin1('\x7fELF'), 'an ELF binary'],
  [latin1('\xca\xfe\xba\xbe'), 'a Java class or Mach-O binary'],
  [latin1('\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'), 'a legacy Office document (.doc, .xls, .ppt)'],
  [latin1('SQLite format 3\x00'), 'a SQLite database'],
];

/**
 * Signatures that are also ordinary words.
 *
 * A Markdown file may legitimately open with "OTTO" or "RIFF", and refusing it
 * would be a regression in a text tool. Every one of these formats puts binary
 * structure — a length, a table count — immediately after the magic, and prose
 * does not, so a non-printable byte in the opening bytes is what separates them.
 */
const AMBIGUOUS_SIGNATURES: ReadonlyArray<readonly [Uint8Array, string]> = [
  [latin1('RIFF'), 'a RIFF container (WEBP, WAV, AVI)'],
  [latin1('OggS'), 'an Ogg media file'],
  [latin1('BZh'), 'a bzip2 archive'],
  [latin1('8BPS'), 'a Photoshop document'],
  [latin1('wOFF'), 'a WOFF font'],
  [latin1('wOF2'), 'a WOFF2 font'],
  [latin1('OTTO'), 'an OpenType font'],
];

const startsWith = (data: Uint8Array, magic: Uint8Array): boolean =>
  data.length >= magic.length && magic.every((byte, index) => data[index] === byte);

function hasBinaryStructure(data: Uint8Array): boolean {
  return data
    .subarray(0, 32)
    .some((byte) => byte < 0x20 && !ALLOWED_CONTROLS.has(byte));
}

function matchSignature(data: Uint8Array): string | undefined {
  for (const [magic, label] of BINARY_SIGNATURES) {
    if (startsWith(data, magic)) return label;
  }
  for (const [magic, label] of AMBIGUOUS_SIGNATURES) {
    if (startsWith(data, magic) && hasBinaryStructure(data)) return label;
  }
  return undefined;
}

const SNIFF_BYTES = 8192;
/** Real text runs near zero control bytes; compressed and executable data does not. */
const CONTROL_RATIO_LIMIT = 0.05;
const ALLOWED_CONTROLS = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1b]);

function isControlDense(data: Uint8Array): boolean {
  const head = data.subarray(0, SNIFF_BYTES);
  if (head.length === 0) return false;
  let controls = 0;
  for (const byte of head) {
    if (byte < 0x20 && !ALLOWED_CONTROLS.has(byte)) controls++;
  }
  return controls / head.length > CONTROL_RATIO_LIMIT;
}

/**
 * Decode bytes as text, refusing anything that is not.
 *
 * Without this guard, piping a document into the text cleaner silently
 * destroys it: the bytes are decoded lossily, invisible-character removal is
 * applied to the wreckage, and the result is written back out. A PDF that goes
 * through it comes out larger and unparseable. Refusing is the only safe
 * answer, because there is no way to put the lost bytes back.
 *
 * Three tests, cheapest last: a format signature, then NUL bytes, then the
 * density of control bytes. Undecodable bytes alone are deliberately not proof
 * — text in an encoding other than UTF-8 must still be recognisable as text.
 */
export interface DecodeTextOptions {
  /**
   * Skip the format checks and decode anyway.
   *
   * The guard is deliberately blunt, so it will occasionally be wrong about a
   * real text file — and a guard with no way past it turns a rare false
   * positive into a permanent refusal. Decoding is still strict: invalid UTF-8
   * fails whatever this says, because there is no useful output on that path.
   */
  allowBinary?: boolean;
}

export function decodeTextInput(data: Uint8Array, options: DecodeTextOptions = {}): string {
  if (!options.allowBinary) {
    const signature = matchSignature(data);
    if (signature) {
      throw new BinaryInputError('signature', `input looks like ${signature}, not text`, signature);
    }
    if (data.includes(0)) {
      throw new BinaryInputError('nul-bytes', 'input contains NUL bytes, so it is not text');
    }
    if (isControlDense(data)) {
      throw new BinaryInputError('control-dense', 'input is dense in control bytes, so it is not text');
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new BinaryInputError('not-utf8', 'input is not valid UTF-8');
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

  out.push(...decodeZeroWidth(codepoints));
  return out;
}

/**
 * Zero-width characters used as digits.
 *
 * This is the scheme every "invisible watermark" library on npm implements, and
 * the one most likely to be sitting in a document someone was handed. The text
 * carries a run of characters from a small alphabet — most often U+200B and
 * U+200C standing for 0 and 1 — which reassemble into bytes.
 *
 * Neither the polarity nor the alphabet is standardised, so both binary
 * polarities are tried, and a four-symbol run is additionally read as base-4.
 * A candidate is only reported if it decodes to printable ASCII, which is what
 * separates a real payload from an arbitrary reading of incidental joiners.
 */
const ZERO_WIDTH_DIGITS = [0x200b, 0x200c, 0x200d, 0xfeff, 0x2060];

function bitsToText(bits: string): string | undefined {
  if (bits.length < 24) return undefined;
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const text = String.fromCharCode(...bytes);
  // Printable ASCII only. A payload worth hiding is a name, a key or an
  // identifier; a run of control bytes means the reading was wrong.
  if (!/^[\x20-\x7e]{3,}$/.test(text)) return undefined;
  // And it must say more than one thing. A regular alternation of two carriers
  // decodes to a single repeated letter — 0101… is "UUUU" — which is printable
  // and means nothing. Rejecting it costs the ability to recover a payload that
  // genuinely is one character repeated, which is not a payload anyone hides.
  return new Set(text).size >= 2 ? text : undefined;
}

function decodeZeroWidth(codepoints: number[]): string[] {
  const run = codepoints.filter((cp) => ZERO_WIDTH_DIGITS.includes(cp));
  // Twelve carriers is the shortest run that can hold three bytes, which
  // happens under the base-4 reading. bitsToText() enforces the real floor of
  // 24 bits, so counting characters here would set the bar in the wrong unit —
  // and did: a five-byte base-4 payload needs only twenty carriers, and a
  // twenty-four-character minimum silently threw it away.
  if (run.length < 12) return [];

  const alphabet = [...new Set(run)];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (text: string, scheme: string) => {
    if (seen.has(text)) return;
    seen.add(text);
    out.push(`zero-width ${scheme} → "${text}"`);
  };

  if (alphabet.length === 2) {
    // Both polarities: which codepoint means 1 is a per-library choice.
    const [a, b] = alphabet as [number, number];
    for (const one of [b, a]) {
      const text = bitsToText(run.map((cp) => (cp === one ? '1' : '0')).join(''));
      if (text) add(text, 'binary');
    }
  } else if (alphabet.length === 4) {
    // Two bits per character. Only the sorted order is tried: guessing among
    // the 24 permutations would eventually produce printable text by chance,
    // and a decoder that always finds something is worth nothing.
    const order = [...alphabet].sort((x, y) => x - y);
    const bits = run.map((cp) => order.indexOf(cp).toString(2).padStart(2, '0')).join('');
    const text = bitsToText(bits);
    if (text) add(text, 'base-4');
  }

  return out;
}

const SCRIPTS = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
] as const;

const WORD = /[\p{L}\p{M}\p{Nd}]+/gu;
const FULLWIDTH_LATIN = /[Ａ-Ｚａ-ｚ]/;
const ASCII_LATIN = /[A-Za-z]/;

/**
 * Words built from lookalike letters, which is the other way to hide in text.
 *
 * A Cyrillic `а` and a Latin `a` are different codepoints that render
 * identically, so "pаsswоrd" reads as ordinary English and matches nothing. The
 * signal is not the character — Cyrillic text is full of them legitimately — but
 * the *mixture*: one word drawing on two scripts at once has no innocent reason
 * to exist outside a linguistics paper. Same for a fullwidth `Ａ` next to an
 * ASCII one.
 *
 * These are reported and never replaced. Substituting the "wrong" script is a
 * guess about which half of the word was intended, and getting it backwards
 * mangles genuine Cyrillic or Greek text — so the call stays with the reader.
 */
function findConfusables(input: string): Finding[] {
  const mixedScript = new Map<string, Set<string>>();
  const mixedWidth = new Set<string>();

  for (const match of input.matchAll(WORD)) {
    const word = match[0];
    const scripts = SCRIPTS.filter(([, pattern]) => pattern.test(word)).map(([name]) => name);
    if (scripts.length > 1) mixedScript.set(word, new Set(scripts));
    if (FULLWIDTH_LATIN.test(word) && ASCII_LATIN.test(word)) mixedWidth.add(word);
  }

  const findings: Finding[] = [];
  if (mixedScript.size) {
    const scripts = new Set([...mixedScript.values()].flatMap((set) => [...set]));
    findings.push({
      kind: 'invisible-character',
      confidence: 'probable',
      location: 'mixed-script words',
      label: 'Letters that look alike but are not',
      value: `${preview([...mixedScript.keys()].join(', '), 80)} — one word mixing ${[...scripts].join(' and ')}`,
    });
  }
  if (mixedWidth.size) {
    findings.push({
      kind: 'invisible-character',
      confidence: 'probable',
      location: 'mixed-width words',
      label: 'Fullwidth letters among ASCII ones',
      value: preview([...mixedWidth].join(', '), 80),
    });
  }
  return findings;
}

/**
 * Text that carries the same letter written two different ways.
 *
 * `é` is one codepoint (U+00E9) or two (`e` + U+0301). Both render identically,
 * neither is a suspicious character, and a scanner working from a list of
 * codepoints sees nothing at all — which makes the choice between them a free
 * bit per accented letter. A hundred and ninety accented letters is a hundred
 * and ninety bits.
 *
 * The signal is the *mixture*, not the decomposition. A file that is entirely
 * NFD is a Mac: HFS+ stores filenames decomposed and several toolchains follow.
 * A file where the same document holds both forms is a file where something
 * chose, letter by letter, which one to use.
 */
function findNormalizationChannel(input: string): Finding[] {
  let decomposed = 0;
  let composed = 0;
  for (const grapheme of input.match(/\P{M}\p{M}+|\p{L}/gu) ?? []) {
    const nfc = grapheme.normalize('NFC');
    if (nfc.length < grapheme.length) decomposed++;
    else if (grapheme.normalize('NFD').length > grapheme.length) composed++;
  }
  if (decomposed === 0) return [];

  const mixed = composed > 0;
  return [
    {
      kind: 'invisible-character',
      // Mixed forms have no innocent explanation. Uniformly decomposed text
      // does — so it is reported at a level that says "worth knowing", not
      // "someone did this to you".
      confidence: mixed ? 'confirmed' : 'informational',
      location: 'Unicode normalisation',
      label: mixed
        ? 'Same letters written two different ways'
        : 'Text is in decomposed form (NFD)',
      value: mixed
        ? `${decomposed} decomposed and ${composed} composed accented letters in one document — the choice between them carries about ${decomposed} bits`
        : `${decomposed} decomposed accented letters, none composed — usual for text that passed through macOS`,
    },
  ];
}

/**
 * Dashes and hyphens that are not the ASCII one but look like it.
 *
 * U+2010 and U+2011 are pixel-for-pixel the ASCII hyphen in most fonts, so
 * swapping one in is a free bit that survives every visual review. The en and
 * em dashes are deliberately absent: they are visibly longer, they are correct
 * French typography, and flagging them would bury this under noise.
 */
const HYPHEN_TWINS = new Map<number, string>([
  [0x2010, 'HYPHEN'],
  [0x2011, 'NON-BREAKING HYPHEN'],
  [0x2012, 'FIGURE DASH'],
  [0x02d7, 'MODIFIER LETTER MINUS SIGN'],
  [0x2212, 'MINUS SIGN'],
]);

function findHyphenTwins(input: string): Finding[] {
  const counts = new Map<number, number>();
  for (const char of input) {
    const cp = char.codePointAt(0)!;
    if (HYPHEN_TWINS.has(cp)) counts.set(cp, (counts.get(cp) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const parts = [...counts].map(
    ([cp, n]) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${HYPHEN_TWINS.get(cp)} ×${n}`,
  );
  return [
    {
      kind: 'invisible-character',
      confidence: 'probable',
      location: 'hyphen lookalikes',
      label: 'Dashes that are not the ASCII hyphen',
      value: `${parts.join(', ')} — indistinguishable from "-" on screen`,
    },
  ];
}

/**
 * Channels made of whitespace rather than of characters.
 *
 * Nothing here is a strange codepoint; every one is an ordinary space or line
 * ending, arranged. One or two spaces after a full stop is a free bit that
 * reads as a typing habit; a trailing space at end of line is invisible in
 * every editor. They are reported and never rewritten — spacing is the
 * author's, and a tool that quietly re-spaces prose is worse than the mark.
 */
function findWhitespaceChannels(input: string): Finding[] {
  const findings: Finding[] = [];
  const lines = input.split('\n');

  const trailing = lines.filter((line) => /[ \t]+\r?$/.test(line)).length;
  if (trailing >= 3) {
    findings.push({
      kind: 'invisible-character',
      confidence: trailing >= lines.length / 4 ? 'probable' : 'informational',
      location: 'line endings',
      label: 'Trailing whitespace',
      value: `${trailing} of ${lines.length} lines end in spaces or tabs — invisible in an editor, and one bit per line`,
    });
  }

  const doubled = [...input.matchAll(/[.!?] {2,}(?=[^\s])/g)].length;
  const single = [...input.matchAll(/[.!?] (?=[^\s])/g)].length;
  if (doubled > 0 && single > 0) {
    findings.push({
      kind: 'invisible-character',
      // Uniform double-spacing is a typing convention. A document that does
      // both, sentence by sentence, is not following a convention.
      confidence: 'probable',
      location: 'sentence spacing',
      label: 'Spacing after full stops is inconsistent',
      value: `${doubled} sentences followed by two or more spaces, ${single} by one — one bit per sentence`,
    });
  }

  const crlf = (input.match(/\r\n/g) ?? []).length;
  const lf = lines.length - 1 - crlf;
  if (crlf > 0 && lf > 0) {
    findings.push({
      kind: 'invisible-character',
      confidence: 'probable',
      location: 'line endings',
      label: 'Line endings are mixed',
      value: `${crlf} CRLF and ${lf} LF in one file — one bit per line. Note that pasting into a browser normalises these away, so this only shows on a file`,
    });
  }

  return findings;
}

/**
 * C0 control characters, which render as nothing and are nobody's typography.
 *
 * Tab, newline and carriage return are text. Form feed still is, in listings
 * old enough to page. Everything else in the C0 block — a NUL, a bell, a shift
 * out — has no business in prose, renders as nothing or as a box, and carries a
 * bit per position exactly like a zero-width space. They sit in category `Cc`,
 * which the `Cf` backstop does not cover, so nothing above sees them.
 *
 * ESC is the reason these are reported rather than removed: a coloured log or
 * a terminal capture is full of legitimate escape sequences, and stripping them
 * would mangle the file to fix nothing.
 */
const TEXTUAL_CONTROLS = new Set([0x09, 0x0a, 0x0c, 0x0d]);

function findControlCharacters(input: string): Finding[] {
  const counts = new Map<number, number>();
  for (const char of input) {
    const cp = char.codePointAt(0)!;
    if (cp < 0x20 && !TEXTUAL_CONTROLS.has(cp)) counts.set(cp, (counts.get(cp) ?? 0) + 1);
    else if (cp === 0x7f) counts.set(cp, (counts.get(cp) ?? 0) + 1);
  }
  if (counts.size === 0) return [];

  const named = (cp: number) =>
    cp === 0x00 ? 'NUL' : cp === 0x07 ? 'BEL' : cp === 0x08 ? 'BS' : cp === 0x0b ? 'VT'
    : cp === 0x1b ? 'ESC' : cp === 0x7f ? 'DEL' : `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

  const parts = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([cp, n]) => `${named(cp)} ×${n}`);
  const hasEscape = counts.has(0x1b);

  return [
    {
      kind: 'invisible-character',
      confidence: 'probable',
      location: 'control characters',
      label: 'Control characters in the text',
      value: `${parts.join(', ')} — invisible, and one bit per position${
        hasEscape ? '. ESC is also how a coloured terminal log is written' : ''
      }`,
    },
  ];
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

  findings.push(...findConfusables(input));
  findings.push(...findNormalizationChannel(input));
  findings.push(...findHyphenTwins(input));
  findings.push(...findWhitespaceChannels(input));
  findings.push(...findControlCharacters(input));

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
  /**
   * Found but deliberately left in place — lookalike letters, which are part of
   * a word rather than an invisible character. Reported separately so `removed`
   * never claims something the output still carries.
   */
  kept: Finding[];
  decoded: string[];
}

/**
 * Findings that describe an arrangement rather than a codepoint.
 *
 * Cleaning removes characters; it does not re-spell words, re-space prose or
 * choose which dash the author meant. These are reported so the count of what
 * was removed never covers for what is still there.
 */
const REPORTED_NOT_REMOVED = new Set([
  'mixed-script words',
  'mixed-width words',
  'hyphen lookalikes',
  'line endings',
  'sentence spacing',
  'control characters',
]);

const isKeptFinding = (finding: Finding) => REPORTED_NOT_REMOVED.has(finding.location);

/**
 * Findings that describe how a file is laid out rather than what it contains.
 *
 * Line endings, trailing spaces and sentence spacing are channels in a text
 * file, where the author controls every byte. Inside a container they are not:
 * an OOXML "line" is a paragraph element, the whitespace between two tags is
 * the generator's indentation, and a PDF content stream carries the newlines of
 * PDF syntax and of any embedded font. Measured there, these count the format
 * rather than the document — a PDF reported "1 CRLF and 14 LF" that came from
 * a subset font program.
 */
const ARRANGEMENT = new Set(['line endings', 'sentence spacing']);

export const isArrangementFinding = (finding: Finding): boolean =>
  ARRANGEMENT.has(finding.location);

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

  return {
    text,
    removed: scan.findings.filter((finding) => !isKeptFinding(finding)),
    kept: scan.findings.filter(isKeptFinding),
    decoded: scan.decoded,
  };
}


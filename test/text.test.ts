import { describe, it, expect } from 'vitest';
import { scanText, cleanText, decodeTextInput, BinaryInputError } from '../src/core/text.js';
import { tagEncode, variationEncode } from './fixtures.js';

// Invisible characters are written as escapes throughout: a literal U+200B in
// source is indistinguishable from a typo when the test later fails.
const ZWSP = '\u200B';
const ZWNJ = '\u200C';
const ZWJ = '\u200D';
const BOM = '\uFEFF';
const NBSP = '\u00A0';
const THIN_SPACE = '\u2009';
const VS16 = '\uFE0F';

const codepointsOf = (s: string) => new Set([...s].map((c) => c.codePointAt(0)!));

describe('scanText', () => {
  it('reports invisible characters grouped by codepoint', () => {
    const scan = scanText(`a${ZWSP}b${ZWSP}c${BOM}d`);
    expect(scan.findings.find((f) => f.location === 'U+200B')?.value).toBe('2 occurrences');
    expect(scan.findings.find((f) => f.location === 'U+FEFF')?.value).toBe('1 occurrence');
  });

  it('reports exotic whitespace distinctly from ordinary spaces', () => {
    const scan = scanText(`mot${NBSP}suivant${THIN_SPACE}mot fin`);
    expect(scan.findings.map((f) => f.label)).toEqual(
      expect.arrayContaining(['no-break space', 'thin space']),
    );
  });

  it('finds nothing in ordinary text', () => {
    expect(scanText('Bonjour, voici le document demandé.').findings).toEqual([]);
  });
});

describe('steganographic payloads', () => {
  it('decodes tag-character encoding', () => {
    expect(scanText(`Rapport${tagEncode('ID42')}`).decoded).toEqual(['tag characters → "ID42"']);
  });

  it('decodes variation-selector encoding', () => {
    expect(scanText(`Rapport${variationEncode('trace-7')}`).decoded).toEqual([
      'variation selectors → "trace-7"',
    ]);
  });

  it('does not invent a payload from ordinary emoji presentation', () => {
    expect(scanText(`Attention ⚠${VS16} et ❤${VS16} ici`).decoded).toEqual([]);
  });
});

describe('cleanText', () => {
  it('removes invisible characters', () => {
    const { text } = cleanText(`Bonjour,${ZWSP}${ZWSP} voici${BOM} le texte.`);
    expect(text).toBe('Bonjour, voici le texte.');
    expect(codepointsOf(text).has(0x200b)).toBe(false);
  });

  it('normalises exotic whitespace to U+0020', () => {
    expect(cleanText(`le${NBSP}document${THIN_SPACE}final`).text).toBe('le document final');
  });

  it('preserves zero-width joiners inside emoji sequences', () => {
    const developer = `\u{1F469}${ZWJ}\u{1F4BB}`;
    const family = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`;
    const { text } = cleanText(`équipe ${developer} et ${family} ici`);
    expect(text).toContain(developer);
    expect(text).toContain(family);
  });

  it('preserves variation selector 16 after a pictographic character', () => {
    expect(cleanText(`Attention ⚠${VS16} fin`).text).toContain(`⚠${VS16}`);
  });

  it('preserves zero-width non-joiner between letters', () => {
    // Persian orthography relies on ZWNJ inside words.
    const persian = `می${ZWNJ}رود`;
    expect(cleanText(persian).text).toBe(persian);
  });

  it('removes a joiner that is not doing typographic work', () => {
    const { text } = cleanText(`fin${ZWJ} ${ZWNJ}début`);
    expect(codepointsOf(text).has(0x200d)).toBe(false);
    expect(codepointsOf(text).has(0x200c)).toBe(false);
  });

  it('applies NFC normalisation', () => {
    const { text } = cleanText('cafe\u0301');
    expect(text).toBe('caf\u00E9');
    expect(text.length).toBe(4);
  });

  it('strips a tag-character payload entirely', () => {
    expect(cleanText(`Rapport${tagEncode('ID42')} final`).text).toBe('Rapport final');
  });

  it('leaves clean text byte-identical', () => {
    const input = 'Bonjour, voici le document demandé.\n\nCordialement,\nL.';
    expect(cleanText(input).text).toBe(input);
  });
});

describe('binary input', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it('decodes ordinary UTF-8 text', () => {
    expect(decodeTextInput(new TextEncoder().encode('Bonjour, café ☕'))).toBe('Bonjour, café ☕');
  });

  it('accepts an empty input', () => {
    expect(decodeTextInput(new Uint8Array(0))).toBe('');
  });

  it('refuses input containing NUL bytes', () => {
    expect(() => decodeTextInput(bytes(0x68, 0x00, 0x69))).toThrow(BinaryInputError);
  });

  it('refuses invalid UTF-8', () => {
    // 0xC3 starts a two-byte sequence that never completes.
    expect(() => decodeTextInput(bytes(0x68, 0xc3, 0x28))).toThrow(BinaryInputError);
  });

  it('refuses a PDF, whose header alone looks like text', () => {
    // "%PDF-1.7" is ASCII, so the guard has to reach the binary body.
    const pdf = new Uint8Array([...new TextEncoder().encode('%PDF-1.7\n'), 0x00, 0xff, 0xfe]);
    expect(() => decodeTextInput(pdf)).toThrow(BinaryInputError);
  });

  it('explains why the input was refused', () => {
    expect(() => decodeTextInput(bytes(0x00))).toThrow(/NUL/);
    expect(() => decodeTextInput(bytes(0xc3, 0x28))).toThrow(/UTF-8/);
  });
});

describe('text reordering controls', () => {
  const RLO = '‮';
  const PDF_MARK = '‬';

  it('calls out bidi overrides separately from other invisible characters', () => {
    const scan = scanText(`const isAdmin = ${RLO}false${PDF_MARK};`);
    const callout = scan.findings.find((f) => f.label === 'Text reordering controls');
    expect(callout?.confidence).toBe('confirmed');
    expect(callout?.value).toContain('CVE-2021-42574');
  });

  it('puts the callout first, ahead of ordinary invisible characters', () => {
    const scan = scanText(`a${ZWSP}b${RLO}c${PDF_MARK}`);
    expect(scan.findings[0]?.label).toBe('Text reordering controls');
  });

  it('says nothing when no reordering control is present', () => {
    const scan = scanText(`a${ZWSP}b`);
    expect(scan.findings.map((f) => f.label)).not.toContain('Text reordering controls');
  });

  it('removes the controls when cleaning', () => {
    const { text } = cleanText(`const isAdmin = ${RLO}false${PDF_MARK};`);
    expect(text).toBe('const isAdmin = false;');
  });
});

describe('the binary guard', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  // The NUL/UTF-8 pair alone let this through: an uncompressed PDF has no NUL
  // byte and decodes cleanly, so it reached the text cleaner, which would have
  // rewritten its string operands and handed back an unopenable file.
  const PLAIN_PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';

  it('refuses a PDF that contains no NUL byte and is valid UTF-8', () => {
    const data = new TextEncoder().encode(PLAIN_PDF);
    expect(data.includes(0)).toBe(false);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(data)).not.toThrow();
    expect(() => decodeTextInput(data)).toThrow(BinaryInputError);
    expect(() => decodeTextInput(data)).toThrow(/a PDF/);
  });

  it('names the format it recognised', () => {
    expect(() => decodeTextInput(new TextEncoder().encode('GIF89a...'))).toThrow(/GIF/);
    expect(() => decodeTextInput(bytes(0x7f, 0x45, 0x4c, 0x46, 0x02))).toThrow(/ELF/);
  });

  it('refuses bytes that are dense in control characters', () => {
    // Below every signature, valid UTF-8, no NUL — only the density gives it away.
    const noisy = new Uint8Array(200).fill(0x01);
    expect(() => decodeTextInput(noisy)).toThrow(/control bytes/);
  });

  it('still accepts prose that happens to open with a format name', () => {
    // "OTTO" and "RIFF" are also words. A text tool that refuses a document for
    // starting with one has traded a corruption bug for a usability bug.
    expect(decodeTextInput(new TextEncoder().encode('OTTO est un projet.\n'))).toContain('projet');
    expect(decodeTextInput(new TextEncoder().encode('RIFF is a container format.\n'))).toContain(
      'container',
    );
  });

  it('refuses the real font when the binary structure is there', () => {
    expect(() => decodeTextInput(bytes(0x4f, 0x54, 0x54, 0x4f, 0x00, 0x0c, 0x00, 0x80))).toThrow(
      /OpenType/,
    );
  });
});

describe('format characters beyond the enumerated list', () => {
  it('removes the ones that were missing', () => {
    for (const [codepoint, label] of [
      [0x034f, 'combining grapheme joiner'],
      [0x061c, 'Arabic letter mark'],
      [0x115f, 'Hangul filler'],
      [0x17b4, 'Khmer inherent vowel'],
      [0x180b, 'Mongolian free variation selector'],
      [0xfff9, 'interlinear annotation anchor'],
    ] as const) {
      const input = `avant${String.fromCodePoint(codepoint)}après`;
      expect(cleanText(input).text, label).toBe('avantaprès');
      expect(scanText(input).findings.some((f) => f.label === label), label).toBe(true);
    }
  });

  it('keeps format characters that a writing system needs', () => {
    // U+0600 prefixes an Arabic numeral and U+06DD punctuates Quranic text.
    // Both are category Cf, so a blind backstop would delete what the document
    // says rather than a carrier hidden inside it.
    for (const codepoint of [0x0600, 0x06dd, 0x08e2, 0x110bd, 0x1d173]) {
      const char = String.fromCodePoint(codepoint);
      expect(cleanText(`a${char}b`).text, `U+${codepoint.toString(16)}`).toBe(`a${char}b`);
    }
  });
});

describe('lookalike letters', () => {
  const CYRILLIC_A = 'а';
  const FULLWIDTH_A = 'Ａ';

  it('reports a word that mixes two alphabets', () => {
    const scan = scanText(`Votre p${CYRILLIC_A}ssword est expiré.`);
    const finding = scan.findings.find((f) => f.label === 'Letters that look alike but are not');
    expect(finding?.confidence).toBe('probable');
    expect(finding?.value).toContain('Latin and Cyrillic');
  });

  it('leaves genuine Cyrillic alone', () => {
    expect(scanText('Привет, как дела?').findings).toEqual([]);
  });

  it('reports fullwidth letters standing among ASCII ones', () => {
    const scan = scanText(`${FULLWIDTH_A}dmin`);
    expect(scan.findings.map((f) => f.label)).toContain('Fullwidth letters among ASCII ones');
  });

  it('never rewrites them, and says so rather than counting them as removed', () => {
    const input = `p${CYRILLIC_A}ssword`;
    const result = cleanText(input);
    // Substituting a script is a guess about which half of the word was meant.
    expect(result.text).toBe(input);
    expect(result.removed).toEqual([]);
    expect(result.kept.map((f) => f.label)).toEqual(['Letters that look alike but are not']);
  });
});

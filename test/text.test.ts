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

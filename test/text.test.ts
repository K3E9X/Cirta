import { describe, it, expect } from 'vitest';
import { scanText, cleanText, decodeTextInput, BinaryInputError } from '../src/core/text.js';
import { inspectFile, redactFile } from '../src/core/index.js';
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

describe('plain text and source files', () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it('routes a file that is text but no known markup', async () => {
    const result = await inspectFile(encode(`a${ZWSP}b`), 'notes.txt');
    expect(result.format).toBe('text');
    expect(result.findings.map((f) => f.label)).toContain('zero-width space');
  });

  it('catches a bidi override in source, which is the Trojan Source case', async () => {
    const source = 'if (user.role == "‮admin‬") grant();';
    const result = await inspectFile(encode(source), 'auth.py');
    expect(result.findings[0]?.label).toBe('Text reordering controls');

    const cleaned = (await redactFile(encode(source), 'auth.py')).text;
    expect(cleaned).toBe('if (user.role == "admin") grant();');
  });

  it('keeps typographic spaces, as document bodies do', async () => {
    // A file on disk is authored content, not a paste being tidied up.
    const cleaned = (await redactFile(encode(`Objet : le rapport${ZWSP}.`), 'note.txt')).text;
    expect(cleaned).toBe('Objet : le rapport.');
  });

  it('still refuses bytes that are not text at all', async () => {
    await expect(inspectFile(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });

  it('decodes anyway when the caller insists', async () => {
    // The guard is blunt, so it needs a way past it — otherwise a rare false
    // positive becomes a permanent refusal. It cannot override a magic-byte
    // route: a file that really is a PDF still goes to the PDF parser.
    const riffish = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    await expect(inspectFile(riffish, 'weird.txt')).rejects.toThrow();
    await expect(inspectFile(riffish, 'text')).resolves.toMatchObject({ format: 'text' });
  });

  it('reports a damaged PDF instead of crashing on it', async () => {
    // %PDF at the front is not a promise that the rest parses, and pdf-lib is
    // asked to load leniently — so the catalog can be missing entirely.
    await expect(inspectFile(encode('%PDF-1.4 not really'))).resolves.toBeDefined();
  });
});

describe('channels that are not a strange codepoint', () => {
  // Layers from a stealth corpus that carried no ZWSP, ZWNJ, BOM or tag
  // character at all: a scanner that only walks a blocklist returns nothing.

  describe('Unicode normalisation', () => {
    const label = (text: string) =>
      scanText(text).findings.find((f) => f.location === 'Unicode normalisation');

    it('flags a document holding both spellings of the same letter', () => {
      // "é" as one codepoint and as e+U+0301 render identically, so the choice
      // between them is a free bit per accented letter and shows up nowhere.
      const mixed = 'Réviser'.normalize('NFC') + ' et ' + 'corrigé'.normalize('NFD');
      const finding = label(mixed);
      expect(finding?.confidence).toBe('confirmed');
      expect(finding?.value).toMatch(/decomposed and \d+ composed/);
    });

    it('does not cry about text that is uniformly decomposed', () => {
      // HFS+ stores decomposed, and several toolchains follow. That is a Mac,
      // not a mark, so it is reported without an accusation.
      expect(label('Réviser et corriger'.normalize('NFD'))?.confidence).toBe('informational');
    });

    it('says nothing about ordinary composed text', () => {
      expect(label('Réviser et corriger'.normalize('NFC'))).toBeUndefined();
    });

    it('cleaning removes the channel, and the report says so', () => {
      const mixed = 'é' + 'é';
      const result = cleanText(mixed);
      expect(result.text).toBe('éé');
      // Normalising is what destroys the payload; leaving it out of `removed`
      // would mean silently erasing a channel the user was never told about.
      expect(result.removed.some((f) => f.location === 'Unicode normalisation')).toBe(true);
    });
  });

  describe('hyphen lookalikes', () => {
    it('flags the ones indistinguishable from "-"', () => {
      const finding = scanText('bien‐sûr et haut‑parleur').findings.find(
        (f) => f.location === 'hyphen lookalikes',
      );
      expect(finding?.value).toContain('U+2010');
      expect(finding?.value).toContain('U+2011');
    });

    it('leaves the en and em dashes alone', () => {
      // Visibly longer, and correct French typography. Flagging them would
      // bury the two that actually hide.
      expect(scanText('un tiret — long, un autre – moyen').findings).toEqual([]);
    });

    it('never rewrites them', () => {
      const input = 'haut‑parleur';
      const result = cleanText(input);
      expect(result.text).toBe(input);
      expect(result.kept.map((f) => f.location)).toContain('hyphen lookalikes');
    });
  });

  describe('whitespace', () => {
    it('flags trailing spaces once there are enough to carry something', () => {
      const carrying = Array.from({ length: 12 }, (_, i) => `ligne ${i}${i % 2 ? ' ' : ''}`).join('\n');
      expect(scanText(carrying).findings.some((f) => f.label === 'Trailing whitespace')).toBe(true);
    });

    it('ignores a couple of stray trailing spaces', () => {
      expect(scanText('def a():\n    pass  \n\ndef b():\n    pass \n').findings).toEqual([]);
    });

    it('flags sentence spacing only when the document does both', () => {
      // Uniform double-spacing is a typing convention; alternating is a choice
      // made sentence by sentence.
      expect(
        scanText('Un.  Deux. Trois.  Quatre.').findings.some(
          (f) => f.location === 'sentence spacing',
        ),
      ).toBe(true);
      expect(scanText('Un.  Deux.  Trois.').findings).toEqual([]);
      expect(scanText('Un. Deux. Trois.').findings).toEqual([]);
    });

    it('flags mixed line endings, and says the browser cannot see them', () => {
      const finding = scanText('a\r\nb\nc\r\nd\n').findings.find(
        (f) => f.label === 'Line endings are mixed',
      );
      expect(finding?.value).toContain('CRLF');
      expect(finding?.value).toContain('normalises these away');
    });

    it('reports spacing without re-spacing the prose', () => {
      const input = 'Un.  Deux. Trois.  Quatre.';
      const result = cleanText(input);
      expect(result.text).toBe(input);
      expect(result.kept.map((f) => f.location)).toContain('sentence spacing');
    });
  });

  describe('invisibles outside category Cf', () => {
    it('catches the fillers Unicode classifies as letters', () => {
      for (const cp of [0x3164, 0xffa0]) {
        const input = `a${String.fromCodePoint(cp)}b`;
        expect(scanText(input).findings.some((f) => f.label === 'Hangul filler')).toBe(true);
        expect(cleanText(input).text).toBe('ab');
      }
    });

    it('catches a blank braille cell, but not one inside braille', () => {
      expect(cleanText('a⠀b').text).toBe('ab');
      // Between braille characters it is the space of that script.
      expect(cleanText('⠁⠀⠃').text).toBe('⠁⠀⠃');
    });
  });
});

describe('C0 control characters', () => {
  it('flags the ones that are not text', () => {
    const finding = scanText('un \x1b echappement et un \x07 bip').findings.find(
      (f) => f.location === 'control characters',
    );
    expect(finding?.confidence).toBe('probable');
    expect(finding?.value).toContain('ESC');
    expect(finding?.value).toContain('BEL');
  });

  it('says nothing about tabs, newlines and form feeds', () => {
    // Consistent line endings, or the mixed-CRLF channel fires on the fixture
    // rather than on anything this test is about.
    expect(scanText('une phrase.\tune tabulation.\nune page.\f\n').findings).toEqual([]);
  });

  it('names the legitimate use of ESC rather than just accusing', () => {
    // A coloured terminal capture is full of them, and stripping those would
    // mangle the file to fix nothing.
    const finding = scanText('\x1b[1mgras\x1b[0m').findings.find(
      (f) => f.location === 'control characters',
    );
    expect(finding?.value).toContain('coloured terminal log');
  });

  it('reports without rewriting', () => {
    const input = 'a\x00b';
    const result = cleanText(input);
    expect(result.text).toBe(input);
    expect(result.kept.map((f) => f.location)).toContain('control characters');
  });

  it('catches DEL, which sits just past the printable range', () => {
    expect(
      scanText('a\x7fb').findings.some((f) => f.location === 'control characters'),
    ).toBe(true);
  });
});

describe('zero-width characters used as digits', () => {
  /** The scheme every "invisible watermark" library on npm implements. */
  const encode = (payload: string, zero = '​', one = '‌') =>
    [...payload]
      .map((c) => c.charCodeAt(0).toString(2).padStart(8, '0'))
      .join('')
      .replace(/0/g, zero)
      .replace(/1/g, one);

  it('recovers a payload hidden as U+200B and U+200C', () => {
    const { decoded } = scanText(`Bien cordialement,\nLotfi${encode('KGX-2026')}`);
    expect(decoded.join(' ')).toContain('KGX-2026');
  });

  it('recovers it whichever codepoint the library chose for 1', () => {
    const { decoded } = scanText(`Texte${encode('SECRET', '‌', '​')}`);
    expect(decoded.join(' ')).toContain('SECRET');
  });

  it('reads a four-symbol alphabet as base-4', () => {
    const symbols = ['​', '‌', '‍', '﻿'];
    const bits = [...'AGENT']
      .map((c) => c.charCodeAt(0).toString(2).padStart(8, '0'))
      .join('');
    let hidden = '';
    for (let i = 0; i + 2 <= bits.length; i += 2) hidden += symbols[parseInt(bits.slice(i, i + 2), 2)]!;
    expect(scanText(`Texte${hidden}`).decoded.join(' ')).toContain('AGENT');
  });

  it('stays quiet when the characters do not decode to anything printable', () => {
    // Twenty-four alternating joiners: long enough to try, meaningless as bytes.
    const noise = '​‌'.repeat(16);
    expect(scanText(`Texte${noise}`).decoded).toEqual([]);
  });

  it('still counts and removes the characters even when nothing decodes', () => {
    const noise = '​‌'.repeat(16);
    const scan = scanText(`Texte${noise}`);
    expect(scan.findings.some((f) => f.label === 'zero-width space')).toBe(true);
    expect(cleanText(`Texte${noise}`).text).toBe('Texte');
  });
});

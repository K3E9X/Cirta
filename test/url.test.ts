import { describe, it, expect } from 'vitest';
import { findDeceptiveUrls, decodePunycode, skeleton, cleanText, scanText } from '../src/core/index.js';

const labels = (text: string) => findDeceptiveUrls(text).map((f) => f.label);
const first = (text: string) => findDeceptiveUrls(text)[0];

describe('punycode', () => {
  it('decodes the label from the 2017 proof of concept', () => {
    // Xudong Zheng's demonstration against every major browser.
    expect(decodePunycode('xn--80ak6aa92e')).toBe('аррӏе');
  });

  it('decodes an ordinary internationalised name', () => {
    expect(decodePunycode('xn--bcher-kva')).toBe('bücher');
  });

  it('returns nothing for a label that is not punycode', () => {
    expect(decodePunycode('example')).toBeUndefined();
  });

  it('returns nothing rather than guessing at a malformed label', () => {
    expect(decodePunycode('xn--')).toBeUndefined();
    expect(decodePunycode('xn--!!!')).toBeUndefined();
  });
});

describe('skeleton', () => {
  it('folds a whole-script Cyrillic name onto what it renders as', () => {
    expect(skeleton('аррӏе')).toBe('apple');
  });

  it('folds fullwidth forms by arithmetic', () => {
    expect(skeleton('Ａdmin')).toBe('admin');
  });

  it('drops combining marks, which vanish at the size a hostname is read at', () => {
    expect(skeleton('pаypạl')).toBe('paypal');
  });

  it('leaves ordinary text alone', () => {
    expect(skeleton('github')).toBe('github');
  });
});

describe('deceptive links', () => {
  it('catches the whole-script confusable a mixed-script check misses', () => {
    // Every character is from one consistent script, so nothing is "mixed" —
    // which is exactly why this shape got past browsers.
    const found = first('Connectez-vous sur https://xn--80ak6aa92e.com/login');
    expect(found?.label).toBe('Hostname written entirely in a lookalike alphabet');
    expect(found?.confidence).toBe('confirmed');
    expect(found?.value).toContain('renders as "apple"');
  });

  it('catches a single swapped letter', () => {
    expect(labels('https://аpple.com/account')).toContain('Hostname mixing two alphabets');
  });

  it('catches the username trick, where the recognisable part is ignored', () => {
    const found = first('https://paypal.com@evil.example/signin');
    expect(found?.label).toBe('Link that reads as one site and resolves to another');
    expect(found?.value).toContain('evil.example');
  });

  it('catches an invisible character inside a hostname', () => {
    expect(labels('https://pay​pal.com/')).toContain('Invisible character inside a hostname');
  });

  it('reports one finding for a link repeated through a document', () => {
    const twice = 'https://xn--80ak6aa92e.com/a and again https://xn--80ak6aa92e.com/a';
    expect(findDeceptiveUrls(twice)).toHaveLength(1);
  });
});

describe('links that are not deceptive', () => {
  it('says nothing about ordinary addresses', () => {
    expect(findDeceptiveUrls('Le code est sur https://github.com/k3e9x/Cirta — voyez le README.')).toEqual([]);
  });

  it('does not accuse a genuine non-Latin domain', () => {
    // почта.рф is the Russian postal service. A tool that calls this an attack
    // is a tool nobody outside the Latin alphabet can use.
    const found = findDeceptiveUrls('https://почта.рф/вход');
    expect(found.every((f) => f.confidence === 'informational')).toBe(true);
    expect(found.every((f) => f.label === 'Internationalised hostname')).toBe(true);
  });

  it('does not treat a bare domain in prose as a link', () => {
    expect(findDeceptiveUrls('Nous avons comparé apple.com et example.org cette semaine.')).toEqual([]);
  });

  it('does not report a hyphen or digits as a lookalike', () => {
    // ASCII substitutions like 1/l and 0/O are deliberately out of scope: they
    // occur in legitimate names often enough that flagging them would bury the
    // Unicode cases that cannot occur innocently.
    expect(findDeceptiveUrls('https://o2.co.uk and https://3m.com and https://my-site.example')).toEqual([]);
  });
});

describe('links inside a document scan', () => {
  it('surfaces through the ordinary text scan', () => {
    const scan = scanText('Voir https://xn--80ak6aa92e.com/login');
    expect(scan.findings.some((f) => f.location === 'links')).toBe(true);
  });

  it('is reported but never rewritten', () => {
    const text = 'Voir https://xn--80ak6aa92e.com/login';
    const result = cleanText(text);
    // Where a link points is what the document says; changing it would send the
    // reader somewhere the author did not write.
    expect(result.text).toContain('xn--80ak6aa92e.com');
    expect(result.kept.some((f) => f.location === 'links')).toBe(true);
    expect(result.removed.some((f) => f.location === 'links')).toBe(false);
  });
});

describe('mathematical alphanumerics', () => {
  it('reads styled letters back to what they say', () => {
    // 𝘂𝗿𝗴𝗲𝗻𝘁 — a filter matching "urgent" does not match this.
    const found = scanText('Message \u{1D602}\u{1D5FF}\u{1D5F4}\u{1D5F2}\u{1D5FB}\u{1D601} : virement');
    const styled = found.findings.find((f) => f.label === 'Letters styled with mathematical symbols');
    expect(styled?.value).toContain('"urgent"');
  });

  it('is reported and never rewritten, because in a formula it is the notation', () => {
    const text = 'Soit \u{1D53D} le corps';
    const result = cleanText(text);
    expect(result.text).toContain('\u{1D53D}');
    expect(result.kept.some((f) => f.location === 'mathematical alphanumerics')).toBe(true);
  });

  it('says nothing about ordinary prose', () => {
    const found = scanText('Un message tout a fait ordinaire, urgent meme.');
    expect(found.findings.some((f) => f.location === 'mathematical alphanumerics')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { inspectPlainText } from '../src/core/index.js';
import { translateLabel } from '../src/shared/french.js';

/*
 * [R8.3] « espace sans chasse », « espace insécable » sat in lower case among
 * labels that begin with a capital. Shown with one; the core's label stays.
 */

describe('[R8.3] character names shown with a capital', () => {
  const findings = inspectPlainText('Bon\u200bjour\u00a0le\u2009monde\u200d \u{e0041}');

  it.each([
    ['zero-width space', 'Zero-width space', 'Espace sans chasse'],
    ['no-break space', 'No-break space', 'Espace insécable'],
    ['thin space', 'Thin space', 'Espace fine'],
    ['tag character', 'Tag character', 'Caractère d’étiquette'],
    ['variation selector 3', 'Variation selector 3', 'Sélecteur de variante 3'],
  ])('%s', (label, en, fr) => {
    expect(translateLabel(label, 'en')).toBe(en);
    expect(translateLabel(label, 'fr')).toBe(fr);
  });

  it('every label the text pass gives starts with a capital, in both languages', () => {
    expect(findings.length).toBeGreaterThan(2);
    for (const finding of findings) {
      for (const lang of ['en', 'fr'] as const) expect(translateLabel(finding.label, lang)).toMatch(/^[^a-zà-ÿ]/u);
    }
  });

  it('the core keeps the name as written, and leaves an identifier alone', () => {
    expect(findings.some((f) => f.label === 'zero-width space')).toBe(true);
    expect(translateLabel('tEXt chunk', 'en')).toBe('tEXt chunk');
    expect(translateLabel('dc:creator', 'en')).toBe('dc:creator');
  });
});

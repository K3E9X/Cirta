import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePreset } from '../src/shared/preset.js';

/*
 * [P1-3] The page opened already set: a link to it can say which tab, which
 * language and which kind of file, so a page about PDF metadata embeds the
 * tool ready for a PDF. In the fragment, which the browser never sends: the
 * server learns nothing about what the visitor came for.
 */

const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/web/main.ts', import.meta.url), 'utf8');
const accepted = /id="file-input" accept="([^"]+)"/.exec(html)![1]!.split(',');

describe('[P1-3] a preset in the fragment', () => {
  it('reads the tab, the language and the formats', () => {
    expect(parsePreset('#tab=text&lang=en', accepted)).toEqual({ tab: 'text', lang: 'en' });
    expect(parsePreset('#format=pdf', accepted)).toEqual({ accept: ['.pdf'] });
    expect(parsePreset('#format=docx,odt,rtf&lang=fr&tab=files', accepted)).toEqual({ tab: 'files', lang: 'fr', accept: ['.docx', '.odt', '.rtf'] });
  });

  it('ignores what it does not know: another value, an unsupported format, an empty or absent fragment', () => {
    expect(parsePreset('#tab=admin&lang=de&format=exe', accepted)).toEqual({});
    expect(parsePreset('#format=pdf,exe', accepted)).toEqual({ accept: ['.pdf'] });
    expect(parsePreset('', accepted)).toEqual({});
    expect(parsePreset('#', accepted)).toEqual({});
    expect(parsePreset('#tab', accepted)).toEqual({});
  });

  it('is applied by the page before it draws: language, tab, file picker', () => {
    expect(main).toMatch(/parsePreset\(location\.hash, /);
    expect(main).toMatch(/preset\.lang/);
    expect(main).toMatch(/preset\.tab/);
    expect(main).toMatch(/preset\.accept/);
  });
});

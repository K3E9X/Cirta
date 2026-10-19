import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * [F-P3 2.7] What an accessibility audit of the page found, kept from coming
 * back. The audit itself — axe-core in Chromium, both themes, both languages,
 * a keyboard walk — is scripts/a11y.mjs; these are the parts that can be read
 * off the source.
 */

const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/web/main.ts', import.meta.url), 'utf8');

const openingTag = (id: string): string => new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] ?? '';

describe('[F-P3 2.7] the drop zone', () => {
  it('is a drop target, not a button with buttons inside it', () => {
    const zone = openingTag('dropzone');
    expect(zone).not.toBe('');
    expect(zone).not.toMatch(/\brole=/);
    expect(zone).not.toMatch(/\btabindex=/);
  });

  it('holds a real button for choosing files, next to the one for a folder', () => {
    const zone = html.slice(html.indexOf('id="dropzone"'), html.indexOf('id="file-input"'));
    expect(zone).toMatch(/<button type="button" id="file-pick"/);
    expect(zone).toMatch(/<button type="button" id="folder-pick"/);
    expect(main).toMatch(/#file-pick/);
  });

  it('shows where the focus is when it is on one of its buttons', () => {
    expect(css).toMatch(/\.dropzone:focus-within/);
  });
});

describe('[F-P3 2.7] landmarks', () => {
  it('everything between the header and the footer is inside <main>', () => {
    const header = html.indexOf('</header>');
    const opened = html.indexOf('<main');
    const closed = html.indexOf('</main>');
    const footer = html.indexOf('<footer');
    expect(header).toBeGreaterThan(0);
    expect(html.slice(header + '</header>'.length, opened).replace(/<!--[\s\S]*?-->/g, '').trim()).toBe('');
    expect(html.slice(closed + '</main>'.length, footer).replace(/<!--[\s\S]*?-->/g, '').trim()).toBe('');
    expect(html.indexOf('<section class="hero"')).toBeGreaterThan(opened);
  });

  it('no label in the markup is written in one language only', () => {
    // A static aria-label does not follow the language switch; aria-labelledby on bilingual text does.
    expect([...html.matchAll(/\saria-label="[^"]*"/g)].map((m) => m[0])).toEqual([]);
  });
});

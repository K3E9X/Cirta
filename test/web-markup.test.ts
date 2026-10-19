import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * [C11.5] The tab buttons had no type, so they were submit buttons: inside a
 * form, or a browser extension wrapping the page in one, choosing a tab
 * submitted it. Every button in the page states what it is.
 */

const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/web/main.ts', import.meta.url), 'utf8');

describe('[C11.5] buttons in the page', () => {
  it('every <button> in the markup is type="button"', () => {
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.filter((tag) => !/\stype="button"/.test(tag))).toEqual([]);
  });

  it('buttons created by the script are type="button" too', () => {
    expect(main).toMatch(/if \(node instanceof HTMLButtonElement\) node\.type = 'button';/);
  });
});

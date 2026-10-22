import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * [F-P3 2.7] The theme: Auto follows the system, Light and Dark override it.
 * The choice is applied by the page's one inline script, before first paint,
 * so a reader who chose Light does not get a dark frame on every load.
 */

const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/web/main.ts', import.meta.url), 'utf8');

const openingTag = (id: string): string => new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] ?? '';
const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

function runInline(stored: string | null, throws = false): { theme: string | undefined; motion: boolean } {
  const attributes: Record<string, string> = {};
  const classes = new Set<string>();
  const documentElement = {
    classList: { add: (name: string) => classes.add(name) },
    dataset: attributes,
    setAttribute: (name: string, value: string) => (attributes[name.replace(/^data-/, '')] = value),
  };
  const localStorage = {
    getItem: (key: string) => {
      if (throws) throw new Error('SecurityError');
      return key === 'ciirta.theme' ? stored : null;
    },
  };
  const matchMedia = () => ({ matches: false });
  new Function('document', 'localStorage', 'matchMedia', inline)({ documentElement }, localStorage, matchMedia);
  return { theme: attributes['theme'], motion: classes.has('motion') };
}

describe('[F-P3 2.7] light and dark themes', () => {
  it('applies a stored choice before first paint, and only a valid one', () => {
    expect(runInline('light').theme).toBe('light');
    expect(runInline('dark').theme).toBe('dark');
    expect(runInline(null).theme).toBeUndefined();
    expect(runInline('purple').theme).toBeUndefined();
  });

  it('still starts when storage is refused, and keeps the motion switch', () => {
    expect(runInline(null, true)).toEqual({ theme: undefined, motion: true });
  });

  it('the forced dark theme and the system dark theme are the same colours', () => {
    const block = (selector: RegExp): string => {
      const found = selector.exec(css);
      expect(found).not.toBeNull();
      // The selector ends on the block's opening brace.
      const body = css.slice(found!.index + found![0].length);
      return body.slice(0, body.indexOf('}')).split('\n').map((line) => line.trim()).join('\n').trim();
    };
    const system = block(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/);
    const forced = block(/:root\[data-theme="dark"\] \{/);
    expect(system).toMatch(/--bg:/);
    expect(forced).toBe(system);
  });

  it('a forced theme also sets the colour scheme the browser draws its own controls in', () => {
    expect(css).toMatch(/:root\[data-theme="light"\] \{\s*color-scheme: light;/);
    expect(css).toMatch(/:root\[data-theme="dark"\] \{\s*color-scheme: dark;/);
  });

  it('a control in the header chooses it, and the choice is kept in this browser', () => {
    expect(openingTag('theme-toggle')).toMatch(/<button\b[^>]*type="button"/);
    expect(main).toMatch(/store\(STORE\.theme,/);
    expect(main).toMatch(/theme: 'ciirta\.theme'/);
  });
});

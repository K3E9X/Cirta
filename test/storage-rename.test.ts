import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * Ciirta was called Cirta. A browser that kept its rules, its personal-data
 * choice, its theme and its cleaning options under « cirta.* » keeps them:
 * the page's first script moves them to « ciirta.* », once, before anything
 * reads them.
 */

const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/web/main.ts', import.meta.url), 'utf8');
const inline = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;

function run(before: Record<string, string>) {
  const data = new Map(Object.entries(before));
  const localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  const attributes: Record<string, string> = {};
  const document = { documentElement: { classList: { add: () => {} }, setAttribute: (k: string, v: string) => (attributes[k] = v) } };
  new Function('localStorage', 'document', 'matchMedia', inline)(localStorage, document, () => ({ matches: true }));
  return { data: Object.fromEntries(data), attributes };
}

describe('the rename keeps what a browser stored', () => {
  it('moves every key the page uses from cirta.* to ciirta.*, and applies the theme at once', () => {
    const { data, attributes } = run({ 'cirta.rules': 'rules: []', 'cirta.rules.name': 'r.yaml', 'cirta.pii': '1', 'cirta.theme': 'dark', 'cirta.clean': '{"stripActive":true}' });
    expect(data).toEqual({ 'ciirta.rules': 'rules: []', 'ciirta.rules.name': 'r.yaml', 'ciirta.pii': '1', 'ciirta.theme': 'dark', 'ciirta.clean': '{"stripActive":true}' });
    expect(attributes['data-theme']).toBe('dark');
  });

  it('never overwrites a value already kept under the new name', () => {
    expect(run({ 'cirta.theme': 'dark', 'ciirta.theme': 'light' }).data).toEqual({ 'ciirta.theme': 'light' });
  });

  it('covers every key main.ts stores', () => {
    const keys = [...main.matchAll(/'ciirta\.([\w.]+)'/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(3);
    for (const key of keys) expect(inline).toContain(`'${key}'`);
  });
});

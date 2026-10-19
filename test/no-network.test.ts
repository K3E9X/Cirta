import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * [F-2.8] "No network" as SECURITY.md states it, checked rather than
 * promised: no source module imports a networking module or makes a
 * request; the page's policy forbids connections; the worker removes the
 * means before PDF.js is loaded.
 */

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.ts$/.test(name) ? [path] : [];
  });

const NETWORK = /from ['"](?:node:)?(?:http|https|http2|net|dns|tls|dgram|undici)['"]|(?<!async\s)\bfetch\s*\(|new XMLHttpRequest|new WebSocket|new EventSource|navigator\.sendBeacon|import\(['"]https?:/;

describe('[F-2.8] no network', () => {
  it('no source module imports a networking module or makes a request', () => {
    const offenders = files('src')
      .filter((file) => file !== join('src', 'web', 'worker.ts'))
      // [F-P2 2.7] The service worker fetches the site's own files, the ones the browser loads anyway; checked below.
      .filter((file) => file !== join('src', 'shared', 'site.ts'))
      .filter((file) => NETWORK.test(readFileSync(file, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')));
    expect(offenders).toEqual([]);
  });

  it('[F-P2 2.7] the service worker fetches only inside the site, and only what its cache lacks', () => {
    const source = readFileSync(join('src', 'shared', 'site.ts'), 'utf8');
    expect(source.match(/\bfetch\(/g)).toHaveLength(1);
    const guard = source.indexOf("if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return;");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(source.indexOf('fetch(request)'));
  });

  it('the page forbids every connection, and the worker removes the means before loading PDF.js', () => {
    expect(readFileSync('vite.config.ts', 'utf8')).toContain("\"connect-src 'none'\"");
    const worker = readFileSync('src/web/worker.ts', 'utf8');
    const removal = worker.indexOf("for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport']");
    expect(removal).toBeGreaterThan(0);
    expect(removal).toBeLessThan(worker.indexOf("import('./xray-engine.js')"));
  });
});

describe('[F-2.8] the page renders values as text', () => {
  it('no page module writes markup from a string', () => {
    const offenders = files(join('src', 'web')).filter((file) => /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

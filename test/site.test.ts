import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hashRows, matchHash, sha256Sums, serviceWorkerSource, webManifest } from '../src/shared/site.js';

type Handler = (event: Record<string, unknown>) => void;

/** Runs the generated worker against a stand-in for the browser's service worker globals. */
function load(source: string) {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, string>>([['ciirta-old', new Map()], ['someone-else', new Map()]]);
  const fetched: string[] = [];
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        addAll: async (urls: string[]) => urls.forEach((url) => store.set(new URL(url, 'https://k3e9x.github.io/Cirta/sw.js').href, `cached ${url}`)),
        match: async (request: { url: string }) => store.get(new URL(request.url).href.split('?')[0]!),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const self = {
    location: new URL('https://k3e9x.github.io/Cirta/sw.js'),
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const fetch = async (request: { url: string }) => {
    fetched.push(request.url);
    return `network ${request.url}`;
  };
  new Function('self', 'caches', 'fetch', 'URL', source)(self, caches, fetch, URL);
  const run = async (type: string, extra: Record<string, unknown>) => {
    let waited: Promise<unknown> | undefined;
    let responded: Promise<unknown> | undefined;
    handlers.get(type)!({ ...extra, waitUntil: (p: Promise<unknown>) => (waited = p), respondWith: (p: Promise<unknown>) => (responded = p) });
    await waited;
    return responded ? await responded : undefined;
  };
  return { run, stores, fetched };
}

describe('[F-P2 2.7] the site works offline', () => {
  const files = ['index.html', 'assets/index-abc.js', 'assets/worker-def.js', 'logo.svg'];
  const source = serviceWorkerSource(files, 'ciirta-1234');

  it('keeps the site’s own files on install, and drops its earlier caches but no one else’s', async () => {
    const sw = load(source);
    await sw.run('install', {});
    expect([...sw.stores.get('ciirta-1234')!.keys()]).toEqual([
      'https://k3e9x.github.io/Cirta/',
      'https://k3e9x.github.io/Cirta/index.html',
      'https://k3e9x.github.io/Cirta/assets/index-abc.js',
      'https://k3e9x.github.io/Cirta/assets/worker-def.js',
      'https://k3e9x.github.io/Cirta/logo.svg',
    ]);
    await sw.run('activate', {});
    expect([...sw.stores.keys()].sort()).toEqual(['ciirta-1234', 'someone-else']);
  });

  it('answers from the cache, and never touches a request to another site or anything but a GET', async () => {
    const sw = load(source);
    await sw.run('install', {});
    expect(await sw.run('fetch', { request: { url: 'https://k3e9x.github.io/Cirta/assets/index-abc.js', method: 'GET' } })).toBe('cached assets/index-abc.js');
    expect(await sw.run('fetch', { request: { url: 'https://k3e9x.github.io/Cirta/?lang=en', method: 'GET' } })).toBe('cached ./');
    expect(await sw.run('fetch', { request: { url: 'https://evil.example/collect', method: 'GET' } })).toBeUndefined();
    expect(await sw.run('fetch', { request: { url: 'https://k3e9x.github.io/Cirta/x', method: 'POST' } })).toBeUndefined();
    expect(await sw.run('fetch', { request: { url: 'https://k3e9x.github.io/other-project/', method: 'GET' } })).toBeUndefined();
    expect(sw.fetched).toEqual([]);
    // A file of the site the cache does not hold yet goes to the network, and only that.
    expect(await sw.run('fetch', { request: { url: 'https://k3e9x.github.io/Cirta/new.js', method: 'GET' } })).toBe('network https://k3e9x.github.io/Cirta/new.js');
  });

  it('describes the app for installation, scoped to the site', () => {
    const manifest = JSON.parse(webManifest());
    expect(manifest).toMatchObject({ name: 'Ciirta', start_url: './', scope: './', display: 'standalone' });
    expect(manifest.icons[0]).toMatchObject({ src: 'logo.svg', type: 'image/svg+xml', sizes: 'any' });
  });
});

describe('[F-P2 2.7] the site can be checked', () => {
  const hashes: Array<[string, string]> = [
    ['sw.js', 'b'.repeat(64)],
    ['assets/index-abc.js', 'a'.repeat(64)],
  ];

  it('lists every file as sha256sum writes it, in one order', () => {
    expect(sha256Sums(hashes)).toBe(`${'a'.repeat(64)}  assets/index-abc.js\n${'b'.repeat(64)}  sw.js\n`);
  });

  it('writes the same list into the page, escaped, and says which file a hash is', () => {
    expect(hashRows([['a<b>.js', 'c'.repeat(64)]])).toBe(`<tr><td><code>a&lt;b&gt;.js</code></td><td><code>${'c'.repeat(64)}</code></td></tr>`);
    expect(matchHash(hashes, 'A'.repeat(64))).toBe('assets/index-abc.js');
    expect(matchHash(hashes, 'f'.repeat(64))).toBeUndefined();
  });

  it('the deployment attests every file it publishes', () => {
    const workflow = readFileSync('.github/workflows/pages.yml', 'utf8');
    expect(workflow).toMatch(/attestations: write/);
    expect(workflow).toMatch(/uses: actions\/attest-build-provenance@v\d+[\s\S]*subject-path: ['"]?dist-web\/\*\*['"]?/);
    expect(workflow.indexOf('attest-build-provenance')).toBeGreaterThan(workflow.indexOf('npm run build:web'));
    expect(workflow.indexOf('attest-build-provenance')).toBeLessThan(workflow.indexOf('upload-pages-artifact'));
  });
});

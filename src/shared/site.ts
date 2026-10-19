/**
 * [F-P2 2.7] What the build adds so the site works offline and installs as
 * an app.
 *
 * The service worker keeps the site's own files — the list the build wrote
 * into it, nothing else — and answers from them. It never handles a request
 * outside the site's own folder: not another origin, not another project on
 * the same github.io host, not a POST. A document is never fetched in the
 * first place: it is read from the disk by the page, so the worker never
 * sees one. The page's policy only lets a worker come from the site itself
 * (`worker-src 'self'`).
 */

/** The worker's source: the files to keep, the cache they go in. */
export function serviceWorkerSource(files: string[], cache: string): string {
  return `// Cirta's service worker, written by the build. It keeps this site's files and nothing else.
const CACHE = ${JSON.stringify(cache)};
const FILES = ${JSON.stringify(['./', ...files])};
const SCOPE = new URL('./', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('cirta-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only this site's own files: another origin, another project on the same host, a POST are left alone.
  if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return;
  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(request, { ignoreSearch: true }).then((hit) => hit || fetch(request))),
  );
});
`;
}

/** The web app manifest: installable, scoped to the site's folder. */
export function webManifest(): string {
  return `${JSON.stringify(
    {
      name: 'Cirta',
      short_name: 'Cirta',
      description: 'Inspect and remove what documents say about where they came from — locally, nothing leaves the machine.',
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#ffffff',
      icons: [{ src: 'logo.svg', type: 'image/svg+xml', sizes: 'any', purpose: 'any' }],
    },
    null,
    2,
  )}\n`;
}

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { serviceWorkerSource, webManifest } from './src/shared/site.js';
import { defineConfig, type Plugin } from 'vite';

/**
 * The notices of what the site ships besides its own code, published next to
 * it. The worker carries PDF.js, its Foxit fonts and its JBIG2 and OpenJPEG
 * decoders; the BSD and Apache licences they come under ask for the notice to
 * travel with the binary.
 */
function thirdPartyLicences(): Plugin {
  const parts: Array<[string, string]> = [
    ['PDF.js (pdfjs-dist) — Apache License 2.0', 'pdfjs-dist/LICENSE'],
    ['PDF.js standard fonts (Foxit)', 'pdfjs-dist/standard_fonts/LICENSE_FOXIT'],
    ['PDF.js JBIG2 decoder', 'pdfjs-dist/wasm/LICENSE_PDFJS_JBIG2'],
    ['JBIG2 (PDFium)', 'pdfjs-dist/wasm/LICENSE_JBIG2'],
    ['PDF.js OpenJPEG decoder', 'pdfjs-dist/wasm/LICENSE_PDFJS_OPENJPEG'],
    ['OpenJPEG', 'pdfjs-dist/wasm/LICENSE_OPENJPEG'],
    ['pdf-lib — MIT', 'pdf-lib/LICENSE.md'],
    ['fflate — MIT', 'fflate/LICENSE'],
  ];
  return {
    name: 'cirta-third-party-licences',
    apply: 'build',
    generateBundle() {
      const text = parts
        .map(([title, path]) => `${title}\n${'='.repeat(title.length)}\n\n${readFileSync(new URL(`./node_modules/${path}`, import.meta.url), 'utf8').trim()}\n`)
        .join('\n\n');
      this.emitFile({ type: 'asset', fileName: 'third-party-licenses.txt', source: text });
    },
  };
}

/**
 * The page's Content-Security-Policy, written into the built HTML.
 *
 * `connect-src 'none'` is the point: the browser itself refuses any fetch,
 * XHR, WebSocket or beacon from the page, whatever the code tries — a promise
 * anyone can check with "view source" instead of taking on trust. The one
 * inline script is allowed by its hash, computed from the final HTML so an
 * edit to it cannot silently fall outside the policy.
 *
 * Build only: the dev server reloads over a WebSocket, which this would block.
 * A worker does not inherit a page's policy; the analysis worker removes its
 * own network functions before loading anything (see worker.ts).
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'cirta-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
          (match) => `'sha256-${createHash('sha256').update(match[1] ?? '').digest('base64')}'`,
        );
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`.trim(),
          "connect-src 'none'",
          "img-src 'self' data: blob:",
          "style-src 'self'",
          "font-src 'self'",
          "worker-src 'self'",
          "manifest-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; ');
        return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

/** Every file under a directory, as paths relative to it with forward slashes. */
function listFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(root, join(dir, entry.name)) : [relative(root, join(dir, entry.name)).split('\\').join('/')],
  );
}

/**
 * [F-P2 2.7] Offline and installable: a web app manifest, and a service worker
 * that keeps the files this build wrote — listed once they are on disk, so the
 * list is the build's and nothing else. Its cache is named after their
 * content, so a new build replaces it and an unchanged one keeps it.
 */
function progressiveApp(): Plugin {
  let base = '/';
  let outDir = '';
  return {
    name: 'cirta-progressive-app',
    apply: 'build',
    configResolved(config) {
      base = config.base;
      outDir = config.build.outDir.startsWith('/') ? config.build.outDir : join(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace('</head>', `    <link rel="manifest" href="${base}manifest.webmanifest" />\n  </head>`),
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: webManifest() });
    },
    closeBundle: {
      order: 'post',
      handler() {
        const files = listFiles(outDir).filter((file) => file !== 'sw.js').sort();
        const digest = createHash('sha256');
        for (const file of files) digest.update(`${file}\0`).update(readFileSync(join(outDir, file)));
        writeFileSync(join(outDir, 'sw.js'), serviceWorkerSource(files, `cirta-${digest.digest('hex').slice(0, 16)}`));
      },
    },
  };
}

/**
 * The site is served from https://<user>.github.io/Cirta/, so assets need that
 * base path. Override with CIRTA_BASE when deploying elsewhere (a custom
 * domain or the repository root) — e.g. `CIRTA_BASE=/ npm run build:web`.
 */
export default defineConfig({
  root: 'src/web',
  // The mark lives at the repository root so the README, the site and the CLI
  // transcription all refer to one file.
  publicDir: '../../assets',
  base: process.env['CIRTA_BASE'] ?? '/Cirta/',
  plugins: [contentSecurityPolicy(), thirdPartyLicences(), progressiveApp()],
  // [F-P2 2.7] The version a batch manifest records.
  define: { __CIRTA_VERSION__: JSON.stringify((JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version) },
  // ES modules, so the worker can load PDF.js as its own chunk instead of
  // making every file wait for it.
  worker: { format: 'es' },
  // PDF.js's standard fonts and image decoders, inlined into the worker as bytes.
  assetsInclude: ['**/*.pfb', '**/*.wasm'],
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
    target: 'es2022',
  },
});

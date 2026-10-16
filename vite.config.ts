import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';

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
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; ');
        return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
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
  plugins: [contentSecurityPolicy()],
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

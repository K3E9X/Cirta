import { defineConfig } from 'vite';

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
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
    target: 'es2022',
  },
});

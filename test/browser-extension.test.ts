import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extensionManifest, extensionPage, LEFT_OUT, POLICY } from '../scripts/build-browser-extension.mjs';

/*
 * [F-P2 2.6] The browser extension: what it is allowed to do, and the page it
 * carries. Loading it in Chromium is a manual check (REPORT_CLAUDE_CODE.md).
 */

describe('[F-P2 2.6] the browser extension', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

  it('asks for no permission and forbids every connection', () => {
    const manifest = extensionManifest(pkg.version);
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.permissions).toBeUndefined();
    expect(manifest.host_permissions).toBeUndefined();
    expect(Object.keys(manifest)).not.toContain('content_scripts');
    expect(manifest.content_security_policy.extension_pages).toBe(POLICY);
    expect(POLICY).toMatch(/connect-src 'none'/);
    expect(POLICY).toMatch(/script-src 'self' 'wasm-unsafe-eval';/);
    expect(POLICY).not.toMatch(/'unsafe-inline'|'unsafe-eval'|https?:/);
    // Chrome runs the worker, Firefox the script: one file for both.
    expect(manifest.background).toEqual({ service_worker: 'background.js', scripts: ['background.js'] });
    expect(manifest.browser_specific_settings.gecko.id).toBe('cirta@k3e9x.github.io');
  });

  it('carries the site’s page with its inline script moved to a file and the web-only parts left out', () => {
    const source = readFileSync('src/web/index.html', 'utf8').replace('<head>', '<head>\n    <link rel="manifest" href="./manifest.webmanifest" />');
    const { page, script } = extensionPage(source);
    expect(page).not.toMatch(/<script>/);
    expect(page).toMatch(/<script src="\.\/motion\.js"><\/script>/);
    expect(script).toMatch(/prefers-reduced-motion/);
    expect(page).not.toMatch(/rel="manifest"|id="verify-site"|offline-status|site-only|service worker/);
    // Everything else stays: the tool itself, both languages.
    expect(page).toMatch(/id="file-input"/);
    expect(page).toMatch(/id="folder-input"/);
    expect(page).toMatch(/data-lang="en"/);
    expect(LEFT_OUT).toEqual(['sw.js', 'manifest.webmanifest', 'SHA256SUMS']);
  });

  it('refuses a page it cannot make an extension page', () => {
    expect(() => extensionPage('<html><head></head><body></body></html>')).toThrow(/inline script/);
    expect(() => extensionPage('<html><head><script>1</script></head><body></body></html>')).toThrow(/site-only/);
  });

  it('the page without the « Check this site » box still starts', () => {
    // main.ts leaves the box alone when the page has none, instead of throwing before the tool is wired.
    const main = readFileSync('src/web/main.ts', 'utf8');
    const verify = main.slice(main.indexOf('function setupVerify'));
    expect(verify.split('\n').slice(0, 3).join('\n')).toMatch(/if \(!document\.querySelector\('#verify-site'\)\) return;/);
  });

  it('both extensions are built in CI, and attested and attached at release', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const job = ci.slice(ci.indexOf('\n  extensions:'));
    expect(job).toMatch(/build-vscode\.mjs --package[\s\S]*build-browser-extension\.mjs[\s\S]*web-ext@[\d.]+ lint --source-dir build\/browser-extension/);
    const release = readFileSync('.github/workflows/release.yml', 'utf8');
    const extensions = release.slice(release.indexOf('\n  extensions:'), release.indexOf('\n  github-release:'));
    expect(extensions).toMatch(/attest-build-provenance@v2[\s\S]*subject-path: 'build\/extensions\/\*'/);
    expect(release).toMatch(/needs: \[npm, binaries, extensions, single-file\]/);
  });

  it('the VS Code extension has the library’s version', () => {
    expect(JSON.parse(readFileSync('integrations/vscode/package.json', 'utf8')).version).toBe(pkg.version);
  });
});

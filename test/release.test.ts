import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { releaseProblems, REQUIRED_FILES } from '../scripts/check-release.mjs';
import { runCli } from './helpers/cli.js';

/*
 * [F-P2 2.8] A release is checked before anything is published: the tag, the
 * changelog, the licence, what the package carries, the provenance settings.
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const ready = {
  tag: `v${pkg.version}`,
  pkg,
  changelog: `# Changelog\n\n## [${pkg.version}] — 2026-11-02\n\n- …\n`,
  licence: 'MIT License\n\nCopyright (c) …',
  packed: REQUIRED_FILES,
};

describe('[F-P2 2.8] what a release must be before it is published', () => {
  it('lets a ready release through', () => {
    expect(releaseProblems(ready)).toEqual([]);
  });

  it('refuses a tag that is not the version, a version the changelog does not describe, a missing licence', () => {
    expect(releaseProblems({ ...ready, tag: 'v9.9.9' })).toEqual([`the tag v9.9.9 is not the package's version v${pkg.version}`]);
    expect(releaseProblems({ ...ready, changelog: '## [Unreleased]\n' })[0]).toMatch(/no "## \[.*\]" section/);
    expect(releaseProblems({ ...ready, licence: undefined })[0]).toMatch(/no LICENSE file/);
  });

  it('refuses a package that lacks the types or carries the sources', () => {
    expect(releaseProblems({ ...ready, packed: REQUIRED_FILES.filter((f) => f !== 'dist/core/index.d.ts') })).toEqual(['the package does not carry dist/core/index.d.ts']);
    expect(releaseProblems({ ...ready, packed: [...REQUIRED_FILES, 'src/core/pdf.ts', 'test/pdf.test.ts'] })[0]).toMatch(/carries what it should not: src\/core\/pdf.ts, test\/pdf.test.ts/);
  });

  it('asks npm for provenance, tied to this repository', () => {
    expect(pkg.publishConfig).toMatchObject({ provenance: true, access: 'public' });
    expect(pkg.repository.url).toMatch(/github\.com\/K3E9X\/Cirta/);
    expect(pkg.files).toEqual(expect.arrayContaining(['dist', 'schema', 'CHANGELOG.md']));
  });

  it('keeps a changelog with an Unreleased section and the version published so far', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    expect(changelog).toMatch(/^## \[Unreleased\]$/m);
    expect(changelog).toMatch(/^## \[0\.1\.0\]$/m);
    // The version being released has its own section, dated, and every heading its link.
    expect(changelog).toMatch(new RegExp(`^## \\[${pkg.version.replace(/\./g, '\\.')}\\] — \\d{4}-\\d{2}-\\d{2}$`, 'm'));
    for (const [, heading] of changelog.matchAll(/^## \[([^\]]+)\]/gm)) expect(changelog).toMatch(new RegExp(`^\\[${heading!.replace(/\./g, '\\.')}\\]: https://github\\.com/K3E9X/Cirta/`, 'm'));
  });

  // [Release 0.2.0] The licence the package declares, with its holder, and the real release passes its own check.
  it('carries the MIT licence with its holder, and the release as it stands passes its check', () => {
    const licence = readFileSync('LICENSE', 'utf8');
    expect(pkg.license).toBe('MIT');
    expect(licence).toMatch(/^MIT License\n\nCopyright \(c\) \d{4} K3E9X\n/);
    expect(licence).toMatch(/THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/);
    const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8', shell: process.platform === 'win32' }))[0].files.map((f: { path: string }) => f.path);
    expect(releaseProblems({ tag: `v${pkg.version}`, pkg, changelog: readFileSync('CHANGELOG.md', 'utf8'), licence, packed })).toEqual([]);
  }, 60_000);

  // [Release 0.2.0] Every place that names Ciirta's version names package.json's.
  it('states one version everywhere: the editor extension, the MCP server, the SARIF report', () => {
    expect(JSON.parse(readFileSync('integrations/vscode/package.json', 'utf8')).version).toBe(pkg.version);
    expect(readFileSync('src/cli/mcp.ts', 'utf8')).not.toMatch(/'\d+\.\d+\.\d+'/);
    const sarif = JSON.parse(runCli(['inspect', '--sarif', 'examples/library.mjs']).stdout.toString());
    expect(sarif.runs[0].tool.driver.version).toBe(pkg.version);
  });

  it('publishes from a version tag only, after the checks, with npm provenance', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(workflow).toMatch(/on:\n  push:\n    tags: \['v\*'\]/);
    const npm = workflow.slice(workflow.indexOf('\n  npm:'));
    expect(npm).toMatch(/needs: check/);
    // [Release 0.2.0] Only once npm publishing is set up: the repository variable says so.
    expect(npm.slice(0, npm.indexOf('steps:'))).toMatch(/if: vars\.PUBLISH_NPM == 'true'/);
    expect(npm).toMatch(/id-token: write/);
    expect(npm.indexOf('check-release.mjs')).toBeGreaterThan(0);
    expect(npm.indexOf('npm publish --provenance')).toBeGreaterThan(npm.indexOf('check-release.mjs'));
    expect(workflow.slice(0, workflow.indexOf('\n  npm:'))).toMatch(/npm run verify[\s\S]*check-release\.mjs/);
  });

  it('says which version it is, as a binary must', () => {
    const run = runCli(['--version']);
    expect(run.status).toBe(0);
    expect(run.stdout.toString().trim()).toBe(`ciirta ${pkg.version}`);
  });

  it('releases single-file binaries for three systems, each built, run and attested, and builds them in CI too', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    const binaries = workflow.slice(workflow.indexOf('\n  binaries:'), workflow.indexOf('\n  github-release:'));
    expect(binaries).toMatch(/needs: check/);
    expect(binaries).toMatch(/os: \[ubuntu-latest, windows-latest, macos-latest\]/);
    expect(binaries.indexOf('node scripts/build-sea.mjs')).toBeLessThan(binaries.indexOf('attest-build-provenance'));
    expect(binaries).toMatch(/subject-path: 'build\/sea\/ciirta-\*'/);
    // [Release 0.2.0] The GitHub release does not wait on npm, which may not be set up.
    const release = workflow.slice(workflow.indexOf('\n  github-release:'));
    expect(release).toMatch(/needs: \[binaries, extensions, single-file\][\s\S]*contents: write/);
    // A release made by hand from GitHub's page, which pushes the tag, gets the files too.
    expect(release).toMatch(/gh release view[\s\S]*gh release upload[\s\S]*--clobber[\s\S]*gh release create/);
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci.slice(ci.indexOf('\n  sea:'))).toMatch(/windows-latest, macos-latest[\s\S]*node scripts\/build-sea\.mjs/);
  });
});


describe('[F-P2 2.8] the workflows are valid YAML', () => {
  // A one-line `run:` is a plain scalar: a ": " or " #" in it ends the value or
  // starts a comment, and GitHub rejects the whole workflow. The release one did.
  it.each(['.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/pages.yml'])('%s', (file) => {
    const plain = readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => /^\s*(?:- )?run: (.*)$/.exec(line)?.[1])
      .filter((value): value is string => value !== undefined && !/^["'|>]/.test(value));
    for (const value of plain) expect(value).not.toMatch(/: | #/);
  });
});

describe('[F-P2 2.8] text files keep LF line endings', () => {
  // A test imports scripts/*.mjs, whose #! line vite-node strips only when it
  // ends in LF, and reads the workflows and the changelog line by line;
  // Windows checkouts convert to CRLF unless told otherwise.
  it('on every system, by .gitattributes', () => {
    expect(readFileSync('.gitattributes', 'utf8')).toMatch(/^\* text=auto eol=lf$/m);
    for (const file of ['scripts/check-release.mjs', '.github/workflows/release.yml', 'CHANGELOG.md']) {
      expect(execFileSync('git', ['check-attr', 'eol', file], { encoding: 'utf8' }).trim()).toBe(`${file}: eol: lf`);
    }
  });
});

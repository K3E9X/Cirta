import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { annotations, escapeData, summary } from '../scripts/sarif-annotations.mjs';
import { runCli } from './helpers/cli.js';
import { makeDocx } from './fixtures.js';

/*
 * [F-P2 2.6] The GitHub Action: what it runs, the annotations it writes from
 * the SARIF, and the same command run against a pull request's branch.
 */

describe('[F-P2 2.6] the GitHub Action', () => {
  const action = readFileSync('action.yml', 'utf8');

  it('inspects what the pull request changes, writes SARIF, annotates, then gives the verdict', () => {
    expect(action).toMatch(/^runs:\n {2}using: composite$/m);
    const inspect = action.indexOf('inspect --changed-only --base "$BASE" --sarif --fail-on "$FAIL_ON"');
    expect(inspect).toBeGreaterThan(0);
    expect(action.indexOf('sarif-annotations.mjs')).toBeGreaterThan(inspect);
    expect(action).toMatch(/format\('origin\/\{0\}', github\.base_ref\)/);
    expect(action).toMatch(/uses: github\/codeql-action\/upload-sarif@v3/);
    expect(action.indexOf('name: Verdict')).toBeGreaterThan(action.indexOf('upload-sarif@v3'));
    // The example a repository copies.
    const example = readFileSync('examples/github-action.yml', 'utf8');
    expect(example).toMatch(/pull_request:/);
    expect(example).toMatch(/fetch-depth: 0/);
    expect(example).toMatch(/uses: K3E9X\/Cirta@/);
    // And CI runs it on this repository's own pull requests.
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci.slice(ci.indexOf('\n  action:'))).toMatch(/pull_request[\s\S]*fetch-depth: 0[\s\S]*uses: \.\//);
  });

  it('writes one annotation per result, escaped so a value cannot end the command', () => {
    const sarif = {
      runs: [
        {
          tool: { driver: { rules: [{ id: 'cirta/author', name: 'Author' }] } },
          results: [
            { ruleId: 'cirta/author', level: 'error', message: { text: 'Author: Jeanne, 100%\n::error::forged' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'docs/a,b.docx' } } }] },
            { ruleId: 'cirta/author', level: 'note', message: { text: 'x' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'c.txt' } } }] },
          ],
        },
      ],
    };
    expect(annotations(sarif)).toEqual([
      '::error file=docs/a%2Cb.docx,title=Cirta%3A Author::Author: Jeanne, 100%25%0A::error::forged',
      '::notice file=c.txt,title=Cirta%3A Author::x',
    ]);
    expect(escapeData('a\r\nb')).toBe('a%0D%0Ab');
    expect(summary(sarif)).toContain('| error | `docs/a,b.docx` | `Author` |');
    expect(summary({ runs: [{ results: [] }] })).toContain('Nothing found');
  });

  it('run against a pull request’s branch, finds what it changed and only that', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cirta-action-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@e.com');
    git('config', 'user.name', 'T');
    writeFileSync(join(dir, 'ancien.txt'), 'Bon​jour');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'pr');
    writeFileSync(join(dir, 'lettre.docx'), makeDocx());
    git('add', '.');
    git('commit', '-q', '-m', 'pr');
    const run = runCli(['inspect', '--changed-only', '--base', 'main', '--sarif', '--fail-on', 'confirmed'], undefined, { cwd: dir });
    expect(run.status).toBe(1);
    const lines = annotations(JSON.parse(run.stdout.toString()));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.includes('file=lettre.docx'))).toBe(true);
    expect(lines.some((line) => line.startsWith('::error ') && line.includes('Lotfi Zakaria'))).toBe(true);
  });
});

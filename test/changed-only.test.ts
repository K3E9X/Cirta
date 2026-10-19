import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from './helpers/cli.js';
import { makeDocx } from './fixtures.js';

/*
 * [F-P2 2.6] --changed-only: what a commit or a pull request touches, not the
 * whole tree. Staged files by default, as a pre-commit hook sees them; with
 * --base <ref>, what changed since that ref, as a pull request does.
 */

function repository(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cirta-changed-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'ancien.txt'), 'Bon​jour');
  writeFileSync(join(dir, 'propre.txt'), 'Bonjour');
  git('add', '.');
  git('commit', '-q', '-m', 'premier');
  git('checkout', '-q', '-b', 'branche');
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'lettre.docx'), makeDocx());
  writeFileSync(join(dir, 'propre.txt'), 'Bonjour, de nouveau');
  git('add', '.');
  git('commit', '-q', '-m', 'second');
  // Staged, not committed; and a file changed but not staged.
  writeFileSync(join(dir, 'brouillon.txt'), 'Note​');
  git('add', 'brouillon.txt');
  writeFileSync(join(dir, 'ancien.txt'), 'Bon​jour !');
  return dir;
}

const files = (stdout: Buffer) => (JSON.parse(stdout.toString()) as Array<{ file: string }>).map((entry) => entry.file.replace(/\\/g, '/')).sort();

describe('[F-P2 2.6] --changed-only', () => {
  it('takes the staged files, as a pre-commit hook sees them', () => {
    const dir = repository();
    const run = runCli(['inspect', '--json', '--changed-only'], undefined, { cwd: dir });
    expect(run.status).toBe(0);
    expect(files(run.stdout)).toEqual(['brouillon.txt']);
  });

  it('takes what changed since --base, as a pull request does, renamed and deleted files aside', () => {
    const dir = repository();
    const run = runCli(['inspect', '--json', '--changed-only', '--base', 'main'], undefined, { cwd: dir });
    expect(run.status).toBe(0);
    expect(files(run.stdout)).toEqual(['docs/lettre.docx', 'propre.txt']);
    // Paths narrow it further.
    expect(files(runCli(['inspect', '--json', '--changed-only', '--base', 'main', 'docs'], undefined, { cwd: dir }).stdout)).toEqual(['docs/lettre.docx']);
  });

  it('fails a verify on what changed only, and says so when nothing did', () => {
    const dir = repository();
    expect(runCli(['verify', '--changed-only', '--base', 'main'], undefined, { cwd: dir }).status).toBe(1);
    const none = runCli(['verify', '--lang', 'fr', '--changed-only', '--base', 'HEAD'], undefined, { cwd: dir });
    expect(none.status).toBe(0);
    expect(none.stderr.toString() + none.stdout.toString()).toContain('Aucun fichier pris en charge modifié');
  });

  it('refuses outside a repository, and an unknown base, saying why', () => {
    const outside = mkdtempSync(join(tmpdir(), 'cirta-nogit-'));
    const run = runCli(['inspect', '--lang', 'fr', '--changed-only'], undefined, { cwd: outside });
    expect(run.status).toBe(2);
    expect(run.stderr.toString()).toContain('--changed-only demande un dépôt git');
    const bad = runCli(['inspect', '--lang', 'fr', '--changed-only', '--base', 'nulle-part'], undefined, { cwd: repository() });
    expect(bad.status).toBe(2);
    expect(bad.stderr.toString()).toContain('nulle-part');
  });
});

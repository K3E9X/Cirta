/**
 * [F-P2 2.6] The files a commit or a pull request touches, from git.
 *
 *   --changed-only               the staged files: what `git commit` would record,
 *                                which is what a pre-commit hook must judge
 *   --changed-only --base <ref>  what changed between <ref> and HEAD (<ref>...HEAD),
 *                                which is what a pull request brings
 *
 * Added, copied, modified and renamed files only: a deleted file carries
 * nothing any more. The paths come back relative to where the command runs,
 * filtered as a folder walk would be — supported formats, no tool directory
 * — and, when paths are given, narrowed to those.
 *
 * Everything is worked out inside the repository, from git's own prefix for
 * the current folder, never by comparing absolute paths: one folder can be
 * spelled two ways (a symbolic link; on Windows, C:\Users\RUNNER~1 for
 * C:\Users\runneradmin), and git answers with its own spelling.
 */

import { execFileSync } from 'node:child_process';
import { posix, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { isSupportedFile, isWalkedDirectory } from '../shared/files.js';

export class ChangedFilesError extends Error {
  constructor(readonly reason: 'not-a-repository' | 'unknown-base', readonly detail = '') {
    super(reason);
  }
}

const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function changedFiles(base: string | undefined, within: string[], cwd = process.cwd()): string[] {
  let prefix: string;
  try {
    // Where `cwd` is inside the repository: '' at its root, 'docs/' below.
    prefix = git(['rev-parse', '--show-prefix'], cwd).trim();
  } catch {
    throw new ChangedFilesError('not-a-repository');
  }
  if (base !== undefined) {
    try {
      git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], cwd);
    } catch {
      throw new ChangedFilesError('unknown-base', base);
    }
  }
  const listed = git(base === undefined ? ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'] : ['diff', '--name-only', '-z', '--diff-filter=ACMR', `${base}...HEAD`], cwd)
    .split('\0')
    .filter(Boolean);
  // The paths asked for, as git names them: relative to the repository's root.
  const roots = within.map((path) => posix.normalize(posix.join(prefix, relative(cwd, resolve(cwd, path)).split(sep).join('/'))).replace(/\/$/, ''));
  return listed
    .filter((path) => {
      const parts = path.split('/');
      return isSupportedFile(parts.at(-1) ?? '') && parts.slice(0, -1).every((dir) => isWalkedDirectory(dir));
    })
    .filter((path) => roots.length === 0 || roots.some((root) => root === '.' || path === root || path.startsWith(`${root}/`)))
    .map((path) => (prefix ? posix.relative(prefix, path) : path))
    .sort();
}

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
 */

import { execFileSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { isSupportedFile, isWalkedDirectory } from '../shared/files.js';

export class ChangedFilesError extends Error {
  constructor(readonly reason: 'not-a-repository' | 'unknown-base', readonly detail = '') {
    super(reason);
  }
}

const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function changedFiles(base: string | undefined, within: string[], cwd = process.cwd()): string[] {
  let top: string;
  try {
    top = git(['rev-parse', '--show-toplevel'], cwd).trim();
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
  const roots = within.map((path) => resolve(cwd, path));
  return listed
    .filter((path) => {
      const parts = path.split('/');
      return isSupportedFile(parts.at(-1) ?? '') && parts.slice(0, -1).every((dir) => isWalkedDirectory(dir));
    })
    .map((path) => join(top, path))
    .filter((absolute) => roots.length === 0 || roots.some((root) => absolute === root || absolute.startsWith(root.endsWith(sep) ? root : root + sep)))
    .map((absolute) => {
      const path = relative(cwd, absolute);
      return isAbsolute(path) ? absolute : path;
    })
    .sort();
}

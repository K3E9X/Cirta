import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_EXTENSIONS, SUPPORTED_NAMES } from '../src/shared/files.js';

/*
 * [F-P2 2.6] The pre-commit hook's definition. The hook itself is tried with
 * pre-commit in the report's manual check; here, that it takes exactly the
 * files a folder walk takes, and runs verify on them.
 */

const hooks = readFileSync('.pre-commit-hooks.yaml', 'utf8');
const pattern = new RegExp(/^ {2}files: \(\?i\)(.+)$/m.exec(hooks)![1]!, 'i');

describe('[F-P2 2.6] the pre-commit hook', () => {
  it('runs the installed cirta verify; installed from git, the package builds itself', () => {
    expect(hooks).toMatch(/^- id: cirta$/m);
    expect(hooks).toMatch(/^ {2}entry: cirta verify$/m);
    expect(hooks).toMatch(/^ {2}language: system$/m);
    // npm install git+https://… prepares a git dependency: the package builds itself then.
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts.prepare).toBe('npm run build');
  });

  it('takes the files a folder walk takes, and no others', () => {
    for (const extension of SUPPORTED_EXTENSIONS) expect(pattern.test(`docs/a${extension}`), extension).toBe(true);
    for (const name of SUPPORTED_NAMES) expect(pattern.test(`config/${name}`), name).toBe(true);
    for (const other of ['a.exe', 'a.docx.bak', 'Makefile', 'a.pdfx']) expect(pattern.test(other), other).toBe(false);
    expect(pattern.test('RAPPORT.PDF')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/*
 * Everything under src/core and src/shared runs in two places: the CLI, under
 * Node, and the web worker, in a browser. Only the first has Node's globals.
 *
 * This exists because a `Buffer.from(data).toString('latin1')` reached the
 * deployed page and made every PDF fail with "Buffer is not defined". The
 * entire suite passed, because every test runs under Node, and the bundler does
 * not complain either — `Buffer` is a plain free identifier to esbuild. Nothing
 * in the pipeline could have caught it, so the check has to be explicit.
 *
 * It reads the syntax tree rather than the text. A text scan flagged the very
 * comment above, and teaching a regex to tell code from prose is how a guard
 * ends up with exceptions carved into it until it guards nothing. The compiler
 * is already a dependency; it knows where the code is.
 */

const NODE_ONLY = new Set(['Buffer', 'process', 'require', '__dirname', '__filename']);

function sourcesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesIn(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** Every Node-only name this file refers to, and every `node:` module it imports. */
function nodeOnlyReferences(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.moduleSpecifier.text.startsWith('node:')) found.push(node.moduleSpecifier.text);
    }
    if (ts.isIdentifier(node) && NODE_ONLY.has(node.text)) {
      // `thing.process` is a property of someone else's object, not the global.
      const parent = node.parent;
      const isMemberName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node);
      if (!isMemberName) found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return [...new Set(found)];
}

describe('code shared with the browser', () => {
  const files = [...sourcesIn('src/core'), ...sourcesIn('src/shared')];

  it('finds the shared sources', () => {
    // Guards against the scan silently passing because it read nothing.
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${file} uses no Node-only global`, () => {
      expect(nodeOnlyReferences(file)).toEqual([]);
    });
  }

  it('catches a Node-only global when there is one', () => {
    // The guard is only worth running if it can still fail.
    const probe = ts.createSourceFile(
      'probe.ts',
      'const text = Buffer.from(data).toString("latin1");',
      ts.ScriptTarget.ESNext,
      true,
    );
    let hit = false;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && NODE_ONLY.has(node.text)) hit = true;
      ts.forEachChild(node, visit);
    };
    visit(probe);
    expect(hit).toBe(true);
  });
});

import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';
import { toDiagnostics } from '../integrations/vscode/src/diagnostics.js';
import { inspectFile } from '../src/core/index.js';
import { makeDocx } from './fixtures.js';

/*
 * [F-P2 2.6] The VS Code extension. The mapping from findings to diagnostics
 * on its own, then the bundled extension itself, loaded as the editor loads
 * it but against a stand-in for the editor's API: activated, a document
 * opened, its commands run on files on the disk.
 */

const ZWSP = '​';

describe('[F-P2 2.6] VS Code: findings as diagnostics', () => {
  it('underlines each invisible character where it is, and puts the rest at the start of the file', async () => {
    const text = `Bonjour${ZWSP}\nla suite\n  et ${ZWSP}la fin\n`;
    const { findings } = await inspectFile(new TextEncoder().encode(text), 'note.md');
    const diagnostics = toDiagnostics(findings, 'en', text);
    const invisible = diagnostics.filter((d) => d.range.endCharacter > d.range.character);
    expect(invisible.map((d) => d.range)).toEqual([
      { line: 0, character: 7, endLine: 0, endCharacter: 8 },
      { line: 2, character: 5, endLine: 2, endCharacter: 6 },
    ]);
    expect(invisible[0]!.severity).toBe('error');
    expect(invisible[0]!.message).toMatch(/U\+200B/);
  });

  it('places a document property at the start, in the editor’s language', async () => {
    const { findings } = await inspectFile(makeDocx(), 'rapport.docx');
    const author = toDiagnostics(findings, 'fr').find((d) => /Lotfi Zakaria/.test(d.message))!;
    expect(author.range).toEqual({ line: 0, character: 0, endLine: 0, endCharacter: 0 });
    expect(author.message).toMatch(/Auteur/);
  });
});

/** Just enough of the `vscode` module for the extension to run. */
function fakeVscode(language: string) {
  const listeners: Record<string, Array<(document: unknown) => void>> = {};
  const on = (event: string) => (listener: (document: unknown) => void) => {
    (listeners[event] ??= []).push(listener);
    return { dispose() {} };
  };
  const collections = new Map<string, unknown[]>();
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const messages: string[] = [];
  class Uri {
    constructor(readonly scheme: string, readonly path: string) {}
    // As VS Code's: forward slashes on every system (C:\a\b.txt is /C:/a/b.txt).
    static file(path: string) {
      const slashed = path.replace(/\\/g, '/');
      return new Uri('file', slashed.startsWith('/') ? slashed : `/${slashed}`);
    }
    get fsPath() {
      return /^\/[A-Za-z]:\//.test(this.path) ? this.path.slice(1) : this.path;
    }
    with(change: { path: string }) {
      return new Uri(this.scheme, change.path);
    }
    toString() {
      return `${this.scheme}://${this.path}`;
    }
  }
  class Range {
    constructor(readonly startLine: number, readonly startCharacter: number, readonly endLine: number, readonly endCharacter: number) {}
  }
  class Diagnostic {
    source?: string;
    code?: string;
    constructor(readonly range: Range, readonly message: string, readonly severity: number) {}
  }
  const api = {
    Uri,
    Range,
    Diagnostic,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    env: { language },
    window: {
      activeTextEditor: undefined,
      showInformationMessage: (message: string) => messages.push(message),
      showWarningMessage: (message: string) => messages.push(message),
    },
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri: Uri, diagnostics: unknown[]) => collections.set(uri.toString(), diagnostics),
        delete: (uri: Uri) => collections.delete(uri.toString()),
        dispose() {},
      }),
    },
    commands: {
      registerCommand: (id: string, run: (...args: unknown[]) => unknown) => {
        commands.set(id, run);
        return { dispose() {} };
      },
    },
    workspace: {
      textDocuments: [],
      fs: {
        readFile: async (uri: Uri) => new Uint8Array(readFileSync(uri.fsPath)),
        writeFile: async (uri: Uri, data: Uint8Array) => writeFileSync(uri.fsPath, data),
      },
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      onDidOpenTextDocument: on('open'),
      onDidSaveTextDocument: on('save'),
      onDidCloseTextDocument: on('close'),
    },
  };
  return { api, listeners, collections, commands, messages };
}

describe('[F-P2 2.6] VS Code: the bundled extension', () => {
  const work = mkdtempSync(join(tmpdir(), 'ciirta-vscode-'));
  const bundle = join(work, 'extension.js');
  const manifest = JSON.parse(readFileSync('integrations/vscode/package.json', 'utf8'));

  beforeAll(async () => {
    await build({
      entryPoints: ['integrations/vscode/src/extension.ts'],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['vscode'],
      define: { CIIRTA_VERSION: '"test"' },
      logLevel: 'error',
    });
  }, 60_000);

  function load(language = 'en') {
    const vscode = fakeVscode(language);
    const module = { exports: {} as { activate(context: { subscriptions: unknown[] }): void } };
    const require = createRequire(bundle);
    new Function('require', 'module', 'exports', '__filename', '__dirname', readFileSync(bundle, 'utf8'))(
      (id: string) => (id === 'vscode' ? vscode.api : require(id)),
      module,
      module.exports,
      bundle,
      dirname(bundle),
    );
    module.exports.activate({ subscriptions: [] });
    return vscode;
  }

  it('registers the commands its manifest declares, and nothing else', () => {
    const { commands } = load();
    expect([...commands.keys()].sort()).toEqual(manifest.contributes.commands.map((c: { command: string }) => c.command).sort());
    expect(manifest.main).toBe('./dist/extension.js');
    expect(manifest.engines.vscode).toBe('^1.90.0');
  });

  it('inspects a text file when it is opened', async () => {
    const vscode = load();
    const path = join(work, 'note.txt');
    const text = `Bon${ZWSP}jour\n`;
    writeFileSync(path, text);
    const uri = vscode.api.Uri.file(path);
    for (const listener of vscode.listeners.open!) listener({ uri, getText: () => text });
    await expect.poll(() => vscode.collections.get(uri.toString())?.length).toBeGreaterThan(0);
    const [diagnostic] = vscode.collections.get(uri.toString()) as Array<{ range: { startLine: number; startCharacter: number }; source: string; severity: number }>;
    expect(diagnostic).toMatchObject({ range: { startLine: 0, startCharacter: 3 }, source: 'Ciirta', severity: 0 });
  });

  it('inspects a Word file from the Explorer, then writes a cleaned copy beside it', async () => {
    const vscode = load('fr');
    const path = join(work, 'rapport.docx');
    // Kept, to compare with: the fixture's ZIP dates follow the clock.
    const original = makeDocx();
    writeFileSync(path, original);
    const uri = vscode.api.Uri.file(path);
    await vscode.commands.get('ciirta.inspect')!(uri);
    const found = vscode.collections.get(uri.toString()) as Array<{ message: string }>;
    expect(found.some((d) => /Lotfi Zakaria/.test(d.message))).toBe(true);
    expect(vscode.messages.at(-1)).toMatch(/^Ciirta : \d+ constats? — voir le panneau Problèmes\.$/);

    await vscode.commands.get('ciirta.clean')!(uri);
    const cleaned = join(work, 'rapport.clean.docx');
    expect(existsSync(cleaned)).toBe(true);
    const after = await inspectFile(new Uint8Array(readFileSync(cleaned)), 'rapport.clean.docx');
    expect(after.findings.some((f) => /Lotfi Zakaria/.test(f.value))).toBe(false);
    expect(vscode.messages.at(-1)).toMatch(/^Ciirta : \d+ retirés? → rapport\.clean\.docx$/);
    // The original is untouched.
    expect(new Uint8Array(readFileSync(path))).toEqual(original);
  });
});

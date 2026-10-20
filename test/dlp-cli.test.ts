import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from './helpers/cli.js';

/* [F-2.3] --pii and --rules from the command line, and a rules file that does not read. */

function dir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'ciirta-dlp-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(d, name), content);
  return d;
}

describe('[F-2.3] DLP from the command line', () => {
  it('reports personal data with --pii, masked, in French', () => {
    const d = dir({ 'note.txt': 'IBAN FR76 3000 6000 0112 3456 7890 189, écrire à jean@exemple.fr' });
    const out = runCli(['inspect', '--lang', 'fr', '--pii', join(d, 'note.txt')]).stdout.toString();
    expect(out).toContain('FR76 •••• •••• •••• •••• •••• 189');
    expect(out).toContain('Adresse e-mail');
    expect(out).not.toContain('3000 6000');
  });

  it('applies an organisation’s rules, and verify fails on them', () => {
    const d = dir({ 'note.txt': 'Lancement du projet Orion', 'regles.yaml': 'rules:\n  - id: p\n    label: Projet interne\n    level: confirmed\n    words: [Orion]\n' });
    expect(runCli(['inspect', '--rules', join(d, 'regles.yaml'), join(d, 'note.txt')]).stdout.toString()).toContain('Projet interne');
    expect(runCli(['verify', '--rules', join(d, 'regles.yaml'), join(d, 'note.txt')]).status).toBe(1);
  });

  it('refuses a rules file it cannot read, in French, exit 2', () => {
    const d = dir({ 'note.txt': 'x', 'regles.yaml': 'rules:\n  - id: p\n    level: urgent\n    words: [a]\n' });
    const run = runCli(['inspect', '--lang', 'fr', '--rules', join(d, 'regles.yaml'), join(d, 'note.txt')]);
    expect(run.status).toBe(2);
    expect(run.stderr.toString()).toContain('Le fichier de règles n’a pas pu être lu : règle p : un libellé (label) est requis');
  });
});

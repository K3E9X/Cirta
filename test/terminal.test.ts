import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { runCli } from './helpers/cli.js';
import { terminalSafe } from '../src/cli/terminal.js';

/*
 * [C2] A PDF's /Author went to the terminal byte for byte: ESC and BEL raw. A
 * crafted file could set the window title, erase or rewrite lines of the
 * report — hiding a confirmed finding — open OSC 8 links, or write to the
 * clipboard through OSC 52. Nothing read from a file reaches the terminal as
 * a control, in any output mode.
 */

const FAMILIES: Record<string, string> = {
  'CSI (colour, erase line)': '\x1b[31mROUGE\x1b[0m\x1b[2K\rfaux',
  'OSC (title, hyperlink, clipboard)': '\x1b]0;PWNED\x07\x1b]8;;https://evil.test\x07lien\x1b]8;;\x07\x1b]52;c;ZXZpbA==\x07',
  'BEL and other C0': 'cloche\x07\x08\x0b\x0c\x7f',
  'C1 controls': 'c1\u009b31mrouge\u009d0;titre\u009c',
  'bidi overrides and isolates': 'facture‮fdp.exe⁦isolé⁩‏',
};

// Anything a terminal acts on rather than prints.
const RAW_CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f‪-‮⁦-⁩‎‏؜]/;

async function pdfWithAuthor(author: string): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.setAuthor(author);
  doc.setTitle(`titre ${author}`);
  const dir = mkdtempSync(join(tmpdir(), 'ciirta-c2-'));
  const path = join(dir, 'inject.pdf');
  writeFileSync(path, await doc.save());
  return path;
}

describe('[C2] the terminal sanitizer', () => {
  for (const [family, sample] of Object.entries(FAMILIES)) {
    it(`leaves no raw ${family}`, () => {
      expect(terminalSafe(sample)).not.toMatch(RAW_CONTROL);
    });
  }

  it('keeps the text readable: tab becomes a space, line breaks flatten, ESC shows as ␛', () => {
    expect(terminalSafe('a\tb\nc\r\nd')).toBe('a b c d');
    expect(terminalSafe('\x1b[31m')).toBe('␛[31m');
  });

  it('leaves ordinary text, accents and emoji alone', () => {
    const text = 'Rapport « final » — café, 😀, مرحبا';
    expect(terminalSafe(text)).toBe(text);
  });
});

describe('[C2] the command line', () => {
  for (const [family, sample] of Object.entries(FAMILIES)) {
    it(`prints no raw ${family} in the report, as text, JSON or SARIF`, async () => {
      const path = await pdfWithAuthor(sample);
      for (const mode of [[], ['--json'], ['--sarif']]) {
        const run = runCli(['inspect', path, ...mode]);
        const out = run.stdout.toString('utf8') + run.stderr.toString('utf8');
        expect(out, `${family} ${mode.join(' ')}`).not.toMatch(RAW_CONTROL);
      }
    });
  }

  it('keeps the value findable: the author is still in the report, made visible', async () => {
    const run = runCli(['inspect', await pdfWithAuthor('\x1b]0;PWNED\x07Jean')]);
    expect(run.stdout.toString()).toContain('␛]0;PWNED␇Jean');
  });

  it('shows a file name with controls in it without obeying them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ciirta-c2-'));
    const path = join(dir, 'a‮fdp.txt');
    writeFileSync(path, 'texte');
    const run = runCli(['inspect', path]);
    expect(run.stdout.toString() + run.stderr.toString()).not.toMatch(RAW_CONTROL);
  });
});

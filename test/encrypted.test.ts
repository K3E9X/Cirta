import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectFile, redactFile, UnsupportedFormatError } from '../src/core/index.js';
import { assertReadablePdf } from '../src/core/pdf.js';
import { nodeXrayEngine } from '../src/cli/xray-engine.js';
import { encryptedPdf } from './helpers/encrypted-pdf.js';
import { runCli } from './helpers/cli.js';

/*
 * [C1] An encrypted PDF went through the cleaner and came out without a
 * readable /Root — exit 0, "9 fields removed" — and its inspection printed the
 * encrypted /Info bytes as if they were an author and dates. Encrypted strings
 * are not values; a file that cannot be rewritten is refused, not damaged.
 */

const engine = await nodeXrayEngine();
const open = encryptedPdf();
const locked = encryptedPdf({ userPassword: 'user' });

const infoFindings = (findings: Array<{ location: string }>) => findings.filter((f) => f.location.startsWith('/Info'));

describe('[C1] inspecting an encrypted PDF', () => {
  it('says the document is encrypted', async () => {
    for (const pdf of [open, locked]) {
      const result = await inspectFile(pdf, 'pdf');
      expect(result.findings.some((f) => f.label === 'Encrypted document')).toBe(true);
    }
  });

  it('never shows /Info bytes it could not decrypt', async () => {
    expect(infoFindings((await inspectFile(open, 'pdf')).findings)).toEqual([]);
    expect(infoFindings((await inspectFile(locked, 'pdf', { xray: engine })).findings)).toEqual([]);
  });

  it.runIf(engine)('decrypts /Info when the user password is empty, which is what opening the file does', async () => {
    const result = await inspectFile(open, 'pdf', { xray: engine });
    expect(result.findings.find((f) => f.location === '/Info /Author')?.value).toBe('Jean Dupont');
    expect(result.findings.find((f) => f.location === '/Info /Title')?.value).toBe('Offre commerciale');
  });

  it('reads nothing inside when a password is needed, and says why', async () => {
    const encrypted = (await inspectFile(locked, 'pdf', { xray: engine })).findings.find((f) => f.label === 'Encrypted document');
    expect(encrypted?.value).toMatch(/password/i);
  });
});

describe('[C1] cleaning an encrypted PDF', () => {
  it('is refused, with a code a front-end can translate', async () => {
    for (const pdf of [open, locked]) {
      const attempt = redactFile(pdf, 'pdf');
      await expect(attempt).rejects.toBeInstanceOf(UnsupportedFormatError);
      await expect(attempt).rejects.toMatchObject({ code: 'encrypted-pdf' });
    }
  });

  it('exits non-zero from the command line and writes no output file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ciirta-c1-'));
    const input = join(dir, 'protected.pdf');
    const output = join(dir, 'out.pdf');
    writeFileSync(input, open);
    const run = runCli(['redact', input, '-o', output, '--lang', 'fr']);
    expect(run.status).not.toBe(0);
    expect(existsSync(output)).toBe(false);
    expect(run.stderr.toString()).toMatch(/chiffré/);
  });
});

describe('[C1] a cleaned PDF that does not parse is never delivered', () => {
  it('rejects bytes with no /Root', async () => {
    const broken = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<</Size 2>>\n%%EOF\n');
    await expect(assertReadablePdf(broken)).rejects.toMatchObject({ code: 'output-unreadable' });
  });

  it('rejects bytes that are not a PDF at all', async () => {
    await expect(assertReadablePdf(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'output-unreadable' });
  });
});

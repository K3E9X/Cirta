import { describe, expect, it } from 'vitest';
import { inspectFile, redactFile, type Finding } from '../src/core/index.js';
import { activePdf } from './helpers/active-pdf.js';
import { runCli } from './helpers/cli.js';

/*
 * [F-2.1] What a PDF does, not only what it says: a script run on opening, a
 * link that launches a program, a form that posts its fields somewhere, a
 * file carried inside. Reported with what each one targets; with
 * --strip-active, taken out.
 */

const labels = (findings: Finding[]) => findings.map((f) => f.label);
const get = (findings: Finding[], label: string) => findings.filter((f) => f.label === label);

describe('[F-2.1] active content in a PDF', () => {
  it('reports the script run on opening, with its code', async () => {
    const { findings } = await inspectFile(await activePdf(), 'facture.pdf');
    const opening = get(findings, 'Action run when the document opens');
    expect(opening).toHaveLength(1);
    expect(opening[0]).toMatchObject({ kind: 'active-content', confidence: 'confirmed' });
    expect(opening[0]!.value).toContain('app.alert("Bonjour")');
  });

  it('reports document-level and event-triggered scripts', async () => {
    const { findings } = await inspectFile(await activePdf(), 'facture.pdf');
    expect(get(findings, 'JavaScript in the document').map((f) => f.value).join(' ')).toContain('util.printd');
    expect(get(findings, 'Action triggered by an event').map((f) => f.value).join(' ')).toContain('page ouverte');
  });

  it('reports what launches, submits or opens elsewhere, with its target', async () => {
    const { findings } = await inspectFile(await activePdf(), 'facture.pdf');
    expect(get(findings, 'Launches a program or a file')[0]?.value).toContain('cmd.exe');
    expect(get(findings, 'Sends form data to an address')[0]?.value).toContain('https://collecte.exemple/form');
    expect(get(findings, 'Opens another document')[0]?.value).toContain('\\\\serveur\\partage\\annexe.pdf');
  });

  it('lists the web addresses the document links to', async () => {
    const { findings } = await inspectFile(await activePdf(), 'facture.pdf');
    expect(get(findings, 'Web addresses linked')[0]).toMatchObject({ confidence: 'informational', value: '1 — https://exemple.fr/offre' });
  });

  it('reports rich media and an XFA form', async () => {
    const { findings } = await inspectFile(await activePdf(), 'facture.pdf');
    expect(labels(findings)).toEqual(expect.arrayContaining(['Rich media (Flash, 3D, video)', 'XFA form']));
  });

  it('reports each embedded file and inspects it', async () => {
    const { findings } = await inspectFile(await activePdf(), 'facture.pdf');
    expect(get(findings, 'Embedded file')[0]?.value).toMatch(/^contrat\.docx — \d+ bytes, application\/vnd\.openxml/);
    expect(findings.find((f) => f.label === 'Author' && f.location.startsWith('attachment contrat.docx → '))?.value).toBe('Lotfi Zakaria');
  });

  it('removes all of it with stripActive, keeps plain links, and says so', async () => {
    const result = await redactFile(await activePdf(), 'facture.pdf', { stripActive: true });
    const after = (await inspectFile(result.data!, 'facture.pdf')).findings;
    expect(after.filter((f) => f.kind === 'active-content' && f.confidence !== 'informational')).toEqual([]);
    expect(get(after, 'Web addresses linked')).toHaveLength(1);
    expect(result.notes).toContainEqual(expect.objectContaining({ code: 'removed:active-content' }));
  });

  it('leaves it in place without the option, and names it as still there', async () => {
    const result = await redactFile(await activePdf(), 'facture.pdf');
    expect((result.kept ?? []).map((f) => f.label)).toContain('Action run when the document opens');
  });
});

describe('[F-2.1] --strip-active from the command line', () => {
  it('is offered when active content stays, and removes it when given', async () => {
    const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'cirta-active-'));
    const file = join(dir, 'facture.pdf');
    writeFileSync(file, await activePdf());
    const plain = runCli(['redact', '--lang', 'en', file, '-o', join(dir, 'a.pdf')]);
    expect(plain.stdout.toString()).toContain('--strip-active');
    const stripped = runCli(['redact', '--lang', 'en', '--strip-active', file, '-o', join(dir, 'b.pdf')]);
    expect(stripped.status).toBe(0);
    const after = await inspectFile(new Uint8Array(readFileSync(join(dir, 'b.pdf'))), 'pdf');
    expect(after.findings.some((f) => f.label === 'Action run when the document opens')).toBe(false);
    // The script's text is gone from the bytes, not only unreferenced.
    expect(Buffer.from(readFileSync(join(dir, 'b.pdf'))).includes('app.alert')).toBe(false);
  });
});

describe('[F-2.1] a damaged catalog', () => {
  it('is read without a TypeError when /Root is not a dictionary (found by the fuzzer)', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n5\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n');
    const outcome = await inspectFile(pdf, 'pdf').then(() => 'read', (error: Error) => error.name);
    expect(outcome).not.toBe('TypeError');
  });
});

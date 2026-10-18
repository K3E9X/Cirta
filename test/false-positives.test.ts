import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { inspectFile, inspectPlainText, scanText, type Finding } from '../src/core/index.js';

/*
 * [C9] Five findings that fired on ordinary files. Each is a test that the
 * ordinary case is quiet and the case the check exists for still fires.
 */

const find = (findings: Finding[], label: string) => findings.find((f) => f.label === label);

describe('[C9.1] a pasted mail does not take its own Subject header for a repeat', () => {
  const headers =
    'From: Jean Dupont <jean@example.com>\nTo: Marie <marie@example.com>\nSubject: Relance du dossier\n' +
    'Date: Mon, 12 Oct 2026 09:00:00 +0200\nMIME-Version: 1.0\nContent-Type: text/plain; charset=utf-8\n\n';

  it('reads the body only', () => {
    const findings = inspectPlainText(`${headers}Bonjour Marie,\n\nJe reviens vers vous.\n`);
    expect(find(findings, 'Subject line repeated in the body')).toBeUndefined();
  });

  it('still flags a subject line written into the body', () => {
    const findings = inspectPlainText(`${headers}Objet : Relance du dossier\n\nBonjour Marie,\n`);
    expect(find(findings, 'Subject line repeated in the body')).toBeDefined();
  });
});

describe('[C9.2] /Trapped is a standard /Info key', () => {
  async function pdfWith(entries: Record<string, string>): Promise<Uint8Array> {
    const { PDFDocument, PDFName } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const info = pdf.context.lookup(pdf.context.trailerInfo.Info) as unknown as { set(k: unknown, v: unknown): void };
    for (const [name, value] of Object.entries(entries)) info.set(PDFName.of(name), PDFName.of(value));
    return pdf.save();
  }

  it('is not reported as a custom key, and never above informational', async () => {
    const { findings } = await inspectFile(await pdfWith({ Trapped: 'False' }));
    expect(findings.some((f) => f.label.includes('Trapped') && f.confidence !== 'informational')).toBe(false);
    expect(find(findings, 'Custom info key: Trapped')).toBeUndefined();
  });

  it('leaves a real custom key confirmed', async () => {
    const { findings } = await inspectFile(await pdfWith({ Pipeline: 'genai' }));
    expect(find(findings, 'Custom info key: Pipeline')?.confidence).toBe('confirmed');
  });
});

describe('[C9.3] one decomposed letter is not a channel', () => {
  const mixed = (decomposed: number, composed: number) =>
    `${'café '.repeat(decomposed)}${'thé '.repeat(composed)}`;
  const level = (text: string) => scanText(text).findings.find((f) => f.location === 'Unicode normalisation')?.confidence;

  it('is informational under three occurrences', () => {
    expect(level(mixed(1, 40))).toBe('informational');
    expect(level(mixed(2, 10))).toBe('informational');
  });

  it('is informational under five per cent of accented letters', () => {
    expect(level(mixed(4, 200))).toBe('informational');
  });

  it('is probable above both thresholds, never confirmed', () => {
    expect(level(mixed(10, 30))).toBe('probable');
  });
});

describe('[C9.4] the minus sign in a formula is a minus sign', () => {
  const hyphens = (text: string) => scanText(text).findings.find((f) => f.location === 'hyphen lookalikes');

  it('is ignored between operands and before a number', () => {
    expect(hyphens('Code : x − y = 3 × 2')).toBeUndefined();
    expect(hyphens('Il fait −5 °C, soit 3−8 degrés de moins.')).toBeUndefined();
  });

  it('is still reported inside a word', () => {
    expect(hyphens('Envoyez un e−mail au service.')).toBeDefined();
  });

  it('leaves the other lookalike hyphens reported', () => {
    expect(hyphens('re‐lance')).toBeDefined();
  });
});

describe('[C9.5] OpenDocument user properties that are technical fields', () => {
  const odt = (properties: Record<string, string>) =>
    zipSync({
      mimetype: strToU8('application/vnd.oasis.opendocument.text'),
      'meta.xml': strToU8(
        '<office:document-meta xmlns:office="o" xmlns:meta="m"><office:meta>' +
          Object.entries(properties)
            .map(([name, value]) => `<meta:user-defined meta:name="${name}">${value}</meta:user-defined>`)
            .join('') +
          '</office:meta></office:document-meta>',
      ),
      'content.xml': strToU8('<office:document-content/>'),
    });

  it('reports AppVersion, DocSecurity, ScaleCrop, LinksUpToDate as informational provenance', async () => {
    const { findings } = await inspectFile(odt({ AppVersion: '14.0000', DocSecurity: '0', ScaleCrop: 'false', LinksUpToDate: 'false' }));
    for (const name of ['AppVersion', 'DocSecurity', 'ScaleCrop', 'LinksUpToDate']) {
      expect(find(findings, `User-defined property: ${name}`)).toMatchObject({ confidence: 'informational', kind: 'provenance' });
    }
  });

  it('leaves any other property confirmed', async () => {
    const { findings } = await inspectFile(odt({ Client: 'Orion SA' }));
    expect(find(findings, 'User-defined property: Client')?.confidence).toBe('confirmed');
  });
});

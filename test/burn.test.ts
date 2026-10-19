import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { inspectFile, redactFile } from '../src/core/index.js';
import { nodeXrayEngine } from '../src/cli/xray-engine.js';

/*
 * [F-2.4] A black box drawn over a figure hides it from the eye and from
 * nobody else: the text is still in the page, selectable, copyable, read by
 * any model. --burn-redactions removes it for good. Where the glyphs cannot
 * be cut from the page cleanly, the page becomes a picture of itself — and
 * the report says which pages lost their selectable text.
 */

const engine = await nodeXrayEngine();

async function blackedOut(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([400, 200]);
  first.drawText('Compte rendu de la réunion', { x: 20, y: 150, size: 12, font });
  first.drawText('Salaire : 58000 EUR', { x: 20, y: 100, size: 12, font });
  first.drawRectangle({ x: 15, y: 92, width: 160, height: 24, color: rgb(0, 0, 0) });
  const second = doc.addPage([400, 200]);
  second.drawText('Annexe sans rien de masqué', { x: 20, y: 100, size: 12, font });
  return doc.save();
}

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = engine!.pdfjs.getDocument({ data: new Uint8Array(bytes), ...(engine!.documentOptions ?? {}) });
  const doc = (await task.promise) as unknown as { numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string }> }> }> };
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) out.push((await (await doc.getPage(n)).getTextContent()).items.map((i) => i.str ?? '').join(' '));
  await task.destroy();
  return out;
}

describe.runIf(engine)('[F-2.4] burning redactions', () => {
  it('removes the covered text for good, rasterising only the page it was on, and says so', async () => {
    const input = await blackedOut();
    expect((await inspectFile(input, 'pdf', { xray: engine })).findings.some((f) => f.label === 'Text covered by a shape')).toBe(true);
    const result = await redactFile(input, 'pdf', { xray: engine, burnRedactions: true });
    const texts = await pageTexts(result.data!);
    expect(texts[0]).not.toContain('58000');
    expect(texts[0]).not.toContain('Compte rendu');
    expect(texts[1]).toContain('Annexe sans rien');
    expect(result.notes).toContainEqual({ code: 'rasterized:pages', detail: '1' });
    expect(result.removed.map((f) => f.label)).toContain('Text covered by a shape');
    expect(Buffer.from(result.data!).includes('58000')).toBe(false);
    const after = await inspectFile(result.data!, 'pdf', { xray: engine });
    expect(after.findings.some((f) => f.label === 'Text covered by a shape')).toBe(false);
  });

  it('leaves a document with nothing covered untouched', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]).drawText('Rien de masqué', { x: 10, y: 50 });
    const result = await redactFile(await doc.save(), 'pdf', { xray: engine, burnRedactions: true });
    expect(result.notes.some((n) => n.code === 'rasterized:pages')).toBe(false);
    expect((await pageTexts(result.data!))[0]).toContain('Rien de masqu');
  });
});

describe('[F-2.4] burning redactions without a renderer', () => {
  it('is refused rather than skipped', async () => {
    await expect(redactFile(await blackedOut(), 'pdf', { burnRedactions: true })).rejects.toMatchObject({ code: 'burn-unavailable' });
  });
});

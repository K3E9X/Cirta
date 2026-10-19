import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
import { inspectFile, redactFile } from '../src/core/index.js';
import { makeDocx } from './fixtures.js';

/*
 * [F-2.4] PDF content options: files carried inside, and annotations — the
 * sticky notes, highlights and comments a reviewer leaves, each with an
 * author. Flattening draws what they show into the page and removes them.
 */

async function reviewed(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 300]);
  page.drawText('Rapport');
  const ctx = pdf.context;
  const ap = ctx.register(ctx.stream('0 0 1 rg 0 0 50 20 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 20] }));
  const annots = [
    ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [100, 100, 200, 140], T: PDFString.of('Marie Martin'), Contents: PDFString.of('À revoir'), AP: ctx.obj({ N: ap }) })),
    ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], T: PDFString.of('Paul Durand'), Contents: PDFString.of('Note sans apparence') })),
    ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: ctx.obj({ S: 'URI', URI: PDFString.of('https://exemple.fr') }) })),
  ];
  page.node.set(PDFName.of('Annots'), ctx.obj(annots));
  await pdf.attach(makeDocx(), 'source.docx', { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  return pdf.save();
}

async function annotationTypes(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPages()[0]!.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return [];
  return annots.asArray().map((ref) => (doc.context.lookup(ref) as PDFDict).get(PDFName.of('Subtype'))!.toString());
}

describe('[F-2.4] PDF content options', () => {
  it('removes embedded files with removeAttachments, and the bytes they held', async () => {
    const result = await redactFile(await reviewed(), 'rapport.pdf', { removeAttachments: true });
    const after = await inspectFile(result.data!, 'rapport.pdf');
    expect(after.findings.some((f) => f.label === 'Embedded file')).toBe(false);
    expect(after.findings.some((f) => f.location.startsWith('attachment '))).toBe(false);
    expect(result.notes).toContainEqual({ code: 'removed:attachments', detail: '1' });
  });

  it('flattens annotations: what they show is drawn into the page, the annotations and their authors go, links stay', async () => {
    const result = await redactFile(await reviewed(), 'rapport.pdf', { flattenAnnotations: true });
    expect(await annotationTypes(result.data!)).toEqual(['/Link']);
    const doc = await PDFDocument.load(result.data!);
    const contents = doc.getPages()[0]!.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    const drawn = streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode())).join('\n');
    expect(drawn).toMatch(/\/FlatAnnot[\w-]* Do/);
    expect(result.notes).toContainEqual({ code: 'flattened:annotations', detail: '1/2' });
    const after = await inspectFile(result.data!, 'rapport.pdf');
    expect(after.findings.some((f) => f.label === 'Annotation authors')).toBe(false);
  });
});

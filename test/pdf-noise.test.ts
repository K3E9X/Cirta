import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib';
import { inspectPdf } from '../src/core/pdf.js';

/*
 * A one-page Chrome export with nothing in it came back with 22 "control
 * characters" findings: the stream scan read embedded TrueType fonts, images
 * and two-byte glyph codes as if they were the document's text.
 */

const controls = async (bytes: Uint8Array) =>
  (await inspectPdf(bytes)).findings.filter((f) => f.label === 'Control characters in the text');

describe('binary PDF streams are not page text', () => {
  it('ignores an embedded font program and an image', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawText('Bonjour', { x: 20, y: 100, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
    // A real font table has "(" and ")" bytes; between them the scan saw a string.
    const binary = new Uint8Array([0, 1, 0, 0, 0x28, 0, 14, 0, 0, 3, 0, 0x4f, 7, 8, 27, 0, 0x29, 0, 1, 2]);
    const font = doc.context.stream(binary, { Length1: PDFNumber.of(binary.length) });
    const image = doc.context.stream(binary, { Type: 'XObject', Subtype: 'Image', Width: 7, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
    doc.context.register(font);
    doc.context.register(image);
    expect(await controls(await doc.save())).toEqual([]);
  });

  it('ignores two-byte glyph codes in a content stream', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    // Identity-H: glyph 3 is a space, written <0003>; raw, that is NUL and U+0003.
    const content = doc.context.stream('BT /F1 12 Tf 20 100 Td <002B0048004F004F00520003003A> Tj ET');
    page.node.set(PDFName.of('Contents'), doc.context.register(content));
    expect(await controls(await doc.save())).toEqual([]);
  });
});

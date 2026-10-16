/**
 * One-page PDFs that hide a line of text, or that look as if they might and do
 * not. Each is drawn with pdf-lib exactly as a producer would: a rectangle
 * after the text, a fill colour, the invisible text mode, a page box.
 */

import { crc32, deflateSync } from 'node:zlib';
import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  StandardFonts,
  TextRenderingMode,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setTextRenderingMode,
} from 'pdf-lib';

export interface Canvas {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
}

export async function onePage(draw: (c: Canvas) => void | Promise<void>, size: [number, number] = [400, 200]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(size);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  await draw({ doc, page, font });
  return doc.save();
}

export function invisibleText({ page, font }: Canvas, text: string, x: number, y: number): void {
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  page.drawText(text, { x, y, size: 12, font });
  page.pushOperators(popGraphicsState());
}

/** An RGB PNG, pixel by pixel: enough to stand in for a scanned line. */
export function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, body: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // truecolour
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

export { rgb };

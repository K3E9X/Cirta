import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { inspectFile, redactFile } from '../src/core/index.js';

/*
 * `removed` is documented as "findings that were removed". The redactors
 * returned everything inspection had found, so a PDF whose annotation authors
 * were never touched reported them removed: "7 fields removed" above a table
 * listing the commenter's name, above a note saying the name was still there.
 * The page now strikes a row through on the strength of `removed`, which made
 * the error visible as a line drawn through something still in the file.
 */

const key = (f: { label: string; location: string }) => `${f.label}\u0000${f.location}`;

/** A PDF with an author and a commented page — one removable, one not. */
async function commentedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setAuthor('Lotfi Zakaria');
  const page = doc.addPage([300, 200]);
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [10, 10, 30, 30],
    Contents: PDFString.of('A revoir'),
    T: PDFString.of('Lotfi Zakaria'),
  });
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  return doc.save();
}

describe('what a clean reports as removed', () => {
  it('lists only what re-inspecting the output no longer finds', async () => {
    const cleaned = await redactFile(await commentedPdf(), 'pdf');
    const after = new Set((await inspectFile(cleaned.data!, 'pdf')).findings.map(key));
    for (const finding of cleaned.removed) {
      expect(after.has(key(finding)), `${finding.label} is still in the output`).toBe(false);
    }
  });

  it('does not report annotation authors removed, because they are not', async () => {
    const cleaned = await redactFile(await commentedPdf(), 'pdf');
    expect(cleaned.removed.some((f) => f.label === 'Annotation authors')).toBe(false);
  });

  it('still reports what really went', async () => {
    const cleaned = await redactFile(await commentedPdf(), 'pdf');
    expect(cleaned.removed.some((f) => f.label === 'Author')).toBe(true);
  });

  it('names what survived and matters in `kept`, matching the note', async () => {
    const cleaned = await redactFile(await commentedPdf(), 'pdf');
    expect(cleaned.kept?.some((f) => f.label === 'Annotation authors')).toBe(true);
    const note = cleaned.notes.find((n) => n.code === 'kept:in-content');
    for (const finding of cleaned.kept ?? []) {
      expect(note?.detail).toContain(finding.label);
    }
  });

  it('leaves informational survivors out of `kept`, as the note does', async () => {
    // The cleaner's own rewrite carries traits of a program-built file. Those
    // survive by construction, and flagging them would blame the user for the
    // tool's own signature.
    const cleaned = await redactFile(await commentedPdf(), 'pdf');
    expect(cleaned.kept?.every((f) => f.confidence !== 'informational')).toBe(true);
  });
});

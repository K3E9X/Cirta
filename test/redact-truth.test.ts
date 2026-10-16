import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFDict, PDFName, PDFString, StandardFonts } from 'pdf-lib';
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

// A credential shaped like the real thing, so the content scan finds it.
const FAKE_KEY = 'sk-ant-api03-' + 'x'.repeat(24);

/**
 * A PDF with an author, a review thread, and a key pasted into the page text.
 * The first two are metadata a clean removes; the key is content it must not
 * rewrite, which makes it the survivor these tests need.
 */
async function reviewedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setAuthor('Lotfi Zakaria');
  const page = doc.addPage([300, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(`Cle : ${FAKE_KEY}`, { x: 10, y: 150, size: 8, font });

  const comment = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [10, 10, 30, 30],
      Contents: PDFString.of('A revoir avant envoi'),
      T: PDFString.of('Lotfi Zakaria'),
      M: PDFString.of('D:20261015093000Z'),
      CreationDate: PDFString.of('D:20261015090000Z'),
    }),
  );
  const reply = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [40, 10, 60, 30],
      Contents: PDFString.of('Fait'),
      T: PDFString.of('Marie Dupont'),
      IRT: comment,
    }),
  );
  page.node.set(PDFName.of('Annots'), doc.context.obj([comment, reply]));
  return doc.save();
}

/** Every annotation of the cleaned file, as plain key/value text. */
async function annotationsOf(bytes: Uint8Array): Promise<Array<Record<string, string>>> {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPages()[0]!.node.lookup(PDFName.of('Annots'));
  const list = annots && 'asArray' in annots ? (annots as { asArray(): unknown[] }).asArray() : [];
  return list.map((ref) => {
    const dict = doc.context.lookup(ref as Parameters<typeof doc.context.lookup>[0]) as PDFDict;
    const out: Record<string, string> = {};
    for (const [name, value] of dict.entries()) {
      out[name.asString().replace(/^\//, '')] =
        'decodeText' in value ? (value as { decodeText(): string }).decodeText() : String(value);
    }
    return out;
  });
}

describe('what a clean reports as removed', () => {
  it('lists only what re-inspecting the output no longer finds', async () => {
    const cleaned = await redactFile(await reviewedPdf(), 'pdf');
    const after = new Set((await inspectFile(cleaned.data!, 'pdf')).findings.map(key));
    for (const finding of cleaned.removed) {
      expect(after.has(key(finding)), `${finding.label} is still in the output`).toBe(false);
    }
  });

  it('still reports what really went', async () => {
    const cleaned = await redactFile(await reviewedPdf(), 'pdf');
    expect(cleaned.removed.some((f) => f.label === 'Author')).toBe(true);
  });

  it('names what survived and matters in `kept`, matching the note', async () => {
    const cleaned = await redactFile(await reviewedPdf(), 'pdf');
    expect(cleaned.kept?.some((f) => f.label.includes('Anthropic API key'))).toBe(true);
    const note = cleaned.notes.find((n) => n.code === 'kept:in-content');
    for (const finding of cleaned.kept ?? []) {
      expect(note?.detail).toContain(finding.label);
    }
  });

  it('leaves informational survivors out of `kept`, as the note does', async () => {
    // The cleaner's own rewrite carries traits of a program-built file. Those
    // survive by construction, and flagging them would blame the user for the
    // tool's own signature.
    const cleaned = await redactFile(await reviewedPdf(), 'pdf');
    expect(cleaned.kept?.every((f) => f.confidence !== 'informational')).toBe(true);
  });
});

/*
 * Annotation authors used to be read and never removed: every name in a review
 * thread survived a clean. They are metadata — what the file says about who
 * wrote the comments — and go like any other author field.
 */
describe('annotation authors', () => {
  it('are reported removed, because now they are', async () => {
    const cleaned = await redactFile(await reviewedPdf(), 'pdf');
    expect(cleaned.removed.some((f) => f.label === 'Annotation authors')).toBe(true);
    expect(cleaned.kept?.some((f) => f.label === 'Annotation authors')).toBe(false);
  });

  it('leave no name, and no time, on any annotation — replies included', async () => {
    const cleaned = await redactFile(await reviewedPdf(), 'pdf');
    const annots = await annotationsOf(cleaned.data!);
    expect(annots).toHaveLength(2);
    for (const annot of annots) {
      expect(annot.T).toBeUndefined();
      expect(annot.M).toBeUndefined();
      expect(annot.CreationDate).toBeUndefined();
    }
    const flat = JSON.stringify(annots);
    expect(flat).not.toContain('Lotfi');
    expect(flat).not.toContain('Marie');
  });

  it('keep what the comments say, which is content and not metadata', async () => {
    const cleaned = await redactFile(await reviewedPdf(), 'pdf');
    const contents = (await annotationsOf(cleaned.data!)).map((a) => a.Contents);
    expect(contents).toEqual(['A revoir avant envoi', 'Fait']);
  });

  it('keep the thread: a reply still points at what it answers', async () => {
    const cleaned = await redactFile(await reviewedPdf(), 'pdf');
    const [, reply] = await annotationsOf(cleaned.data!);
    expect(reply?.IRT).toMatch(/\d+ 0 R/);
  });
});

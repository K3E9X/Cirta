import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { unzipSync, strFromU8 } from 'fflate';
import { inspectFile, redactFile, detectFormat, UnsupportedFormatError } from '../src/core/index.js';
import { makePdf, makePptx, makeDocx } from './fixtures.js';

describe('detectFormat', () => {
  it('identifies formats by content, not extension', async () => {
    expect(detectFormat(await makePdf())).toBe('pdf');
    expect(detectFormat(makePptx())).toBe('pptx');
    expect(detectFormat(makeDocx())).toBe('docx');
    expect(detectFormat(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });

  it('rejects unrecognised input rather than guessing', async () => {
    await expect(inspectFile(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
  });
});

describe('PDF', () => {
  it('reports every populated /Info field', async () => {
    const result = await inspectFile(await makePdf());
    expect(result.format).toBe('pdf');
    const byLabel = Object.fromEntries(result.findings.map((f) => [f.label, f.value]));
    expect(byLabel['Author']).toBe('Lotfi Zakaria');
    expect(byLabel['Title']).toBe('Offre commerciale Q3');
    expect(byLabel['Producing application']).toBe('Example PDF Export 1.2');
    expect(byLabel['Created']).toContain('20260801');
  });

  it('leaves no metadata behind after redaction', async () => {
    const redacted = await redactFile(await makePdf());
    expect(redacted.removed.length).toBeGreaterThanOrEqual(8);
    expect((await inspectFile(redacted.data!)).findings).toEqual([]);
  });

  it('produces a file that still opens and keeps its pages', async () => {
    const redacted = await redactFile(await makePdf());
    const reloaded = await PDFDocument.load(redacted.data!);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('does not stamp a new producer or modification date on save', async () => {
    const redacted = await redactFile(await makePdf());
    const text = strFromU8(redacted.data!);
    expect(text).not.toContain('pdf-lib');
    expect(text).not.toMatch(/\/ModDate/);
  });

  it('always states that page text is out of scope', async () => {
    const result = await inspectFile(await makePdf());
    expect(result.notes.map((n) => n.code)).toContain('scope:pdf-metadata-only');
  });
});

describe('PPTX', () => {
  it('reports core, app, custom and thumbnail metadata', async () => {
    const result = await inspectFile(makePptx());
    expect(result.format).toBe('pptx');
    const byLabel = Object.fromEntries(result.findings.map((f) => [f.label, f.value]));
    expect(byLabel['Author']).toBe('Lotfi Zakaria');
    expect(byLabel['Last modified by']).toBe('lotfi.z');
    expect(byLabel['Company']).toBe('Example SA');
    expect(byLabel['Template']).toContain('corp.potx');
    expect(byLabel['Custom properties']).toBe('ClassificationInterne');
    expect(byLabel['Embedded thumbnail']).toBeDefined();
  });

  it('leaves no metadata behind after redaction', async () => {
    const redacted = await redactFile(makePptx());
    expect((await inspectFile(redacted.data!)).findings).toEqual([]);
  });

  it('drops the custom-properties and thumbnail parts', async () => {
    const redacted = await redactFile(makePptx());
    const parts = Object.keys(unzipSync(redacted.data!));
    expect(parts).not.toContain('docProps/custom.xml');
    expect(parts).not.toContain('docProps/thumbnail.jpeg');
    expect(parts).toContain('ppt/presentation.xml');
  });

  it('also removes the references to the dropped parts', async () => {
    // A dangling Override or Relationship makes the package invalid, which is
    // the usual way a naive metadata stripper corrupts an Office file.
    const redacted = await redactFile(makePptx());
    const parts = unzipSync(redacted.data!);
    expect(strFromU8(parts['[Content_Types].xml']!)).not.toContain('custom.xml');
    expect(strFromU8(parts['[Content_Types].xml']!)).not.toContain('thumbnail');
    expect(strFromU8(parts['_rels/.rels']!)).not.toContain('custom.xml');
    expect(strFromU8(parts['_rels/.rels']!)).not.toContain('thumbnail');
  });

  it('keeps [Content_Types].xml as the first entry in the container', async () => {
    const redacted = await redactFile(makePptx());
    expect(Object.keys(unzipSync(redacted.data!))[0]).toBe('[Content_Types].xml');
  });

  it('removes date elements rather than blanking them', async () => {
    // An empty dcterms:created is not a valid W3CDTF value.
    const redacted = await redactFile(makePptx());
    const core = strFromU8(unzipSync(redacted.data!)['docProps/core.xml']!);
    expect(core).not.toContain('dcterms:created');
    expect(core).not.toContain('dcterms:modified');
    expect(core).toContain('<dc:creator></dc:creator>');
  });
});

describe('DOCX', () => {
  it('reports revision save IDs and comment authors', async () => {
    const result = await inspectFile(makeDocx());
    expect(result.format).toBe('docx');
    const labels = result.findings.map((f) => f.label);
    expect(labels).toContain('Revision save IDs');
    expect(labels).toContain('Comment and revision authors');
    expect(result.findings.find((f) => f.label === 'Comment and revision authors')?.value).toBe(
      'Lotfi Zakaria',
    );
  });

  it('strips rsids and anonymises comment authors', async () => {
    const redacted = await redactFile(makeDocx());
    const parts = unzipSync(redacted.data!);
    expect(strFromU8(parts['word/settings.xml']!)).not.toContain('w:rsid');
    expect(strFromU8(parts['word/comments.xml']!)).not.toContain('Lotfi Zakaria');
    expect((await inspectFile(redacted.data!)).findings).toEqual([]);
  });
});

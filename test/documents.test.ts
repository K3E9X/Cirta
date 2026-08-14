import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import {
  inspectFile,
  redactFile,
  detectFormat,
  isStructuralFinding,
  UnsupportedFormatError,
  ArchiveTooLargeError,
  ZIP_LIMITS,
} from '../src/core/index.js';
import { makePdf, makePptx, makeDocx, makeXlsx } from './fixtures.js';

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
    const after = await inspectFile(redacted.data!);
    // Structural findings survive by definition: they describe how the file is
    // built, and rebuilding it is not something a redaction tool can do.
    expect(after.findings.filter((f) => !isStructuralFinding(f))).toEqual([]);
  });

  it('removes the /Info dictionary rather than emptying it', async () => {
    const redacted = await redactFile(await makePdf());
    const after = await inspectFile(redacted.data!);
    // A present-but-empty /Info is a shape no producer writes, so leaving one
    // would announce "this file was cleaned" — one mark traded for another.
    expect(after.findings.map((f) => f.label)).not.toContain(
      'Metadata has been stripped from this file',
    );
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
    // Reported per property, with the value: the name alone carries nothing.
    expect(byLabel['Custom property: ClassificationInterne']).toBe('Confidentiel');
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

describe('XLSX', () => {
  it('reads the identities and paths that only a workbook carries', async () => {
    const result = await inspectFile(makeXlsx());
    expect(result.format).toBe('xlsx');
    const value = (label: string) => result.findings.find((f) => f.label === label)?.value;

    // Both spellings of a name, and not the "Author" placeholder Excel writes
    // for an already-anonymised comment.
    expect(value('Comment authors')).toBe('Lotfi Zakaria, Lotfi Z');
    expect(value('Defined name pointing outside the workbook')).toContain('Budget');
    expect(value('Defined name pointing outside the workbook')).not.toContain('Total');
    expect(value('Links to other workbooks')).toContain('1 external');
    // The account name falls out of the path the defined name holds.
    expect(value('Windows account')).toContain('lotfi');
  });

  it('anonymises the authors and says why the references stay', async () => {
    const redacted = await redactFile(makeXlsx());
    const parts = unzipSync(redacted.data!);
    expect(strFromU8(parts['xl/comments1.xml']!)).not.toContain('Lotfi Zakaria');
    expect(strFromU8(parts['xl/persons/person1.xml']!)).not.toContain('Lotfi Z');

    // A defined name and an external link part are what formulas resolve
    // through: removing them would turn live cells into #REF!, so they are
    // reported as kept rather than deleted — and the report says both that they
    // were kept on purpose and that they are still in the file.
    expect(parts['xl/externalLinks/externalLink1.xml']).toBeDefined();
    const codes = redacted.notes.map((n) => n.code);
    expect(codes).toContain('kept:content');
    expect(redacted.notes.find((n) => n.code === 'kept:content')?.detail).toContain(
      'external workbook references',
    );
    expect(codes).toContain('kept:in-content');
  });
});

describe('the decompression budget', () => {
  /**
   * Inflate the uncompressed-size field every header declares.
   *
   * Building a real 800 MB bomb costs seconds of compression to test something
   * that never inflates a byte. What the guard actually reads is the size the
   * archive *claims*, so claiming it directly is both instant and the honest
   * shape of the threat: a small file asserting it holds far more.
   */
  const overstate = (zip: Uint8Array, declared: number): Uint8Array => {
    const out = zip.slice();
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    for (let at = 0; at + 30 <= out.length; at++) {
      const signature = view.getUint32(at, true);
      // Local file header keeps it at +22, central directory header at +24.
      if (signature === 0x04034b50) view.setUint32(at + 22, declared, true);
      else if (signature === 0x02014b50) view.setUint32(at + 24, declared, true);
    }
    return out;
  };

  it('refuses on the size the archive declares, before inflating anything', async () => {
    const honest = zipSync({
      'word/document.xml': strToU8('<w:document><w:body/></w:document>'),
      'a.bin': strToU8('x'),
      'b.bin': strToU8('y'),
    });
    // Three members each claiming 300 MB. The old limits ran after unzipSync,
    // so they capped what was reported rather than what was decompressed — by
    // then the memory was already spent.
    const bomb = overstate(honest, 300 * 1024 * 1024);

    expect(bomb.length).toBeLessThan(4096);
    await expect(inspectFile(bomb)).rejects.toThrow(ArchiveTooLargeError);
    await expect(inspectFile(bomb)).rejects.toThrow(/uncompressed content/);
  });

  it('refuses an archive with more members than the cap allows', async () => {
    const parts: Record<string, Uint8Array> = {
      'word/document.xml': strToU8('<w:document><w:body/></w:document>'),
    };
    for (let i = 0; i <= ZIP_LIMITS.maxMembers; i++) parts[`m${i}`] = strToU8('.');
    await expect(inspectFile(zipSync(parts))).rejects.toThrow(/members/);
  });

  it('lets an ordinary document through untouched', async () => {
    await expect(inspectFile(makeDocx())).resolves.toBeDefined();
  });
});

describe('customXml', () => {
  const withCustomXml = () =>
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types><Override PartName="/customXml/item1.xml" ContentType="application/xml"/></Types>',
      ),
      '_rels/.rels': strToU8('<Relationships/>'),
      'word/document.xml': strToU8('<w:document><w:body/></w:document>'),
      'word/_rels/document.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Target="../customXml/item1.xml"/>' +
          '<Relationship Id="rId2" Target="styles.xml"/></Relationships>',
      ),
      'customXml/item1.xml': strToU8('<root><Classification>Interne</Classification></root>'),
      'customXml/itemProps1.xml': strToU8('<ds:datastoreItem ds:itemID="{9F1A}"/>'),
      'customXml/_rels/item1.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Target="itemProps1.xml"/></Relationships>',
      ),
    });

  it('reports the second property store, which docProps does not cover', async () => {
    const result = await inspectFile(withCustomXml());
    const finding = result.findings.find((f) => f.label === 'Custom XML data store');
    expect(finding?.confidence).toBe('probable');
  });

  it('removes the tree and every relationship pointing into it', async () => {
    const redacted = await redactFile(withCustomXml());
    const parts = unzipSync(redacted.data!);

    expect(Object.keys(parts).filter((p) => p.startsWith('customXml/'))).toEqual([]);
    // A relationship whose target no longer resolves is not cosmetic: Word
    // treats it as a damaged file and offers to repair it.
    const rels = strFromU8(parts['word/_rels/document.xml.rels']!);
    expect(rels).not.toContain('customXml');
    expect(rels).toContain('styles.xml'); // the sibling relationship survives
    expect(strFromU8(parts['[Content_Types].xml']!)).not.toContain('customXml');
  });
});

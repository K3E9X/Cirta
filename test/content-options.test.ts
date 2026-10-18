import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { inspectFile, redactFile } from '../src/core/index.js';
import { deck } from './helpers/deck.js';

/*
 * [F-2.4] Content options: each one opt-in, each one announced. They change
 * what the document contains, which ordinary cleaning never does.
 */

const DECK = () =>
  deck([
    { words: 'Résultats', notes: 'Ne pas dire le chiffre exact' },
    { words: 'Marge réelle 31 %', hidden: true, notes: 'Diapositive de secours' },
    { words: 'Conclusion' },
  ]);

describe('[F-2.4] speaker notes and hidden slides', () => {
  it('removes every slide’s notes with removeNotes, and nothing else', async () => {
    const result = await redactFile(DECK(), 'deck.pptx', { removeNotes: true });
    const parts = unzipSync(result.data!);
    expect(Object.keys(parts).filter((p) => p.startsWith('ppt/notesSlides/'))).toEqual([]);
    for (const n of [1, 2]) expect(strFromU8(parts[`ppt/slides/_rels/slide${n}.xml.rels`]!)).not.toContain('notesSlide');
    expect(strFromU8(parts['[Content_Types].xml']!)).not.toContain('notesSlide');
    expect(result.notes).toContainEqual({ code: 'removed:notes', detail: '2' });
    const after = await inspectFile(result.data!, 'deck.pptx');
    expect(after.findings.some((f) => f.label === 'Speaker notes text')).toBe(false);
    expect(after.findings.some((f) => f.label === 'Text of a hidden slide')).toBe(true);
  });

  it('removes hidden slides with removeHiddenSlides: the slide, its notes, its place in the list', async () => {
    const result = await redactFile(DECK(), 'deck.pptx', { removeHiddenSlides: true });
    const parts = unzipSync(result.data!);
    expect(parts['ppt/slides/slide2.xml']).toBeUndefined();
    expect(parts['ppt/notesSlides/notesSlide2.xml']).toBeUndefined();
    expect(parts['ppt/slides/slide1.xml']).toBeDefined();
    const presentation = strFromU8(parts['ppt/presentation.xml']!);
    expect(presentation.match(/<p:sldId\b/g)).toHaveLength(2);
    expect(strFromU8(parts['ppt/_rels/presentation.xml.rels']!)).not.toContain('slide2.xml');
    expect(strFromU8(parts['[Content_Types].xml']!)).not.toContain('slide2.xml');
    expect(result.notes).toContainEqual({ code: 'removed:hidden-slides', detail: '1' });
    expect((await inspectFile(result.data!, 'deck.pptx')).findings.some((f) => f.label === 'Hidden slides')).toBe(false);
  });

  it('leaves both in place by default, named', async () => {
    const result = await redactFile(DECK(), 'deck.pptx');
    expect((result.kept ?? []).map((f) => f.label)).toEqual(expect.arrayContaining(['Speaker notes text', 'Text of a hidden slide']));
  });
});

describe('[F-2.4] hidden sheets', () => {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const book = (formula: string) => {
    return zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
      'xl/workbook.xml': strToU8(`<workbook ${NS}><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Brouillon" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
      ),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${NS}><sheetData><row r="1"><c r="A1">${formula}<v>1</v></c></row></sheetData></worksheet>`),
      'xl/worksheets/sheet2.xml': strToU8(`<worksheet ${NS}><sheetData><row r="1"><c r="A1"><v>999</v></c></row></sheetData></worksheet>`),
    });
  };

  it('removes a hidden sheet nothing reads', async () => {
    const result = await redactFile(book(''), 'budget.xlsx', { removeHiddenSheets: true });
    const parts = unzipSync(result.data!);
    expect(parts['xl/worksheets/sheet2.xml']).toBeUndefined();
    expect(strFromU8(parts['xl/workbook.xml']!)).not.toContain('Brouillon');
    expect(strFromU8(parts['xl/_rels/workbook.xml.rels']!)).not.toContain('sheet2.xml');
    expect(result.notes).toContainEqual({ code: 'removed:hidden-sheets', detail: '1' });
  });

  it('keeps a hidden sheet a formula reads, and says why', async () => {
    const result = await redactFile(book('<f>Brouillon!A1*2</f>'), 'budget.xlsx', { removeHiddenSheets: true });
    expect(unzipSync(result.data!)['xl/worksheets/sheet2.xml']).toBeDefined();
    expect(result.notes).toContainEqual({ code: 'kept:hidden-sheets', detail: 'Brouillon' });
  });
});

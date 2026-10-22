import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { inspectFile, redactFile, type Finding } from '../src/core/index.js';
import { runCli } from './helpers/cli.js';

/*
 * [C6] A cell comment written by openpyxl — at xl/comments/comment1.xml, not
 * Excel's xl/comments1.xml — went unseen: author and text alike, before and
 * after cleaning. Comment parts are recognised by what they are, not where;
 * their authors are anonymised, their text is named as content and removed
 * only on request.
 */

const SS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (items: Array<[string, string, string]>) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join('')}</Relationships>`;

function xlsx(commentPath: string): Uint8Array {
  const target = commentPath.replace(/^xl\//, '../');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${commentPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/><Override PartName="/xl/threadedComments/threadedComment1.xml" ContentType="application/vnd.ms-excel.threadedcomments+xml"/><Override PartName="/xl/persons/person.xml" ContentType="application/vnd.ms-excel.person+xml"/></Types>`,
    ),
    'xl/workbook.xml': strToU8(`<workbook ${SS} xmlns:r="${R}"><sheets><sheet name="Public" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(rels([['rId1', `${R}/worksheet`, 'worksheets/sheet1.xml'], ['rId9', 'http://schemas.microsoft.com/office/2017/10/relationships/person', 'persons/person.xml']])),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${SS} xmlns:r="${R}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Total</t></is></c></row></sheetData><legacyDrawing r:id="rId3"/></worksheet>`),
    'xl/worksheets/_rels/sheet1.xml.rels': strToU8(
      rels([
        ['rId2', `${R}/comments`, target],
        ['rId3', `${R}/vmlDrawing`, '../drawings/vmlDrawing1.vml'],
        ['rId4', 'http://schemas.microsoft.com/office/2017/10/relationships/threadedComment', '../threadedComments/threadedComment1.xml'],
      ]),
    ),
    [commentPath]: strToU8(
      `<comments ${SS}><authors><author>Marie Martin</author></authors><commentList><comment ref="A1" authorId="0"><text><t>Chiffre faux, le vrai est 340</t></text></comment></commentList></comments>`,
    ),
    'xl/drawings/vmlDrawing1.vml': strToU8(
      '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shape id="_x0000_s1025" type="#_x0000_t202"><x:ClientData ObjectType="Note"><x:Row>0</x:Row><x:Column>0</x:Column></x:ClientData></v:shape></xml>',
    ),
    'xl/threadedComments/threadedComment1.xml': strToU8(
      '<ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><threadedComment ref="A1" dT="2026-10-01T10:00:00.00" personId="{11111111-1111-1111-1111-111111111111}" id="{22222222-2222-2222-2222-222222222222}"><text>Le vrai chiffre est 340, voir avec Paul</text></threadedComment></ThreadedComments>',
    ),
    'xl/persons/person.xml': strToU8(
      '<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><person displayName="Marie Martin" id="{11111111-1111-1111-1111-111111111111}" userId="marie.martin@exemple.fr" providerId="AD"/></personList>',
    ),
  });
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>'),
    'word/document.xml': strToU8(`<w:document ${W}><w:body><w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Budget 2027</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p></w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8(rels([['rId5', `${R}/comments`, 'comments.xml']])),
    'word/comments.xml': strToU8(`<w:comments ${W}><w:comment w:id="0" w:author="Paul Durand" w:initials="PD"><w:p><w:r><w:t>Ne pas envoyer au client avant validation</w:t></w:r></w:p></w:comment></w:comments>`),
  });
}

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + R + '"';
function pptx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'ppt/presentation.xml': strToU8(`<p:presentation ${P}><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`),
    'ppt/_rels/presentation.xml.rels': strToU8(rels([['rId7', `${R}/commentAuthors`, 'commentAuthors.xml']])),
    'ppt/commentAuthors.xml': strToU8(`<p:cmAuthorLst ${P}><p:cmAuthor id="0" name="Claire Petit" initials="CP" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>`),
    'ppt/slides/slide1.xml': strToU8(`<p:sld ${P}><p:cSld><p:spTree/></p:cSld></p:sld>`),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(rels([['rId2', `${R}/comments`, '../comments/comment1.xml']])),
    'ppt/comments/comment1.xml': strToU8(`<p:cmLst ${P}><p:cm authorId="0" dt="2026-10-02T09:00:00" idx="1"><p:pos x="10" y="10"/><p:text>Retirer ce chiffre avant la réunion</p:text></p:cm></p:cmLst>`),
  });
}

const values = (findings: Finding[], label: string) => findings.filter((f) => f.label === label).map((f) => f.value);

describe('[C6] comments in inspection', () => {
  for (const path of ['xl/comments/comment1.xml', 'xl/comments1.xml']) {
    it(`reads a workbook's comment authors and text, at ${path}`, async () => {
      const { findings } = await inspectFile(xlsx(path), 'classeur.xlsx');
      expect(values(findings, 'Comment authors').join(' ')).toContain('Marie Martin');
      expect(values(findings, 'Comment text')).toEqual(
        expect.arrayContaining(['Chiffre faux, le vrai est 340', 'Le vrai chiffre est 340, voir avec Paul']),
      );
      expect(findings.find((f) => f.label === 'Comment text')?.confidence).toBe('probable');
      expect(values(findings, 'Comment author account').join(' ')).toContain('marie.martin@exemple.fr');
    });
  }

  it('reads Word comments and PowerPoint comment authors the same way', async () => {
    const word = (await inspectFile(docx(), 'note.docx')).findings;
    expect(values(word, 'Comment text')).toContain('Ne pas envoyer au client avant validation');
    const deck = (await inspectFile(pptx(), 'deck.pptx')).findings;
    expect(values(deck, 'Comment authors').join(' ')).toContain('Claire Petit');
    expect(values(deck, 'Comment text')).toContain('Retirer ce chiffre avant la réunion');
  });
});

describe('[C6] cleaning', () => {
  it('anonymises every author and account, and names the text as still there', async () => {
    const result = await redactFile(xlsx('xl/comments/comment1.xml'), 'classeur.xlsx');
    const out = unzipSync(result.data!);
    const all = Object.values(out).map((bytes) => strFromU8(bytes)).join('\n');
    expect(all).not.toContain('Marie Martin');
    expect(all).not.toContain('marie.martin@exemple.fr');
    expect(all).toContain('Chiffre faux, le vrai est 340');
    expect(result.kept?.map((f) => f.label)).toContain('Comment text');
    const deck = unzipSync((await redactFile(pptx(), 'deck.pptx')).data!);
    expect(strFromU8(deck['ppt/commentAuthors.xml']!)).not.toContain('Claire Petit');
  });

  it('removes comments entirely on request, leaving no dangling reference', async () => {
    const result = await redactFile(xlsx('xl/comments/comment1.xml'), 'classeur.xlsx', { removeComments: true });
    const out = unzipSync(result.data!);
    const names = Object.keys(out);
    expect(names.some((n) => /comment|person|vmlDrawing/i.test(n))).toBe(false);
    expect(strFromU8(out['xl/worksheets/sheet1.xml']!)).not.toContain('legacyDrawing');
    expect(strFromU8(out['xl/worksheets/_rels/sheet1.xml.rels']!)).not.toMatch(/comment|vmlDrawing/i);
    expect(strFromU8(out['[Content_Types].xml']!)).not.toMatch(/comment|person/i);
    expect(result.notes.map((n) => n.code)).toContain('removed:comments');
    expect(result.kept?.some((f) => f.label === 'Comment text') ?? false).toBe(false);

    const word = unzipSync((await redactFile(docx(), 'note.docx', { removeComments: true })).data!);
    expect(word['word/comments.xml']).toBeUndefined();
    expect(strFromU8(word['word/document.xml']!)).not.toMatch(/comment(?:Range|Reference)/);
    expect(strFromU8(word['word/document.xml']!)).toContain('Budget 2027');

    const deck = unzipSync((await redactFile(pptx(), 'deck.pptx', { removeComments: true })).data!);
    expect(Object.keys(deck).some((n) => /comment/i.test(n))).toBe(false);
  });

  it('is offered from the command line as --remove-comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ciirta-c6-'));
    writeFileSync(join(dir, 'in.docx'), docx());
    const run = runCli(['redact', join(dir, 'in.docx'), '-o', join(dir, 'out.docx'), '--remove-comments']);
    expect(run.status).toBe(0);
    expect(unzipSync(new Uint8Array(readFileSync(join(dir, 'out.docx'))))['word/comments.xml']).toBeUndefined();
  });
});

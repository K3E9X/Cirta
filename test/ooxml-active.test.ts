import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { inspectFile, redactFile, type Finding } from '../src/core/index.js';
import { docm } from './helpers/active-office.js';
import { makeDocx } from './fixtures.js';

/*
 * [F-2.1] What an Office file does: macros that run on opening and call the
 * system, a template fetched from a server, DDE fields, pictures included
 * from elsewhere, embedded objects and ActiveX controls, resources loaded
 * from the network. Reported with their targets; --strip-active removes what
 * can go without damaging the document, and names what stays.
 */

const get = (findings: Finding[], label: string) => findings.filter((f) => f.label === label);

describe('[F-2.1] active content in Office documents', () => {
  it('reads the macros: modules, what runs on its own, what reaches the system, the addresses', async () => {
    const { findings } = await inspectFile(docm(), 'rapport.docm');
    expect(get(findings, 'Macros (VBA project)')[0]).toMatchObject({ kind: 'active-content', confidence: 'confirmed', value: '1 module: ThisDocument' });
    expect(get(findings, 'Macro that runs on its own')[0]?.value).toBe('ThisDocument: Document_Open');
    expect(get(findings, 'Macro that reaches the system')[0]?.value).toMatch(/CreateObject.*WScript\.Shell/);
    expect(get(findings, 'Address in a macro')[0]?.value).toContain('https://charge.exemple/x.ps1');
  });

  it('reports a template fetched from a server on opening', async () => {
    const { findings } = await inspectFile(docm(), 'rapport.docm');
    expect(get(findings, 'Remote template loaded on opening')[0]).toMatchObject({ confidence: 'confirmed', value: 'https://modeles.exemple/rapport.dotm' });
  });

  it('reports DDE fields and pictures included from elsewhere', async () => {
    const { findings } = await inspectFile(docm(), 'rapport.docm');
    expect(get(findings, 'DDE field (runs a command)')[0]?.value).toContain('DDEAUTO');
    expect(get(findings, 'Field loading a remote resource')[0]?.value).toContain('http://pixel.exemple/p.png');
  });

  it('reports embedded objects with their ProgID, ActiveX controls, and resources loaded from the network', async () => {
    const { findings } = await inspectFile(docm(), 'rapport.docm');
    expect(get(findings, 'Embedded object (OLE)')[0]?.value).toMatch(/oleObject1\.bin — 600 bytes, ProgID Package/);
    expect(get(findings, 'Embedded object (OLE)')[0]?.confidence).toBe('confirmed');
    expect(get(findings, 'ActiveX control')[0]?.value).toContain('{8BD21D40-EC42-11CE-9E0D-00AA006002F3}');
    expect(get(findings, 'Remote resource loaded on opening')[0]?.value).toBe('image: https://pixel.exemple/ouverture.png');
  });

  it('removes macros, the remote template and the fields with --strip-active; leaves objects and controls, named', async () => {
    const result = await redactFile(docm(), 'rapport.docm', { stripActive: true });
    const parts = unzipSync(result.data!);
    expect(Object.keys(parts).some((p) => /vbaProject/.test(p))).toBe(false);
    expect(strFromU8(parts['word/_rels/document.xml.rels']!)).not.toContain('vbaProject');
    expect(strFromU8(parts['word/settings.xml']!)).not.toContain('attachedTemplate');
    expect(strFromU8(parts['word/_rels/settings.xml.rels']!)).not.toContain('modeles.exemple');
    const document = strFromU8(parts['word/document.xml']!);
    expect(document).not.toMatch(/DDEAUTO|INCLUDEPICTURE/);
    expect(document).toContain('résultat');
    expect(result.notes).toContainEqual(expect.objectContaining({ code: 'removed:active-content' }));
    expect((result.kept ?? []).map((f) => f.label)).toEqual(expect.arrayContaining(['Embedded object (OLE)', 'ActiveX control']));
  });

  it('says nothing about an ordinary document', async () => {
    const { findings } = await inspectFile(makeDocx(), 'lettre.docx');
    expect(findings.filter((f) => f.kind === 'active-content')).toEqual([]);
  });
});

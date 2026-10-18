import { describe, expect, it } from 'vitest';
import { detectFormat, inspectFile, redactFile, UnsupportedFormatError } from '../src/core/index.js';
import { readPropertySet } from '../src/core/ole-props.js';
import { cfbFile, vbaProject } from './helpers/cfb.js';
import { compObj, legacyOffice, ole10Native, pptOleRecord, propertySet, SUMMARY, text } from './helpers/ole.js';

const find = (findings: Array<{ label: string; value: string }>, label: string) => findings.find((f) => f.label === label)?.value;

describe('[F-2.2] legacy Office (OLE2) property sets', () => {
  it('reads strings, wide strings, times and integers from a property set', () => {
    const set = readPropertySet(
      propertySet({
        fmtid: SUMMARY,
        props: { 4: 'Jeanne Dupont', 8: { wide: 'Équipe juridique' }, 12: { time: new Date('2024-03-05T10:20:30Z') }, 10: { seconds: 5400 }, 14: { i4: 12 } },
      }),
    );
    const props = set[0]!.properties;
    expect(props.get(4)).toBe('Jeanne Dupont');
    expect(props.get(8)).toBe('Équipe juridique');
    expect(props.get(12)).toBe('2024-03-05T10:20:30.000Z');
    expect(props.get(10)).toBe('1 h 30 min');
    expect(props.get(14)).toBe(12);
  });

  it('leaves out the fields a writer fills with nothing: revision 0, no minutes of editing', async () => {
    const result = await inspectFile(legacyOffice('xls', { summary: { 9: '0', 10: { seconds: 20 } } }), 'a.xls');
    expect(result.findings).toEqual([]);
  });

  it('identifies .doc, .xls and .ppt from the stream that holds the document', () => {
    expect(detectFormat(legacyOffice('doc'))).toBe('doc');
    expect(detectFormat(legacyOffice('xls'))).toBe('xls');
    expect(detectFormat(legacyOffice('ppt'))).toBe('ppt');
  });

  it('reports author, last saver, company, template and editing time of a .doc', async () => {
    const file = legacyOffice('doc', {
      summary: {
        2: 'Contrat de cession',
        4: 'Jeanne Dupont',
        7: 'C:\\Users\\jdupont\\AppData\\Roaming\\Microsoft\\Templates\\Cabinet.dot',
        8: 'Marc Leroy',
        10: { seconds: 7260 },
        12: { time: new Date('2023-11-02T08:00:00Z') },
        13: { time: new Date('2024-01-15T17:45:00Z') },
        18: 'Microsoft Office Word',
      },
      docSummary: { 15: 'Cabinet Dupont & Associés', 14: 'Me Martin' },
      custom: { Client: 'SCI Les Tilleuls', Dossier: '2024-117' },
    });
    const result = await inspectFile(file, 'contrat.doc');
    expect(result.format).toBe('doc');
    const f = result.findings;
    expect(find(f, 'Author')).toBe('Jeanne Dupont');
    expect(find(f, 'Last modified by')).toBe('Marc Leroy');
    expect(find(f, 'Company')).toBe('Cabinet Dupont & Associés');
    expect(find(f, 'Manager')).toBe('Me Martin');
    expect(find(f, 'Template')).toContain('Cabinet.dot');
    expect(find(f, 'Total editing time')).toBe('2 h 1 min');
    expect(find(f, 'Created')).toBe('2023-11-02T08:00:00.000Z');
    expect(find(f, 'Producing application')).toBe('Microsoft Office Word');
    expect(find(f, 'Custom property: Client')).toBe('SCI Les Tilleuls');
    // The code page that every section carries describes the set, not the document.
    expect(f.filter((x) => x.label.startsWith('Custom property: #'))).toEqual([]);
    // The template path names the account it was saved from.
    expect(find(f, 'Windows account')).toBe('jdupont (drive C:)');
    expect(f.find((x) => x.label === 'Author')!.location).toBe('SummaryInformation:PIDSI_AUTHOR');
    expect(result.notes.map((n) => n.code)).toContain('scope:legacy-office');
  });

  it('reads the macros of a .doc and of an .xls, where the project is a storage of the file', async () => {
    const project = vbaProject({ ThisDocument: 'Sub AutoOpen()\r\nShell "powershell -enc AAAA"\r\nEnd Sub' });
    const { readCfb } = await import('../src/core/cfb.js');
    const inner = readCfb(project)!;
    const streams = (prefix: string) =>
      Object.fromEntries(inner.entries.filter((e) => e.type === 'stream').map((e) => [`${prefix}/${e.path}`, inner.read(e.path)!]));

    const doc = await inspectFile(legacyOffice('doc', { streams: streams('Macros') }), 'a.doc');
    expect(find(doc.findings, 'Macros (VBA project)')).toContain('ThisDocument');
    expect(find(doc.findings, 'Macro that runs on its own')).toBe('ThisDocument: AutoOpen');
    expect(find(doc.findings, 'Macro that reaches the system')).toContain('Shell');

    const xls = await inspectFile(legacyOffice('xls', { streams: streams('_VBA_PROJECT_CUR') }), 'a.xls');
    expect(find(xls.findings, 'Macros (VBA project)')).toContain('ThisDocument');
  });

  it('names an embedded package, the paths it came from, and inspects the file it carries', async () => {
    const carried = text('Rapport\nAKIAIOSFODNN7EXAMPLE\n');
    const file = legacyOffice('doc', {
      streams: {
        'ObjectPool/_1452/\x01CompObj': compObj('Package', 'Package'),
        'ObjectPool/_1452/\x01Ole10Native': ole10Native(
          'notes.txt',
          'C:\\Users\\mleroy\\Desktop\\notes.txt',
          'C:\\Users\\mleroy\\AppData\\Local\\Temp\\notes.txt',
          carried,
        ),
        'ObjectPool/_1453/\x01CompObj': compObj('Microsoft Excel Worksheet', 'Excel.Sheet.8'),
        'ObjectPool/_1453/Workbook': new Uint8Array(64),
      },
    });
    const result = await inspectFile(file, 'a.doc');
    const objects = result.findings.filter((f) => f.label === 'Embedded object (OLE)');
    expect(objects.map((o) => o.value)).toEqual([
      expect.stringMatching(/^notes\.txt — 29 bytes, ProgID Package$/),
      expect.stringMatching(/^Microsoft Excel Worksheet, ProgID Excel\.Sheet\.8$/),
    ]);
    expect(objects[0]!.confidence).toBe('confirmed');
    expect(find(result.findings, 'Path of the embedded file on the author’s machine')).toBe('C:\\Users\\mleroy\\Desktop\\notes.txt');
    expect(find(result.findings, 'Windows account')).toBe('mleroy (drive C:)');
    expect(result.findings.some((f) => f.location.startsWith('ObjectPool/_1452 → notes.txt') && /Credential/.test(f.label))).toBe(true);
  });

  it('reads the macros and objects PowerPoint keeps compressed inside its document stream', async () => {
    const project = vbaProject({ Module1: 'Sub Auto_Open()\r\nEnd Sub' });
    const result = await inspectFile(legacyOffice('ppt', { streams: { 'PowerPoint Document': pptOleRecord(project) } }), 'a.ppt');
    expect(find(result.findings, 'Macros (VBA project)')).toContain('Module1');
    expect(find(result.findings, 'Macro that runs on its own')).toBe('Module1: Auto_Open');
  });

  it('refuses to clean, says why and what to do instead', async () => {
    const file = legacyOffice('doc', { summary: { 4: 'Jeanne Dupont' } });
    const error = await redactFile(file, 'a.doc').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedFormatError);
    expect((error as UnsupportedFormatError).code).toBe('legacy-not-rewritable');
    expect((error as UnsupportedFormatError).detail).toBe('doc');
  });

  it('survives property sets whose offsets point anywhere', async () => {
    const set = propertySet({ fmtid: SUMMARY, props: { 4: 'x', 8: { wide: 'y' } } });
    for (let i = 0; i < 200; i++) {
      const bad = set.slice();
      const at = 28 + ((i * 37) % (bad.length - 28));
      bad[at] = (bad[at]! + 0x41 + i) & 0xff;
      expect(() => readPropertySet(bad)).not.toThrow();
    }
    // A stated count of a billion properties is read as far as the stream goes.
    const huge = set.slice();
    new DataView(huge.buffer).setUint32(48 + 4, 1_000_000_000, true);
    expect(() => readPropertySet(huge)).not.toThrow();
    await expect(inspectFile(cfbFile({ WordDocument: new Uint8Array(8), '\x05SummaryInformation': huge }), 'a.doc')).resolves.toBeDefined();
  });

  it('refuses a compound file it cannot name, rather than guessing', async () => {
    const error = await inspectFile(cfbFile({ Something: new Uint8Array(8) })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedFormatError);
    expect((error as UnsupportedFormatError).code).toBe('unsupported');
  });
});

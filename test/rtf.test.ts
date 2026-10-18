import { describe, expect, it } from 'vitest';
import { detectFormat, inspectFile, redactFile } from '../src/core/index.js';
import { ole10Native } from './helpers/ole.js';
import { makeJpeg } from './fixtures.js';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const find = (findings: Array<{ label: string; value: string }>, label: string) => findings.find((f) => f.label === label)?.value;

/** OLE1 object header (MS-OLEDS 2.2.4): version, format, class name, topic, item, then the native data. */
function ole1(className: string, native: Uint8Array): Uint8Array {
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const lp = (s: string) => [...u32(s.length + 1), ...enc(s), 0];
  return new Uint8Array([...u32(0x0501), ...u32(2), ...lp(className), ...u32(0), ...u32(0), ...u32(native.length), ...native]);
}

const package_ = ole10Native('facture.pdf.exe', 'C:\\Users\\jdupont\\Desktop\\facture.pdf.exe', 'C:\\Users\\jdupont\\AppData\\Local\\Temp\\facture.pdf.exe', enc('MZ'));

const rtf = (body = 'Bonjour \\\'e9t\\\'e9.') =>
  enc(
    '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Calibri;}}{\\*\\generator Riched20 10.0.19041}' +
      '{\\info{\\title Contrat de cession}{\\author Jeanne Dupont}{\\operator Marc Leroy}{\\*\\company Cabinet Dupont}' +
      '{\\creatim\\yr2024\\mo3\\dy5\\hr10\\min20}{\\revtim\\yr2024\\mo3\\dy6\\hr9\\min5}\\edmins125{\\*\\manager Me Martin}}' +
      `\\pard ${body}\\par` +
      `{\\object\\objemb{\\*\\objclass Package}{\\*\\objdata ${hex(ole1('Package', package_.subarray(4)))}}{\\result {\\pict ...}}}` +
      '}',
  );

describe('[F-P2 2.2] RTF', () => {
  it('is told by its first bytes', () => {
    expect(detectFormat(rtf())).toBe('rtf');
  });

  it('reports the info group, the generator and the objects it carries', async () => {
    const result = await inspectFile(rtf(), 'contrat.rtf');
    expect(result.format).toBe('rtf');
    const f = result.findings;
    expect(find(f, 'Author')).toBe('Jeanne Dupont');
    expect(find(f, 'Last modified by')).toBe('Marc Leroy');
    expect(find(f, 'Company')).toBe('Cabinet Dupont');
    expect(find(f, 'Manager')).toBe('Me Martin');
    expect(find(f, 'Title')).toBe('Contrat de cession');
    expect(find(f, 'Created')).toBe('2024-03-05 10:20');
    expect(find(f, 'Total editing time')).toBe('2 h 5 min');
    expect(find(f, 'Producing application')).toBe('Riched20 10.0.19041');
    expect(find(f, 'Embedded object (OLE)')).toBe('facture.pdf.exe — 2 bytes, ProgID Package');
    expect(find(f, 'Path of the embedded file on the author’s machine')).toContain('C:\\Users\\jdupont\\Desktop');
    expect(find(f, 'Windows account')).toBe('jdupont (drive C:)');
    expect(find(f, 'Double extension hiding a program')).toBeDefined();
  });

  it('cleans the info group and the generator, keeps the text, and takes objects out on request, their picture left', async () => {
    const plain = await redactFile(rtf(), 'contrat.rtf');
    const text = dec(plain.data!);
    expect(text).not.toMatch(/\\info|Jeanne|Marc Leroy|Cabinet|\\generator/);
    expect(text).toContain("Bonjour \\'e9t\\'e9.");
    expect(text).toContain('\\objdata');
    expect(text.startsWith('{\\rtf1')).toBe(true);

    const stripped = dec((await redactFile(rtf(), 'contrat.rtf', { stripActive: true })).data!);
    expect(stripped).not.toContain('\\objdata');
    expect(stripped).toContain('{\\pict ...}');
    // Braces still balance.
    let depth = 0;
    for (let i = 0; i < stripped.length; i++) {
      if (stripped[i] === '\\') i++;
      else if (stripped[i] === '{') depth++;
      else if (stripped[i] === '}') depth--;
    }
    expect(depth).toBe(0);
  });

  it('decodes the characters of a value: code page escapes and Unicode', async () => {
    const file = enc('{\\rtf1\\ansi\\ansicpg1252{\\info{\\author Fran\\\'e7ois \\u8364?uro}}\\pard x\\par}');
    expect(find((await inspectFile(file, 'a.rtf')).findings, 'Author')).toBe('François €uro');
  });

  it('reads what Word adds: template, custom properties, revision identifiers, authors of changes and comments, pictures, fields', async () => {
    const jpeg = makeJpeg();
    const word = enc(
      '{\\rtf1\\ansi\\ansicpg1252{\\*\\template C:\\\\Users\\\\mleroy\\\\AppData\\\\Roaming\\\\Microsoft\\\\Templates\\\\Normal.dotm}' +
        '{\\*\\revtbl {Unknown;}{Jeanne Dupont;}}{\\*\\rsidtbl \\rsid1180679\\rsid2557386}' +
        '{\\*\\userprops {\\propname Client}\\proptype30{\\staticval ACME SA}}' +
        '\\pard\\plain \\insrsid2557386 Texte {\\*\\atnid MD}{\\*\\atnauthor Marc Dupont}\\chatn {\\*\\annotation \\pard Revoir}' +
        `{\\pict\\jpegblip\\picw10\\pich10 ${hex(jpeg)}}` +
        '{\\field{\\*\\fldinst {HYPERLINK "file:///C:/Users/mleroy/Documents/prix.xlsx"}}{\\fldrslt {prix}}}' +
        '{\\field{\\*\\fldinst {INCLUDEPICTURE "https://suivi.example.com/p.gif" \\\\* MERGEFORMATINET}}{\\fldrslt {}}}' +
        '{\\field{\\*\\fldinst {HYPERLINK "https://www.google.com/url?q=https://evil.example/x"}}{\\fldrslt {lien}}}' +
        '\\par}',
    );
    const f = (await inspectFile(word, 'a.rtf')).findings;
    expect(find(f, 'Template')).toBe('C:\\Users\\mleroy\\AppData\\Roaming\\Microsoft\\Templates\\Normal.dotm');
    expect(find(f, 'Custom property: Client')).toBe('ACME SA');
    expect(find(f, 'Revision save IDs')).toMatch(/^2 values/);
    expect(find(f, 'Comment and revision authors')).toBe('Jeanne Dupont, Marc Dupont');
    expect(find(f, 'Link to a local or network path')).toBe('file:///C:/Users/mleroy/Documents/prix.xlsx');
    expect(find(f, 'Remote resource loaded on opening')).toBe('picture: https://suivi.example.com/p.gif');
    expect(find(f, 'Link through an open redirector')).toBe('www.google.com → https://evil.example/x');
    expect(f.some((x) => x.location === '\\pict 1' && x.label === 'Exif with GPS coordinates')).toBe(true);
    expect(find(f, 'Windows account')).toMatch(/^mleroy/);

    const out = await redactFile(word, 'a.rtf');
    const text = dec(out.data!);
    expect(text).not.toMatch(/mleroy\\\\AppData|ACME|rsid|Jeanne|Marc Dupont|MD\}/);
    expect(text).toContain('{\\*\\revtbl {Unknown;}{Author;}}');
    expect(text).toContain('Texte ');
    expect(text).toContain('Revoir');
    const after = (await inspectFile(out.data!, 'a.rtf')).findings;
    expect(after.some((x) => x.location === '\\pict 1' && x.label === 'Exif with GPS coordinates')).toBe(false);
    expect(after.some((x) => x.label === 'Comment and revision authors')).toBe(false);
    // Fields are content: what survives is named, not hidden.
    expect((out.kept ?? []).map((x) => x.label)).toContain('Link to a local or network path');
  });
});


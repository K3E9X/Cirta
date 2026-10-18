import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { inspectFile } from '../src/core/index.js';
import { linkFindings } from '../src/core/links.js';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';

const labels = (findings: Array<{ label: string }>) => findings.map((f) => f.label);
const value = (findings: Array<{ label: string; value: string }>, label: string) => findings.find((f) => f.label === label)?.value;

describe('[F-P2 2.1] links that run, carry or bounce', () => {
  it('names a javascript: link and a data: link, with what the data is', () => {
    const found = linkFindings(['javascript:alert(document.cookie)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,iVBORw0KGgo='], 'links');
    expect(value(found, 'Link that runs a script')).toBe('javascript:alert(document.cookie)');
    const data = found.filter((f) => f.label === 'Link to data carried in the address');
    expect(data.map((f) => [f.value, f.confidence])).toEqual([
      ['data:text/html (a page, opened as one)', 'confirmed'],
      ['data:image/png', 'probable'],
    ]);
    // Case and spaces do not hide a scheme from a browser, nor from this.
    expect(labels(linkFindings([' JavaScript:void(0)'], 'links'))).toContain('Link that runs a script');
  });

  it('names a known open redirector and where it really goes', () => {
    const found = linkFindings(
      [
        'https://www.google.com/url?q=https%3A%2F%2Fevil.example%2Flogin&sa=D',
        'https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.example%2F',
        'https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fevil.example%2Fa&data=x',
        'https://www.google.com/search?q=cirta',
      ],
      'links',
    );
    const redirects = found.filter((f) => f.label === 'Link through an open redirector');
    expect(redirects.map((f) => f.value)).toEqual([
      'www.google.com → https://evil.example/login',
      'l.facebook.com → https://evil.example/',
      'nam12.safelinks.protection.outlook.com → https://evil.example/a',
    ]);
    expect(redirects.every((f) => f.confidence === 'confirmed')).toBe(true);
  });

  it('flags an unknown site that hands an address in its query to another host, as probable', () => {
    const found = linkFindings(['https://shop.example/out?redirect=https://other.example/pay', 'https://shop.example/out?next=/account'], 'links');
    const redirects = found.filter((f) => f.label === 'Link through an open redirector');
    expect(redirects.map((f) => [f.value, f.confidence])).toEqual([['shop.example → https://other.example/pay', 'probable']]);
  });

  it('reads them in an HTML page, a Markdown file, a mail, an Office document and a PDF', async () => {
    const html = '<html><body><a href="javascript:steal()">Ouvrir</a><a href="https://www.google.com/url?q=https://evil.example/">Banque</a><a href="https://evil.example/">https://banque.fr</a></body></html>';
    const page = (await inspectFile(strToU8(html), 'a.html')).findings;
    expect(labels(page)).toEqual(expect.arrayContaining(['Link that runs a script', 'Link through an open redirector', 'Link text shows a different address']));

    const md = (await inspectFile(strToU8('# Notes\n\n[https://banque.fr](https://evil.example/) et [clic](javascript:x())\n'), 'markdown')).findings;
    expect(labels(md)).toEqual(expect.arrayContaining(['Link that runs a script', 'Link text shows a different address']));

    const mail = strToU8('From: a@b.fr\r\nTo: c@d.fr\r\nSubject: x\r\nMIME-Version: 1.0\r\nContent-Type: text/html\r\n\r\n<a href="data:text/html,<script>x</script>">facture</a>\r\n');
    expect(labels((await inspectFile(mail, 'a.eml')).findings)).toContain('Link to data carried in the address');

    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<w:document><w:body><w:p><w:hyperlink r:id="rId9"><w:r><w:t>site</w:t></w:r></w:hyperlink></w:p></w:body></w:document>'),
      'word/_rels/document.xml.rels': strToU8(`<Relationships><Relationship Id="rId9" Type="${R}/hyperlink" Target="https://www.google.com/url?q=https://evil.example/" TargetMode="External"/></Relationships>`),
    });
    expect(labels((await inspectFile(docx, 'a.docx')).findings)).toContain('Link through an open redirector');
  });

  it('reads them in the links of a PDF', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([200, 200]);
    const ctx = pdf.context;
    const link = (uri: string) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: ctx.obj({ S: PDFName.of('URI'), URI: PDFHexString.fromText(uri) }) }));
    page.node.set(PDFName.of('Annots'), ctx.obj([link('javascript:app.alert(1)'), link('https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.example%2F')]));
    await pdf.attach(new TextEncoder().encode('MZ'), 'releve\u202Efdp.exe', { mimeType: 'application/octet-stream' });
    const found = (await inspectFile(await pdf.save(), 'a.pdf')).findings;
    expect(labels(found)).toEqual(expect.arrayContaining(['Link that runs a script', 'Link through an open redirector']));
  });
});

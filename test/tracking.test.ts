import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { inspectFile, redactFile, type Finding } from '../src/core/index.js';
import { cleanUrl } from '../src/core/tracking.js';

/*
 * [F-2.4] A link copied from a newsletter or an ad carries who clicked and
 * from which campaign: utm_*, fbclid, gclid, mc_eid… Reported, and taken out
 * of the links on request — the rest of each address untouched.
 */

const enc = (text: string) => new TextEncoder().encode(text);
const labels = (findings: Finding[]) => findings.filter((f) => f.label === 'Tracking parameters in a link');

describe('[F-2.4] tracking parameters', () => {
  it('cleans an address and leaves everything else as it was', () => {
    expect(cleanUrl('https://exemple.fr/offre?id=7&utm_source=lettre&utm_medium=mail&fbclid=IwAR0x#prix')).toBe('https://exemple.fr/offre?id=7#prix');
    expect(cleanUrl('https://exemple.fr/?gclid=abc')).toBe('https://exemple.fr/');
    expect(cleanUrl('https://exemple.fr/?id=7')).toBeUndefined();
  });

  it('reports them in HTML and Markdown links', async () => {
    const html = await inspectFile(enc('<html><body><a href="https://exemple.fr/a?utm_source=x&amp;mc_eid=123">lien</a></body></html>'), 'html');
    expect(labels(html.findings)[0]).toMatchObject({ confidence: 'probable', value: 'https://exemple.fr/a — utm_source, mc_eid' });
    const md = await inspectFile(enc('# Titre\n\nVoir [ici](https://exemple.fr/b?fbclid=Z1).\n'), 'markdown');
    expect(labels(md.findings)[0]?.value).toBe('https://exemple.fr/b — fbclid');
  });

  it('reports and strips them in an Office hyperlink', async () => {
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId4" Type="${REL}/hyperlink" Target="https://exemple.fr/c?utm_campaign=rentree&amp;id=2" TargetMode="External"/></Relationships>`,
      ),
    });
    expect(labels((await inspectFile(docx, 'lettre.docx')).findings)[0]?.value).toBe('https://exemple.fr/c — utm_campaign');
    const result = await redactFile(docx, 'lettre.docx', { stripTracking: true });
    expect(strFromU8(unzipSync(result.data!)['word/_rels/document.xml.rels']!)).toContain('Target="https://exemple.fr/c?id=2"');
    expect(result.notes).toContainEqual({ code: 'removed:tracking-params', detail: '1' });
  });

  it('strips them from HTML and from PDF links', async () => {
    const page = await redactFile(enc('<html><body><a href="https://exemple.fr/a?utm_source=x&amp;id=1">lien</a></body></html>'), 'html', { stripTracking: true });
    expect(new TextDecoder().decode(page.data)).toContain('href="https://exemple.fr/a?id=1"');

    const pdf = await PDFDocument.create();
    const p = pdf.addPage([100, 100]);
    p.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: pdf.context.obj({ S: 'URI', URI: PDFString.of('https://exemple.fr/d?gclid=G1') }) })]));
    const bytes = await pdf.save();
    expect(labels((await inspectFile(bytes, 'pdf')).findings)[0]?.value).toBe('https://exemple.fr/d — gclid');
    const cleaned = await redactFile(bytes, 'pdf', { stripTracking: true });
    const after = await inspectFile(cleaned.data!, 'pdf');
    expect(labels(after.findings)).toEqual([]);
    expect(after.findings.find((f) => f.label === 'Web addresses linked')?.value).toBe('1 — https://exemple.fr/d');
  });
});

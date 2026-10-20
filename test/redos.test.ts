import { strToU8, unzipSync, zipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeDocx, makeXlsx } from './fixtures.js';
import { corpus } from './helpers/cv-corpus.js';
import { deck } from './helpers/deck.js';
import { incrementalPdf } from './helpers/incremental-pdf.js';
import { odt } from './helpers/odt.js';
import { bundleCore, timed } from './helpers/redos.js';

/*
 * [P0-1] Regular expressions that a hostile file can make backtrack. Each
 * case is a file built to make one of them take exponential or quadratic
 * time; inspecting and cleaning it must end within the budget, which the
 * vulnerable expression overran by orders of magnitude (measured before each
 * fix, and named in the case). scripts/redos.mjs finds the candidates.
 */

const BUDGET = 10_000;
let core = '';
beforeAll(async () => {
  core = await bundleCore();
}, 60_000);

/** A part of an Office package, rewritten. */
function rewrite(base: Uint8Array, path: string, edit: (xml: string) => string): Uint8Array {
  const parts = unzipSync(base);
  parts[path] = strToU8(edit(new TextDecoder().decode(parts[path])));
  return zipSync(parts);
}

const cv = async (name: string) => (await corpus()).find((c) => c.name === name)!.bytes;

/** A file of an Office package with one more part. */
function withPart(base: Uint8Array, path: string, content: string): Uint8Array {
  const parts = unzipSync(base);
  parts[path] = strToU8(content);
  return zipSync(parts);
}

async function expectQuick(bytes: Uint8Array, name: string): Promise<void> {
  const ms = await timed(core, bytes, name, BUDGET);
  expect(ms, `${name}: still running after ${BUDGET} ms`).toBeDefined();
}

describe('[P0-1] ReDoS: a hostile file is read in time', () => {
  it('an Office part whose prolog is a run of broken comments (rootOf: exponential, 9 s for 195 bytes)', async () => {
    const prolog = '<!-' + '---><!--><!----><!-'.repeat(40) + '-\t';
    await expectQuick(withPart(makeDocx(), 'word/notes.xml', prolog), 'piege.docx');
  }, 30_000);

  it('a Word paragraph of runs that never close (w:r, w:rPr: quadratic, 8 s for 200 KB)', async () => {
    const docx = rewrite(await cv('mots-cles-1pt.docx'), 'word/document.xml', (xml) => xml.replace('</w:p>', '<w:r>'.repeat(40_000) + '<w:rPr>'.repeat(30_000) + '</w:p>'));
    await expectQuick(docx, 'piege.docx');
  }, 30_000);

  it('Word styles that never close, nested or not (w:style, elements(): quadratic)', async () => {
    const docx = withPart(await cv('mots-cles-1pt.docx'), 'word/styles.xml', '<w:styles>' + '<w:style w:styleId="a">'.repeat(30_000) + '<w:rPr>'.repeat(30_000) + '</w:style></w:styles>');
    await expectQuick(docx, 'piege.docx');
  }, 30_000);

  it('a slide of runs and outlines that never close (a:r, a:rPr, a:ln, a:effectLst: quadratic)', async () => {
    const pptx = rewrite(deck([{ words: 'Bonjour' }]), 'ppt/slides/slide1.xml', (xml) =>
      xml.replace('<p:spPr/>', '<p:spPr>' + '<a:ln w="1">'.repeat(20_000) + '<a:effectLst>'.repeat(20_000) + '</p:spPr>').replace('</a:p>', '<a:r>'.repeat(40_000) + '<a:rPr b="1">'.repeat(30_000) + '</a:p>'),
    );
    await expectQuick(pptx, 'piege.pptx');
  }, 30_000);

  it('a workbook of tags and names that never close (sheet, row, t, definedName, ddeLink, progid: quadratic)', async () => {
    const junk = '<sheet name="a" '.repeat(20_000) + '<definedName' + ' name="a"'.repeat(20_000) + '<row r="1" '.repeat(20_000) + '<t>'.repeat(20_000) + '<x' + ' progid="a"'.repeat(20_000);
    let xlsx = makeXlsx();
    for (const path of Object.keys(unzipSync(xlsx)).filter((p) => p.startsWith('xl/') && p.endsWith('.xml'))) xlsx = rewrite(xlsx, path, (xml) => xml.replace(/<\/[^<>]*>$/, (end) => junk + end));
    xlsx = withPart(xlsx, 'xl/externalLinks/externalLink9.xml', '<externalLink><ddeLink' + ' ddeService="a"'.repeat(30_000) + '/></externalLink>');
    await expectQuick(xlsx, 'piege.xlsx');
  }, 30_000);
  it('an HTML page of comments, scripts, styles, meta and CSS urls that never close (sanitize, markup, beacons: quadratic)', async () => {
    const html =
      '<html><head><meta name="generator" content="x"></head><body><p>Bonjour</p>' +
      '<!--'.repeat(40_000) + '<script>'.repeat(40_000) + '<style>'.repeat(40_000) + '<meta\t' + '\t'.repeat(100_000) +
      'url(//S'.repeat(30_000) + '<script' + ' type="application/ld+json"'.repeat(8_000) + '<metadata>'.repeat(20_000);
    await expectQuick(new TextEncoder().encode(html), 'piege.html');
  }, 30_000);

  it('Markdown of comments, links, images and blank runs that never close (markup, links, beacons, residue: quadratic)', async () => {
    const md = '# Titre\n\n' + '<!--'.repeat(40_000) + '\n' + '[](('.repeat(30_000) + '\n' + '![](//p'.repeat(30_000) + '\n' + '[x](http://x'.repeat(15_000) + '\n' + '|' + ' '.repeat(100_000) + '-\n' + 'Cordialement' + ' \t'.repeat(50_000) + 'x\n';
    await expectQuick(new TextEncoder().encode(md), 'piege.md');
  }, 30_000);

  it('a mail whose headers are long runs of blanks and semicolons (mime, email: quadratic)', async () => {
    const eml = 'From: a@example.com\r\nX-A:' + '\t'.repeat(100_000) + '\u0000\n\r\nContent-Type: text/plain; ' + ';'.repeat(60_000) + '"\r\n\r\nBonjour\r\n';
    await expectQuick(new TextEncoder().encode(eml), 'piege.eml');
  }, 30_000);

  it('an EPUB whose package never closes its CDATA, its metadata or its meta tags (epub: quadratic)', async () => {
    const opf = '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier>' +
      '<dc:title>' + '<![CDATA['.repeat(20_000) + '</dc:title>' + '<dc:date>u'.repeat(20_000) + '<meta' + ' property="dcterms:modified"'.repeat(10_000) + '<meta' + ' name="calibre:x"'.repeat(10_000) + '</metadata><manifest/><spine/></package>';
    const book = zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
      'META-INF/encryption.xml': strToU8('<encryption>' + '<EncryptedData:'.repeat(20_000) + '</encryption>'),
      'content.opf': strToU8(opf),
      'toc.ncx': strToU8('<ncx><head>' + '<meta name="dtb:uid"'.repeat(10_000) + '</head></ncx>'),
    });
    await expectQuick(book, 'piege.epub');
  }, 30_000);

  it('an OpenDocument text of styles and bodies that never close (hidden-odf: quadratic)', async () => {
    const doc = odt('<text:p>Bonjour</text:p>' + '<text:span text:style-name="T' + '-'.repeat(100_000) + '/', '<style:style style:name="T">'.repeat(20_000));
    const twice = rewrite(doc, 'content.xml', (xml) => xml.replace('<office:body>', '<office:body>'.repeat(20_000)));
    await expectQuick(twice, 'piege.odt');
  }, 30_000);

  it('a PDF whose content stream is a run of escaped parentheses (literal strings: quadratic)', async () => {
    await expectQuick(incrementalPdf('a) ' + '(\\'.repeat(60_000)), 'piege.pdf');
  }, 30_000);
});

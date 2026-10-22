import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { inspectFile, redactFile, UnsupportedFormatError } from '../src/core/index.js';
import { collectTextContent, getElementText } from '../src/core/xml.js';
import { jpegWith, xmpApp1 } from './helpers/tiff.js';

/*
 * [F-2.8] Hostile XML. Ciirta reads XML with its own scanner, not a DOM parser,
 * and resolves no entity beyond the five predefined ones and numeric
 * references. These tests hold it to that: a document type declaration is
 * text, never instructions — no expansion, no file read, no network.
 */

const LAUGHS =
  '<!DOCTYPE lolz [<!ENTITY lol "lol">' +
  Array.from({ length: 9 }, (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i || ''};`.repeat(10)}">`).join('') +
  ']>';
const EXTERNAL = '<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY net SYSTEM "http://169.254.169.254/latest/meta-data/">]>';

const core = (prolog: string, creator: string) =>
  `<?xml version="1.0"?>${prolog}<cp:coreProperties xmlns:cp="c" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>${creator}</dc:creator></cp:coreProperties>`;

const docx = (coreXml: string, body = '<w:document><w:body><w:p><w:r><w:t>texte</w:t></w:r></w:p></w:body></w:document>') =>
  zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    '_rels/.rels': strToU8('<Relationships/>'),
    'docProps/core.xml': strToU8(coreXml),
    'word/document.xml': strToU8(body),
  });

const timed = async <T>(work: () => Promise<T>, limit = 5000): Promise<T> => {
  const started = Date.now();
  const result = await work();
  expect(Date.now() - started).toBeLessThan(limit);
  return result;
};

describe('[F-2.8] hostile XML', () => {
  it('resolves no entity: the scanner keeps an entity reference as written', () => {
    expect(getElementText(core(LAUGHS, '&lol9;'), 'dc:creator')).toBe('&lol9;');
    expect(collectTextContent('<a>&xxe; &lt;b&gt; &#x41;</a>')).toBe('&xxe; <b> A');
  });

  it('does not expand a billion laughs, in a .docx or in an SVG', async () => {
    const report = await timed(() => inspectFile(docx(core(LAUGHS, '&lol9;')), 'a.docx'));
    const author = report.findings.find((f) => f.label === 'Author')?.value ?? '';
    expect(author.length).toBeLessThan(20);
    expect(JSON.stringify(report).includes('lollollol')).toBe(false);
    await timed(() => redactFile(docx(core(LAUGHS, '&lol9;')), 'a.docx'));

    const svg = `<?xml version="1.0"?>${LAUGHS}<svg xmlns="http://www.w3.org/2000/svg"><title>&lol9;</title><metadata>&lol9;</metadata></svg>`;
    const inspected = await timed(() => inspectFile(strToU8(svg), 'a.svg'));
    expect(JSON.stringify(inspected).includes('lollollol')).toBe(false);
  });

  it('reads no external entity: no file, no address, in Office, SVG, OpenDocument or XMP', async () => {
    const results = [
      await inspectFile(docx(core(EXTERNAL, '&xxe;&net;')), 'a.docx'),
      await inspectFile(strToU8(`<?xml version="1.0"?>${EXTERNAL}<svg xmlns="http://www.w3.org/2000/svg"><desc>&xxe;</desc></svg>`), 'a.svg'),
      await inspectFile(
        zipSync({
          mimetype: strToU8('application/vnd.oasis.opendocument.text'),
          'meta.xml': strToU8(`<?xml version="1.0"?>${EXTERNAL}<office:document-meta xmlns:office="o" xmlns:meta="m" xmlns:dc="d"><office:meta><dc:creator>&xxe;</dc:creator></office:meta></office:document-meta>`),
          'content.xml': strToU8('<office:document-content/>'),
        }),
        'a.odt',
      ),
      await inspectFile(jpegWith(undefined, xmpApp1(`${EXTERNAL}<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>&xxe;</dc:creator></x:xmpmeta>`)), 'a.jpg'),
    ];
    const text = JSON.stringify(results);
    expect(text).not.toMatch(/root:|daemon:|ami-id|instance-id/);
  });

  it('survives XML nested a hundred thousand levels deep', async () => {
    const deep = `<w:document><w:body>${'<w:p>'.repeat(100_000)}<w:r><w:t>fond</w:t></w:r>${'</w:p>'.repeat(100_000)}</w:body></w:document>`;
    const file = docx(core('', 'Jeanne'), deep);
    const report = await timed(() => inspectFile(file, 'a.docx'), 15_000);
    expect(report.findings.find((f) => f.label === 'Author')?.value).toBe('Jeanne');
    await timed(() => redactFile(file, 'a.docx', { removeHidden: true }), 15_000);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${'<g>'.repeat(100_000)}${'</g>'.repeat(100_000)}</svg>`;
    await timed(() => inspectFile(strToU8(svg), 'a.svg'), 15_000);
  });

  it('survives an attribute of several megabytes and an unclosed one', async () => {
    const huge = 'A'.repeat(8 * 1024 * 1024);
    const body = `<w:document><w:body><w:p w:rsidR="${huge}"><w:r><w:t>texte</w:t></w:r></w:p><w:p w:x="${'"'.repeat(1)}</w:body></w:document>`;
    const report = await timed(() => inspectFile(docx(core('', 'Jeanne'), body), 'a.docx'), 15_000);
    expect(report.findings.find((f) => f.label === 'Author')?.value).toBe('Jeanne');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-x="${huge}"><title>t</title></svg>`;
    await timed(() => inspectFile(strToU8(svg), 'a.svg'), 15_000);
  });

  it('refuses or reads, never crashes, on a notebook nested beyond what JSON tools handle', async () => {
    const deep = `{"cells":[],"nbformat":4,"metadata":{"x":${'['.repeat(200_000)}${']'.repeat(200_000)}}}`;
    for (const run of [() => inspectFile(strToU8(deep), 'a.ipynb'), () => redactFile(strToU8(deep), 'a.ipynb')]) {
      await run().then(
        (result) => expect(result.format).toBeDefined(),
        (error: unknown) => expect(error).toBeInstanceOf(UnsupportedFormatError),
      );
    }
  });
});

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import {
  inspectFile,
  scanText,
  redactOoxml,
  redactPdf,
  redactFile,
  provenance,
  CONFIDENCE_ORDER,
  type Finding,
} from '../src/core/index.js';
import { makePdf, makePptx, makeDocx, tagEncode } from './fixtures.js';

const confidenceOf = (findings: Finding[], label: string) =>
  findings.find((f) => f.label === label)?.confidence;

describe('confidence classification', () => {
  it('marks verbatim personal and organisational data as confirmed', async () => {
    const { findings } = await inspectFile(makePptx());
    expect(confidenceOf(findings, 'Author')).toBe('confirmed');
    expect(confidenceOf(findings, 'Last modified by')).toBe('confirmed');
    expect(confidenceOf(findings, 'Company')).toBe('confirmed');
    expect(confidenceOf(findings, 'Manager')).toBe('confirmed');
    expect(confidenceOf(findings, 'Custom property: ClassificationInterne')).toBe('confirmed');
  });

  it('treats a template path as confirmed because it carries the local username', async () => {
    const { findings } = await inspectFile(makePptx());
    const template = findings.find((f) => f.label === 'Template');
    expect(template?.confidence).toBe('confirmed');
    expect(template?.value).toContain('lotfi');
  });

  it('marks software identification as informational, not a personal leak', async () => {
    const { findings } = await inspectFile(makePptx());
    expect(confidenceOf(findings, 'Producing application')).toBe('informational');
    expect(confidenceOf(findings, 'Application version')).toBe('informational');
  });

  it('marks workflow traces as probable', async () => {
    const { findings } = await inspectFile(makePptx());
    expect(confidenceOf(findings, 'Created')).toBe('probable');
    expect(confidenceOf(findings, 'Revision number')).toBe('probable');
    expect(confidenceOf(findings, 'Total editing time')).toBe('probable');
  });

  it('classifies PDF producer strings apart from the author', async () => {
    const { findings } = await inspectFile(await makePdf());
    expect(confidenceOf(findings, 'Author')).toBe('confirmed');
    expect(confidenceOf(findings, 'Producing application')).toBe('informational');
    expect(confidenceOf(findings, 'Title')).toBe('probable');
  });

  it('marks comment authors as confirmed', async () => {
    const { findings } = await inspectFile(makeDocx());
    expect(confidenceOf(findings, 'Comment and revision authors')).toBe('confirmed');
  });

  it('sorts reports so confirmed findings come first', async () => {
    for (const data of [await makePdf(), makePptx(), makeDocx()]) {
      const { findings } = await inspectFile(data);
      const ranks = findings.map((f) => CONFIDENCE_ORDER[f.confidence]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});

describe('confidence in text scans', () => {
  it('treats invisible control characters as confirmed', () => {
    const { findings } = scanText(`Rapport${tagEncode('ID42')}`);
    expect(findings.every((f) => f.confidence === 'confirmed')).toBe(true);
  });

  it('treats exotic whitespace as informational', () => {
    // A no-break space before a colon is standard French typography, not a marker.
    const { findings } = scanText('Objet : rapport');
    expect(confidenceOf(findings, 'no-break space')).toBe('informational');
  });
});

describe('redaction options', () => {
  // These are exported API with defaults, and nothing in the CLI or the web
  // passes them — so without a test they are the one part of the surface no
  // execution path covers.
  it('keeps the thumbnail when asked to', async () => {
    const kept = redactOoxml(makePptx(), { removeThumbnail: false });
    expect(Object.keys(unzipSync(kept.data!))).toContain('docProps/thumbnail.jpeg');

    const dropped = redactOoxml(makePptx());
    expect(Object.keys(unzipSync(dropped.data!))).not.toContain('docProps/thumbnail.jpeg');
  });

  it('keeps rsids and author names when asked to', async () => {
    const parts = unzipSync(
      redactOoxml(makeDocx(), { removeRsids: false, anonymizeAuthors: false }).data!,
    );
    expect(strFromU8(parts['word/settings.xml']!)).toContain('w:rsid');
    expect(strFromU8(parts['word/comments.xml']!)).toContain('Lotfi Zakaria');
  });

  it('keeps the XMP packet when asked to', async () => {
    const pdf = await makePdf();
    const kept = await redactPdf(pdf, { removeXmp: false });
    expect(kept.notes.map((n) => n.code)).not.toContain('removed:c2pa');
    // The /Info dictionary is emptied either way; only XMP is conditional.
    expect(kept.removed.length).toBeGreaterThan(0);
  });
});

describe('credentials that cannot occur in prose', () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it('finds the ones people actually leak', async () => {
    const env = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n-----BEGIN RSA PRIVATE KEY-----\n';
    const labels = (await inspectFile(encode(env), 'conf.txt')).findings.map((f) => f.label);
    expect(labels).toContain('Credential left in file: AWS access key id');
    expect(labels).toContain('Private key block');
  });

  it('masks to the vendor marker, not to a fixed length', async () => {
    // A fixed six characters printed two characters of an AWS secret into a
    // report the user is likely to paste somewhere.
    const finding = (await inspectFile(encode('AKIAIOSFODNN7EXAMPLE'), 'k.txt')).findings[0];
    expect(finding?.value).toContain('AKIA…');
    expect(finding?.value).not.toContain('AKIAIO');
  });
});

describe('the provenance question', () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  const pdfWith = async (fields: { creator?: string; producer?: string }) => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]).drawText('contenu');
    if (fields.creator) pdf.setCreator(fields.creator);
    if (fields.producer) pdf.setProducer(fields.producer);
    return pdf.save();
  };

  it('names the assistant, the model and the framework in one answer', async () => {
    const data = await pdfWith({
      creator: 'claude-opus-5 via LangChain 0.3.7',
      producer: 'ReportLab PDF Library',
    });
    const result = provenance((await inspectFile(data)).findings);
    expect(result.attributed).toBe(true);
    expect(result.tools[0]).toContain('claude-opus-5');
    expect(result.tools.join(' ')).toContain('LangChain');
  });

  it('does not call a plain library an AI', async () => {
    // python-docx wrote the container; that says nothing about who wrote the
    // words, and claiming otherwise would be the whole failure mode here.
    const data = await pdfWith({ producer: 'ReportLab PDF Library' });
    const result = provenance((await inspectFile(data)).findings);
    expect(result.attributed).toBe(false);
    expect(result.tools.join(' ')).toContain('ReportLab');
  });

  it('reports nothing rather than "no AI" when the fields are empty', async () => {
    // The distinction the banner exists to make: silence is not a verdict.
    const result = provenance((await inspectFile(encode('du texte ordinaire'), 'a.txt')).findings);
    expect(result.attributed).toBe(false);
    expect(result.tools).toEqual([]);
  });

  it('survives redaction being run first', async () => {
    const data = await pdfWith({ creator: 'Claude', producer: 'ReportLab PDF Library' });
    const cleaned = (await redactFile(data)).data!;
    expect(provenance((await inspectFile(cleaned)).findings).attributed).toBe(false);
  });
});

describe('a program that does not sign its work', () => {
  /**
   * Built from a real report: nothing in it named a tool, and it was
   * unmistakably assembled by a library. Everything saying so was structural.
   */
  const generated = () =>
    zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      '_rels/.rels': strToU8('<Relationships/>'),
      // Word always fills app.xml. A part created for the schema and left empty
      // is not something an Office application produces.
      'docProps/app.xml': strToU8(
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>',
      ),
      'docProps/core.xml': strToU8(
        '<cp:coreProperties xmlns:cp="c" xmlns:dc="d" xmlns:dcterms="t">' +
          '<dc:creator>Pôle Cybersécurité</dc:creator>' +
          // Milliseconds and a Z: Date.prototype.toISOString(), not Word.
          '<dcterms:created>2026-07-29T15:22:28.698Z</dcterms:created>' +
          '<dcterms:modified>2026-07-29T15:22:28.698Z</dcterms:modified></cp:coreProperties>',
      ),
      'word/settings.xml': strToU8('<w:settings><w:zoom w:percent="100"/></w:settings>'),
      'word/document.xml': strToU8('<w:document><w:body/></w:document>'),
      // Forty hex characters is a SHA-1. Word writes image1.png.
      'word/media/0ff0d056683aaeb3942f10192d9fe3e499bd2a98.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });

  const authored = () =>
    zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      '_rels/.rels': strToU8('<Relationships/>'),
      'docProps/app.xml': strToU8(
        '<Properties><Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion>' +
          '<Words>1204</Words><DocSecurity>0</DocSecurity></Properties>',
      ),
      'docProps/core.xml': strToU8(
        '<cp:coreProperties xmlns:cp="c" xmlns:dc="d" xmlns:dcterms="t"><dc:creator>Lotfi Zakaria</dc:creator>' +
          '<dcterms:created>2026-07-29T15:22:00Z</dcterms:created>' +
          '<dcterms:modified>2026-08-01T09:14:00Z</dcterms:modified></cp:coreProperties>',
      ),
      'word/settings.xml': strToU8('<w:settings><w:rsids><w:rsid w:val="00B23C5D"/></w:rsids></w:settings>'),
      'word/document.xml': strToU8('<w:document><w:body/></w:document>'),
      'word/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });

  it('recognises the shape a library leaves, with no tool named anywhere', async () => {
    const findings = (await inspectFile(generated())).findings;
    const structural = findings.find(
      (f) => f.label === 'Assembled by a program, not typed in a word processor',
    );
    expect(structural?.confidence).toBe('confirmed');
    expect(structural?.value).toContain('app.xml is present but empty');
    expect(structural?.value).toContain('milliseconds');
    expect(structural?.value).toContain('content hash');

    const result = provenance(findings);
    expect(result.machineAssembled).toBe(true);
    // Structure says a program built the container. It does not say which, and
    // it does not say a model wrote the words.
    expect(result.attributed).toBe(false);
    expect(result.tools).toEqual([]);
  });

  it('does not accuse a document a person actually saved from Word', async () => {
    const findings = (await inspectFile(authored())).findings;
    expect(provenance(findings).machineAssembled).toBe(false);
    // Word names itself, so the summary can answer with the plainest field there is.
    expect(provenance(findings).tools).toContain('Microsoft Office Word');
  });

  it('needs more than one signal before it says anything', async () => {
    // Milliseconds alone — a converter might do that and nothing else.
    const single = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      '_rels/.rels': strToU8('<Relationships/>'),
      'docProps/core.xml': strToU8(
        '<cp:coreProperties xmlns:cp="c" xmlns:dcterms="t">' +
          '<dcterms:created>2026-07-29T15:22:28.698Z</dcterms:created>' +
          '<dcterms:modified>2026-08-01T09:14:00Z</dcterms:modified></cp:coreProperties>',
      ),
      'word/document.xml': strToU8('<w:document><w:body/></w:document>'),
    });
    expect(provenance((await inspectFile(single)).findings).machineAssembled).toBe(false);
  });
});

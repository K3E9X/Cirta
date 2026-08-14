import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  inspectFile,
  scanText,
  redactOoxml,
  redactPdf,
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

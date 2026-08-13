import { describe, it, expect } from 'vitest';
import { inspectFile, scanText, CONFIDENCE_ORDER, type Finding } from '../src/core/index.js';
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

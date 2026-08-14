import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { findSourceTypes, describeSourceType } from '../src/core/sourcetype.js';
import { inspectFile, redactFile, provenance, readManifest } from '../src/core/index.js';

/**
 * `digitalSourceType` is IPTC's vocabulary for how a file was made, and it is
 * what C2PA carries and what the EU AI Act's transparency rules are drafted
 * around. It is the one field where a generator states outright that a model
 * produced the content — a declaration rather than an inference.
 */
describe('digitalSourceType', () => {
  const value = (findings: { label: string; value: string }[]) =>
    findings.find((f) => f.label === 'How the file says it was made')?.value;

  it('reads the generative terms as a declaration', () => {
    for (const term of ['trainedAlgorithmicMedia', 'compositeWithTrainedAlgorithmicMedia']) {
      const findings = describeSourceType(
        `http://cv.iptc.org/newscodes/digitalsourcetype/${term}`,
        'test',
      );
      expect(findings[0]?.confidence).toBe('confirmed');
      expect(findings[0]?.value).toContain(term);
      expect(provenance(findings).declared).toBe(true);
    }
  });

  it('does not call an algorithm a trained model', () => {
    // A gradient is algorithmicMedia. So is a fractal. Neither involved a
    // model, and flattening the two is the failure this vocabulary prevents.
    const findings = describeSourceType('algorithmicMedia', 'test');
    expect(findings[0]?.value).toContain('does not by itself mean a trained model');
    expect(provenance(findings).declared).toBe(false);
  });

  it('reads a camera capture as the explicit denial that it is', () => {
    const findings = describeSourceType('digitalCapture', 'test');
    expect(findings[0]?.confidence).toBe('informational');
    expect(provenance(findings).declared).toBe(false);
  });

  it('ignores a term that is not in the vocabulary', () => {
    expect(describeSourceType('http://example.com/whatever/inventedTerm', 'x')).toEqual([]);
    expect(findSourceTypes('digitalSourceType: nonsense', 'x')).toEqual([]);
  });

  it('finds it in an XMP packet, namespaced or bare', () => {
    const xmp =
      '<Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType>';
    expect(value(findSourceTypes(xmp, 'x'))).toContain('trainedAlgorithmicMedia');
    expect(value(findSourceTypes('"digitalSourceType": "trainedAlgorithmicMedia"', 'x'))).toContain(
      'trainedAlgorithmicMedia',
    );
  });

  it('says nothing about ordinary text', () => {
    expect(findSourceTypes('un rapport trimestriel ordinaire', 'x')).toEqual([]);
  });
});

describe('the C2PA actions assertion', () => {
  it('reads what the action declares, not just that there is one', async () => {
    // The fixture is a signed gradient from c2pa-rs: it declares
    // algorithmicMedia, which is exactly the case a keyword search would
    // wrongly report as AI.
    const signed = new Uint8Array(await readFile('test/fixtures/signed.jpg'));
    const findings = (await inspectFile(signed)).findings;

    const declaration = findings.find((f) => f.label === 'How the file says it was made');
    expect(declaration?.value).toContain('algorithmicMedia');
    expect(findings.find((f) => f.label === 'Software credited by the action')?.value).toContain(
      'Make Test Images',
    );
    // Declared, but not as generative — the distinction the vocabulary exists for.
    expect(provenance(findings).declared).toBe(false);
  });

  it('surfaces the source type on the manifest summary', async () => {
    const signed = new Uint8Array(await readFile('test/fixtures/signed.jpg'));
    let segment: Uint8Array | undefined;
    for (let i = 2; i + 4 < signed.length; ) {
      if (signed[i] !== 0xff) { i++; continue; }
      const marker = signed[i + 1]!;
      const length = (signed[i + 2]! << 8) | signed[i + 3]!;
      if (marker === 0xeb) { segment = signed.subarray(i + 4, i + 2 + length); break; }
      if (marker === 0xda) break;
      i += 2 + length;
    }
    expect(readManifest(segment!)?.sourceType).toContain('algorithmicMedia');
  });
});

describe('a file that declares itself generated', () => {
  const declaring = async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]).drawText('rapport');
    const xmp =
      "<?xpacket begin=''?><x:xmpmeta xmlns:x='adobe:ns:meta/'><Iptc4xmpExt:DigitalSourceType>" +
      'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' +
      "</Iptc4xmpExt:DigitalSourceType></x:xmpmeta><?xpacket end='w'?>";
    pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(pdf.context.flateStream(xmp)));
    return pdf.save();
  };

  it('says so in one line rather than leaving it in the table', async () => {
    const result = provenance((await inspectFile(await declaring())).findings);
    expect(result.declared).toBe(true);
    expect(result.attributed).toBe(true);
  });

  it('loses the declaration when cleaned', async () => {
    const cleaned = (await redactFile(await declaring())).data!;
    expect(provenance((await inspectFile(cleaned)).findings).declared).toBe(false);
  });
});

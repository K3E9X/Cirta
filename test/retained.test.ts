import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFString, PDFArray } from 'pdf-lib';
import { zipSync, strToU8 } from 'fflate';
import { inspectFile, toSarif, ruleId, meetsThreshold, provenance } from '../src/core/index.js';

const labels = async (data: Uint8Array) => (await inspectFile(data)).findings.map((f) => f.label);
const find = async (data: Uint8Array, label: string) =>
  (await inspectFile(data)).findings.find((f) => f.label === label);

/* ------------------------------------------------- PDF earlier revisions -- */

/** Build a genuine incremental save: body, then a new xref carrying /Prev. */
async function incrementalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 200]).drawText('Salaire de Lotfi Zakaria : 58000 EUR', { x: 20, y: 150, size: 12 });
  const first = Buffer.from(await doc.save({ useObjectStreams: false }));

  const at = first.lastIndexOf(Buffer.from('startxref'));
  const prev = parseInt(first.subarray(at + 9, at + 30).toString('latin1').trim(), 10);
  const added = Buffer.from('\n20 0 obj\n<< /Type /Annot /Subtype /Square >>\nendobj\n', 'latin1');
  const body = Buffer.concat([first, added]);
  const tail = Buffer.from(
    `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 21 /Root 1 0 R /Prev ${prev} >>\n` +
      `startxref\n${body.length}\n%%EOF\n`,
    'latin1',
  );
  return new Uint8Array(Buffer.concat([body, tail]));
}

describe('earlier PDF revisions', () => {
  it('reports that previous versions are still in the file', async () => {
    const found = await find(await incrementalPdf(), 'Earlier versions of this document are still in the file');
    expect(found?.confidence).toBe('confirmed');
    expect(found?.value).toContain('2 revisions');
  });

  it('says nothing about a file saved once', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]).drawText('contenu');
    const single = await doc.save({ useObjectStreams: false });
    expect(await labels(single)).not.toContain('Earlier versions of this document are still in the file');
  });

  it('the earlier text really is recoverable, which is why this is confirmed', async () => {
    // The claim the finding makes, checked rather than asserted. Page text is
    // stored hex-encoded inside a Flate stream, so both layers come off first.
    const { inflateSync } = await import('node:zlib');
    const data = Buffer.from(await incrementalPdf());
    const open = data.indexOf(Buffer.from('stream'));
    let start = open + 6;
    while (data[start] === 13 || data[start] === 10) start++;
    const body = inflateSync(data.subarray(start, data.indexOf(Buffer.from('endstream'), start)));
    const text = [...body.toString('latin1').matchAll(/<([0-9A-Fa-f\s]+)>/g)]
      .map((m) => Buffer.from(m[1]!.replace(/\s/g, ''), 'hex').toString('latin1'))
      .join('');
    expect(text).toContain('Lotfi Zakaria');
  });
});

/* ---------------------------------------------------- PDF annotations ---- */

describe('PDF annotation authors', () => {
  it('names everyone who left a comment', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    const annot = (who: string) => {
      const dict = doc.context.obj({});
      dict.set(PDFName.of('Type'), PDFName.of('Annot'));
      dict.set(PDFName.of('Subtype'), PDFName.of('Text'));
      dict.set(PDFName.of('T'), PDFString.of(who));
      return doc.context.register(dict);
    };
    const list = PDFArray.withContext(doc.context);
    list.push(annot('Lotfi Zakaria'));
    list.push(annot('Service Juridique'));
    page.node.set(PDFName.of('Annots'), list);

    const found = await find(await doc.save({ useObjectStreams: false }), 'Annotation authors');
    expect(found?.value).toContain('Lotfi Zakaria');
    expect(found?.value).toContain('Service Juridique');
  });
});

/* ------------------------------------------------- OOXML kept content ---- */

describe('content an Office package keeps after the document stops showing it', () => {
  it('reports a cropped picture, whose original pixels are still there', async () => {
    const deck = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      '_rels/.rels': strToU8('<Relationships/>'),
      'ppt/presentation.xml': strToU8('<p:presentation/>'),
      'ppt/slides/slide1.xml': strToU8('<p:sld><a:srcRect l="48000" t="0" r="0" b="12000"/></p:sld>'),
    });
    expect(await labels(deck)).toContain('Cropped pictures keep their original image');
  });

  it('does not report a crop rectangle that crops nothing', async () => {
    const deck = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      '_rels/.rels': strToU8('<Relationships/>'),
      'ppt/presentation.xml': strToU8('<p:presentation/>'),
      'ppt/slides/slide1.xml': strToU8('<p:sld><a:srcRect l="0" t="0" r="0" b="0"/></p:sld>'),
    });
    expect(await labels(deck)).not.toContain('Cropped pictures keep their original image');
  });

  it('reports a pivot cache, which keeps its own copy of the source rows', async () => {
    const book = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      '_rels/.rels': strToU8('<Relationships/>'),
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="A" sheetId="1"/></sheets></workbook>'),
      'xl/pivotCache/pivotCacheRecords1.xml': strToU8('<pivotCacheRecords><r><s v="Lotfi"/></r></pivotCacheRecords>'),
    });
    expect(await labels(book)).toContain('Pivot table cache holds a copy of the source rows');
  });

  it('reports hidden sheets and calls out veryHidden, which Excel cannot unhide', async () => {
    const book = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      '_rels/.rels': strToU8('<Relationships/>'),
      'xl/workbook.xml': strToU8(
        '<workbook><sheets><sheet name="Synthese" sheetId="1"/>' +
          '<sheet name="Salaires" sheetId="2" state="veryHidden"/></sheets></workbook>',
      ),
    });
    const found = await find(book, 'Hidden worksheets');
    expect(found?.value).toContain('Salaires (veryHidden)');
    expect(found?.value).toContain('cannot be unhidden');
  });

  it('says nothing about a workbook whose sheets are all visible', async () => {
    const book = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      '_rels/.rels': strToU8('<Relationships/>'),
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Donnees" sheetId="1"/></sheets></workbook>'),
    });
    expect(await labels(book)).not.toContain('Hidden worksheets');
  });
});

/* --------------------------------------------- image generation chunks --- */

/** A PNG carrying one text chunk, built byte by byte so the layout is real. */
function pngWithText(keyword: string, text: string): Uint8Array {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const payload = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(payload));
    return Buffer.concat([len, payload, sum]);
  };
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', Buffer.concat([Buffer.alloc(8), Buffer.from([8, 6, 0, 0, 0])])),
      chunk('tEXt', Buffer.from(`${keyword}\0${text}`, 'latin1')),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

describe('generated images', () => {
  it('names the tool and says the prompt travels with the file', async () => {
    const png = pngWithText('parameters', 'portrait de Lotfi Zakaria\nSteps: 30, Seed: 4021993');
    const found = await find(png, 'Image generation settings, including the prompt');
    expect(found?.confidence).toBe('confirmed');
    expect(found?.value).toContain('AUTOMATIC1111');
    expect(found?.value).toContain('portrait de Lotfi Zakaria');
  });

  it('answers the headline question instead of contradicting the table', async () => {
    // The banner used to say "nothing names a tool" directly above a row
    // naming Stable Diffusion, because images never went through fingerprint().
    const result = provenance((await inspectFile(pngWithText('parameters', 'un chat'))).findings);
    expect(result.attributed).toBe(true);
    expect(result.tools.join(' ')).toContain('Stable Diffusion');
  });

  it('recognises a ComfyUI workflow', async () => {
    const png = pngWithText('workflow', '{"nodes":[{"type":"CheckpointLoader"}]}');
    expect((await find(png, 'Image generation settings, including the prompt'))?.value).toContain('ComfyUI');
  });

  it('leaves an ordinary text chunk as an ordinary text chunk', async () => {
    const png = pngWithText('Comment', 'Scanned on a flatbed');
    // [C7] Reported as the field it is, with its value, rather than as a chunk size.
    expect(await labels(png)).toContain('Comment');
    expect(await labels(png)).not.toContain('Image generation settings, including the prompt');
  });
});

/* ------------------------------------------------------------- SARIF ----- */

describe('SARIF output', () => {
  const entries = [
    {
      file: 'rapport.pdf',
      result: {
        format: 'pdf' as const,
        notes: [],
        findings: [
          { kind: 'identity' as const, confidence: 'confirmed' as const, location: '/Info /Author', label: 'Author', value: 'Lotfi' },
          { kind: 'timestamp' as const, confidence: 'probable' as const, location: '/Info', label: 'Created', value: 'D:2026' },
        ],
      },
    },
    { file: 'casse.pdf', error: 'Unrecognised file.' },
  ];

  it('produces a 2.1.0 log naming the tool', () => {
    const log = toSarif(entries) as { version: string; runs: Array<{ tool: { driver: { name: string } } }> };
    expect(log.version).toBe('2.1.0');
    expect(log.runs[0]?.tool.driver.name).toBe('Cirta');
  });

  it('maps confidence onto the three SARIF levels', () => {
    const log = toSarif(entries) as { runs: Array<{ results: Array<{ level: string }> }> };
    const levels = log.runs[0]!.results.map((r) => r.level);
    expect(levels).toContain('error'); // confirmed
    expect(levels).toContain('warning'); // probable, and the unreadable file
  });

  it('keeps an unreadable file as a result rather than dropping it', () => {
    const log = toSarif(entries) as { runs: Array<{ results: Array<{ ruleId: string }> }> };
    expect(log.runs[0]!.results.map((r) => r.ruleId)).toContain('cirta/unreadable');
  });

  it('gives each label a stable rule id', () => {
    expect(ruleId('Annotation authors')).toBe('cirta/annotation-authors');
    expect(ruleId('Hostname written entirely in a lookalike alphabet'))
      .toBe('cirta/hostname-written-entirely-in-a-lookalike-alphabet');
  });

  it('declares every rule its results use', () => {
    const log = toSarif(entries) as {
      runs: Array<{ tool: { driver: { rules: Array<{ id: string }> } }; results: Array<{ ruleId: string }> }>;
    };
    const declared = new Set(log.runs[0]!.tool.driver.rules.map((r) => r.id));
    for (const result of log.runs[0]!.results) expect(declared.has(result.ruleId)).toBe(true);
  });
});

describe('the exit-code gate', () => {
  const withLevel = (confidence: 'confirmed' | 'probable' | 'informational') => [
    {
      file: 'x',
      result: {
        format: 'pdf' as const,
        notes: [],
        findings: [{ kind: 'identity' as const, confidence, location: 'l', label: 'L', value: 'v' }],
      },
    },
  ];

  it('fires at the level asked for', () => {
    expect(meetsThreshold(withLevel('confirmed'), 'confirmed')).toBe(true);
  });

  it('fires for anything more serious than the level asked for', () => {
    expect(meetsThreshold(withLevel('confirmed'), 'probable')).toBe(true);
  });

  it('stays quiet below it', () => {
    expect(meetsThreshold(withLevel('probable'), 'confirmed')).toBe(false);
    expect(meetsThreshold(withLevel('informational'), 'probable')).toBe(false);
  });
});

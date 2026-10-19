#!/usr/bin/env node
/**
 * [F-P2 2.8] The performance budget: for each format, a file of about 50 MB
 * carrying what the cleaner removes, inspected then cleaned, each format in
 * a process of its own so its peak memory is its own. Time and peak resident
 * memory are compared with perf-budget.json; one over budget fails the run.
 *
 *   node scripts/perf.mjs              every format, against the budget
 *   node scripts/perf.mjs --only pdf   one format
 *   node scripts/perf.mjs --size 10    files of 10 MB instead of 50
 *
 * The budgets are for the CI's Linux runner and are deliberately loose: they
 * are there to catch a change that makes a format ten times slower or
 * swallow memory, not to grade a machine. Run after `npm run build`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const BUDGET = JSON.parse(readFileSync(new URL('../perf-budget.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const MB = 1024 * 1024;
const size = Number(option('--size') ?? 50) * MB;

/* ------------------------------------------------------------- inputs -- */

const enc = new TextEncoder();
const zwsp = '​';

/** Random bytes that never contain a JPEG marker (0xFF), so they read as one entropy-coded scan. */
function entropy(n) {
  const bytes = randomBytes(n);
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0xff) bytes[i] = 0xfe;
  return bytes;
}

function jpeg(n) {
  const segment = (marker, body) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x3b, 0x01, 2, 0, 7, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0, ...enc.encode('Marie\0\0')]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])),
    segment(0xfe, Buffer.from('made by Marie Martin')),
    Buffer.from([0xff, 0xc0, 0, 11, 8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
    Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0]),
    entropy(n),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function png(n) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.from([0, 0, 1, 0, 0, 0, 1, 0, 8, 2, 0, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('Author\0Marie Martin', 'latin1')),
    chunk('IDAT', randomBytes(n)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Prose with an invisible character every so often: what the text pass reads end to end. */
function prose(n) {
  const line = `Le rapport trimestriel présente les résultats du service, ligne après ligne.${zwsp} `;
  return line.repeat(Math.ceil(n / Buffer.byteLength(line))).slice(0, n);
}

async function build(format) {
  const { zipSync, strToU8 } = await import('fflate');
  const core = '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Marie Martin</dc:creator></cp:coreProperties>';
  switch (format) {
    case 'pdf': {
      const { PDFDocument, PDFName } = await import('pdf-lib');
      const doc = await PDFDocument.create();
      doc.setAuthor('Marie Martin');
      const page = doc.addPage([200, 200]);
      page.drawText('Rapport');
      // A picture-sized stream the parser has to walk past.
      const image = doc.context.register(doc.context.stream(randomBytes(size), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceGray' }));
      page.node.setXObject(PDFName.of('Im1'), image);
      return { name: 'big.pdf', data: await doc.save({ useObjectStreams: false }) };
    }
    case 'docx':
      return {
        name: 'big.docx',
        data: zipSync(
          {
            '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
            'docProps/core.xml': strToU8(core),
            'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Rapport${zwsp}</w:t></w:r></w:p></w:body></w:document>`),
            'word/media/image1.jpeg': [jpeg(size), { level: 0 }],
          },
          { level: 6 },
        ),
      };
    case 'odt':
      return {
        name: 'big.odt',
        data: zipSync({
          mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
          'meta.xml': strToU8('<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><office:meta><meta:initial-creator>Marie Martin</meta:initial-creator></office:meta></office:document-meta>'),
          'content.xml': strToU8('<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"/>'),
          'Pictures/big.jpg': [jpeg(size), { level: 0 }],
        }),
      };
    case 'epub':
      return {
        name: 'big.epub',
        data: zipSync({
          mimetype: [strToU8('application/epub+zip'), { level: 0 }],
          'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>'),
          'c.opf': strToU8('<package unique-identifier="u"><metadata><dc:identifier id="u">urn:uuid:1</dc:identifier><dc:creator>Marie Martin</dc:creator></metadata></package>'),
          'p.xhtml': strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${prose(Math.round(size / 12))}</p></body></html>`),
          'big.jpg': [jpeg(size), { level: 0 }],
        }),
      };
    case 'jpeg':
      return { name: 'big.jpg', data: jpeg(size) };
    case 'png':
      return { name: 'big.png', data: png(size) };
    case 'zip': {
      const members = {};
      for (let i = 0; i < 10; i++) members[`dossier/note-${i}.txt`] = [strToU8(prose(size / 10)), { level: 0 }];
      return { name: 'big.zip', data: zipSync(members) };
    }
    case 'text':
      return { name: 'big.txt', data: enc.encode(prose(size)) };
    case 'html':
      return { name: 'big.html', data: enc.encode(`<!doctype html><html><head><meta name="author" content="Marie Martin"></head><body>${`<p>${prose(2000)}</p>\n`.repeat(Math.ceil(size / 2000))}</body></html>`) };
    default:
      throw new Error(`unknown format ${format}`);
  }
}

/* ------------------------------------------------------------ measure -- */

/** In the child: build, inspect, clean, and print what it took. */
async function one(format) {
  const { inspectFile, redactFile } = await import('../dist/core/index.js');
  const { name, data } = await build(format);
  let started = performance.now();
  const report = await inspectFile(data, name);
  const inspectMs = performance.now() - started;
  started = performance.now();
  const cleaned = await redactFile(data, name);
  const redactMs = performance.now() - started;
  const left = cleaned.kept?.filter((f) => f.confidence === 'confirmed') ?? [];
  console.log(
    JSON.stringify({
      format,
      bytes: data.length,
      inspectMs: Math.round(inspectMs),
      redactMs: Math.round(redactMs),
      rssMB: Math.round(process.resourceUsage().maxRSS / 1024),
      found: report.findings.some((f) => f.confidence === 'confirmed'),
      cleaned: left.length === 0,
    }),
  );
}

if (option('--child')) {
  await one(option('--child'));
  process.exit(0);
}

const formats = option('--only') ? [option('--only')] : Object.keys(BUDGET.formats);
const rows = [];
let failures = 0;
console.log(`performance budget — ${process.platform}, node ${process.versions.node}, files of ${Math.round(size / MB)} MB`);
for (const format of formats) {
  const out = execFileSync(process.execPath, ['--max-old-space-size=4096', fileURLToPath(import.meta.url), '--child', format, '--size', String(size / MB)], { encoding: 'utf8', maxBuffer: 16 * MB });
  const result = JSON.parse(out.trim().split('\n').pop());
  const budget = BUDGET.formats[format];
  // A smaller file than the budget's is held to a proportionally smaller time,
  // with a floor for what any run costs whatever its size.
  const scale = Math.max(size / (BUDGET.sizeMB * MB), 0.25);
  const over = [];
  if (result.inspectMs > budget.inspectMs * scale) over.push(`inspect ${result.inspectMs} ms > ${Math.round(budget.inspectMs * scale)}`);
  if (result.redactMs > budget.redactMs * scale) over.push(`clean ${result.redactMs} ms > ${Math.round(budget.redactMs * scale)}`);
  if (result.rssMB > budget.rssMB) over.push(`memory ${result.rssMB} MB > ${budget.rssMB}`);
  if (!result.found) over.push('the metadata it carries was not found');
  if (!result.cleaned) over.push('something confirmed survived the clean');
  if (over.length) failures++;
  rows.push({ ...result, budget, over });
  console.log(
    `  ${over.length ? 'FAIL' : 'ok  '}  ${format.padEnd(5)} ${String(Math.round(result.bytes / MB)).padStart(3)} MB  inspect ${String(result.inspectMs).padStart(6)} ms  clean ${String(result.redactMs).padStart(6)} ms  peak ${String(result.rssMB).padStart(5)} MB${over.length ? `  — ${over.join('; ')}` : ''}`,
  );
}

// On GitHub Actions, the same table on the run's summary page.
if (process.env.GITHUB_STEP_SUMMARY) {
  const table = [
    '### Performance budget',
    '',
    `Files of ${Math.round(size / MB)} MB, ${process.platform}, Node ${process.versions.node}.`,
    '',
    '| Format | Size | Inspect | Budget | Clean | Budget | Peak memory | Budget | |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.format} | ${Math.round(r.bytes / MB)} MB | ${r.inspectMs} ms | ${r.budget.inspectMs} ms | ${r.redactMs} ms | ${r.budget.redactMs} ms | ${r.rssMB} MB | ${r.budget.rssMB} MB | ${r.over.length ? `❌ ${r.over.join('; ')}` : '✅'} |`),
    '',
  ].join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
}

if (failures) {
  console.error(`\n${failures} format(s) over budget`);
  process.exit(1);
}
console.log('\nevery format within budget');

#!/usr/bin/env node
/**
 * A mutation fuzzer for the parsers that consume untrusted files.
 *
 * Cirta is pointed at documents from people the user has no reason to trust —
 * an attachment, a download, a file recovered from a compromised share. That is
 * precisely the threat model in which a parser bug stops being a crash and
 * becomes a vulnerability, and nine modules here take hostile bytes: PDF, ZIP,
 * OOXML, ODF, CBOR, JUMBF, image containers, XML and punycode.
 *
 * Dependency-free on purpose. A coverage-guided fuzzer (Jazzer.js, libFuzzer)
 * finds deeper bugs and should follow, but it needs an install, a toolchain and
 * a long campaign. This runs anywhere `npm test` runs, in seconds, which is the
 * difference between a fuzzer that is part of the build and one nobody starts.
 *
 * What counts as a bug is the part worth stating, and the first run got it
 * wrong: it reported 231 findings, almost all of them fflate correctly refusing
 * to inflate a corrupted ZIP. A parser rejecting malformed input is the code
 * working. Findings are therefore graded:
 *
 *   crash    An exception the module never meant to raise — TypeError,
 *            RangeError, a stack overflow. An assumption about the bytes was
 *            wrong, and that is where memory-safety-adjacent bugs live in JS.
 *   hang     A length field driving a loop that does not end.
 *   leak     A rejection that escaped as a raw Error instead of one of the
 *            documented types. Not dangerous, but it means a caller cannot
 *            tell "this file is not supported" from "this tool broke".
 *            Reported once per kind with a count, not once per input.
 *
 * Every run is seeded, so a finding reproduces exactly: the seed and the input
 * are both written next to the report.
 *
 *   node scripts/fuzz.mjs                 # a short run, what CI does
 *   node scripts/fuzz.mjs --iterations 50000 --seed 42
 *   node scripts/fuzz.mjs --target pdf
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { zipSync, strToU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';

import {
  inspectFile,
  inspectImage,
  inspectPlainText,
  decodeCbor,
  parseBoxes,
  decodePunycode,
  findDeceptiveUrls,
  scanText,
  cleanText,
  inspectMarkup,
  UnsupportedFormatError,
  BinaryInputError,
  ArchiveTooLargeError,
} from '../dist/core/index.js';

/* ----------------------------------------------------------------- rng -- */

/** xorshift32: tiny, deterministic, and good enough to drive mutations. */
function rng(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

/* --------------------------------------------------------------- seeds -- */

/**
 * Valid files to mutate. A fuzzer starting from random bytes spends its whole
 * budget being rejected by the format sniffer; starting from something real
 * means the mutations land inside the parser, which is where the bugs are.
 */
async function buildCorpus() {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]).drawText('contenu');
  pdf.setAuthor('Lotfi Zakaria');

  const docx = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    '_rels/.rels': strToU8('<Relationships/>'),
    'docProps/core.xml': strToU8(
      '<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:creator>Lotfi</dc:creator></cp:coreProperties>',
    ),
    'word/document.xml': strToU8('<w:document><w:body><w:p><w:t>texte</w:t></w:p></w:body></w:document>'),
    'word/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });

  const odt = zipSync({
    mimetype: strToU8('application/vnd.oasis.opendocument.text'),
    'meta.xml': strToU8(
      '<office:document-meta xmlns:office="o" xmlns:meta="m" xmlns:dc="d"><office:meta>' +
        '<meta:generator>LibreOffice/24.8</meta:generator></office:meta></office:document-meta>',
    ),
    'content.xml': strToU8('<office:document-content/>'),
  });

  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
    0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0c, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00,
    0xff, 0xd9,
  ]);

  const text = new TextEncoder().encode(
    'From: Lotfi <a@b.fr>\nSubject: Test\nDate: Thu, 14 Aug 2026 09:12:00 +0200\n\n' +
      'Bonjour, voir https://xn--80ak6aa92e.com/login et ​‌ un texte.\n',
  );

  const markup = new TextEncoder().encode(
    '<!doctype html><html><head><meta name="generator" content="x"></head><body><p>a</p></body></html>',
  );

  return [
    { name: 'pdf', bytes: await pdf.save({ useObjectStreams: false }) },
    { name: 'docx', bytes: docx },
    { name: 'odt', bytes: odt },
    { name: 'png', bytes: png },
    { name: 'jpeg', bytes: jpeg },
    { name: 'text', bytes: text },
    { name: 'markup', bytes: markup },
  ];
}

/* ------------------------------------------------------------ mutators -- */

/** Values that break length arithmetic: zero, the signed and unsigned edges. */
const EDGES = [0, 1, 0x7f, 0x80, 0xff, 0x7fff, 0xffff, 0x7fffffff, 0xffffffff];

const MUTATORS = [
  function bitFlip(bytes, random) {
    const out = bytes.slice();
    const i = Math.floor(random() * out.length);
    out[i] ^= 1 << Math.floor(random() * 8);
    return out;
  },
  function byteSet(bytes, random) {
    const out = bytes.slice();
    out[Math.floor(random() * out.length)] = Math.floor(random() * 256);
    return out;
  },
  function truncate(bytes, random) {
    // Half of all real-world malformed files are simply cut short.
    return bytes.slice(0, Math.floor(random() * bytes.length));
  },
  function duplicate(bytes, random) {
    const start = Math.floor(random() * bytes.length);
    const len = Math.min(bytes.length - start, Math.floor(random() * 64) + 1);
    const chunk = bytes.subarray(start, start + len);
    const out = new Uint8Array(bytes.length + len);
    out.set(bytes.subarray(0, start), 0);
    out.set(chunk, start);
    out.set(bytes.subarray(start), start + len);
    return out;
  },
  function writeEdgeInteger(bytes, random) {
    // Corrupt a length field rather than a random byte: a parser that trusts a
    // declared size is the classic way to reach an allocation or a loop bound.
    const out = bytes.slice();
    const at = Math.floor(random() * Math.max(1, out.length - 4));
    const value = EDGES[Math.floor(random() * EDGES.length)];
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    if (at + 4 <= out.length) {
      if (random() < 0.5) view.setUint32(at, value >>> 0);
      else view.setUint32(at, value >>> 0, true);
    }
    return out;
  },
  function splice(bytes, random, corpus) {
    const other = corpus[Math.floor(random() * corpus.length)].bytes;
    const cut = Math.floor(random() * bytes.length);
    const out = new Uint8Array(cut + other.length);
    out.set(bytes.subarray(0, cut), 0);
    out.set(other, cut);
    return out;
  },
  function repeat(bytes, random) {
    // Deep nesting and long runs: what finds unbounded recursion.
    const unit = bytes.subarray(0, Math.min(bytes.length, 8));
    const times = 200 + Math.floor(random() * 2000);
    const out = new Uint8Array(unit.length * times);
    for (let i = 0; i < times; i++) out.set(unit, i * unit.length);
    return out;
  },
];

/* ------------------------------------------------------------- targets -- */

const EXPECTED = [UnsupportedFormatError, BinaryInputError, ArchiveTooLargeError];
const decode = (bytes) => new TextDecoder('utf-8', { fatal: false }).decode(bytes);

/**
 * Every entry point that takes bytes or a string a stranger controls. The whole
 * dispatch is fuzzed too, because the bugs that matter most are the ones in how
 * the pieces hand data to each other.
 */
const TARGETS = {
  inspect: async (bytes) => void (await inspectFile(bytes)),
  // [R8.2] Through the public entry point, told the format: a refusal there is
  // the documented UnsupportedFormatError, while a TypeError or RangeError in
  // the parser still comes through as the crash it is. Called directly, the
  // parsers' own words — pdf-lib's « Failed to parse », fflate's « invalid zip
  // data » — showed as escaped errors on every run.
  pdf: async (bytes) => void (await inspectFile(bytes, 'fuzz.pdf')),
  zip: async (bytes) => void (await inspectFile(bytes, 'fuzz.zip')),
  image: (bytes) => void inspectImage(bytes, 'fuzz'),
  cbor: (bytes) => void decodeCbor(bytes),
  jumbf: (bytes) => void parseBoxes(bytes),
  text: (bytes) => {
    const s = decode(bytes);
    scanText(s);
    cleanText(s);
    inspectPlainText(s);
  },
  url: (bytes) => {
    const s = decode(bytes);
    findDeceptiveUrls(s);
    for (const label of s.split(/[\s./]+/).slice(0, 40)) decodePunycode(label);
  },
  markup: (bytes) => {
    const s = decode(bytes);
    for (const format of ['html', 'svg', 'markdown']) inspectMarkup(s, format);
  },
};

/* ---------------------------------------------------------------- main -- */

/**
 * How seriously to take an escaped exception.
 *
 * A TypeError or a RangeError means the module indexed, sliced or allocated on
 * a value it had not checked — the class of bug worth fixing. Anything else is
 * a rejection that simply did not wear one of the documented error types.
 */
function grade(error) {
  const name = error?.constructor?.name ?? '';
  const message = String(error?.message ?? '');
  if (/Maximum call stack|out of memory|Array buffer allocation failed/i.test(message)) return 'crash';
  if (name === 'TypeError' || name === 'RangeError' || name === 'ReferenceError') return 'crash';
  return 'leak';
}

/** Collapse the numbers out of a message so one bug is one line. */
const normalise = (message) => message.replace(/-?\d+/g, 'N').slice(0, 90);

function parseArgs(argv) {
  const args = { iterations: 2000, seed: Date.now() & 0x7fffffff, target: undefined, timeout: 5000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--iterations') args.iterations = Number(argv[++i]);
    else if (argv[i] === '--seed') args.seed = Number(argv[++i]);
    else if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--timeout') args.timeout = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const random = rng(args.seed);
  const corpus = await buildCorpus();
  const names = args.target ? [args.target] : Object.keys(TARGETS);

  for (const name of names) {
    if (!TARGETS[name]) {
      console.error(`unknown target: ${name}. Known: ${Object.keys(TARGETS).join(', ')}`);
      return 2;
    }
  }

  const findings = [];
  let executed = 0;

  console.log(`fuzz: seed ${args.seed}, ${args.iterations} iterations per target, targets: ${names.join(', ')}`);

  for (const name of names) {
    const target = TARGETS[name];
    for (let i = 0; i < args.iterations; i++) {
      const seed = corpus[Math.floor(random() * corpus.length)];
      const mutate = MUTATORS[Math.floor(random() * MUTATORS.length)];
      let input;
      try {
        input = mutate(seed.bytes, random, corpus);
      } catch {
        continue; // a mutator given a zero-length seed; not a finding
      }
      if (input.length === 0) continue;
      executed++;

      const started = Date.now();
      // pdf-lib narrates malformed objects straight to the console, which is
      // exactly what a fuzzer produces by the thousand. Silenced per execution
      // so the report is the findings and nothing else.
      const quiet = [console.log, console.warn, console.error];
      console.log = console.warn = console.error = () => {};
      try {
        await target(input);
      } catch (error) {
        [console.log, console.warn, console.error] = quiet;
        if (EXPECTED.some((type) => error instanceof type)) continue; // refusing is correct
        findings.push({
          target: name,
          grade: grade(error),
          kind: error?.constructor?.name ?? 'throw',
          message: String(error?.message ?? error).slice(0, 160),
          input,
          from: seed.name,
          mutator: mutate.name,
        });
        continue;
      } finally {
        [console.log, console.warn, console.error] = quiet;
      }
      const elapsed = Date.now() - started;
      if (elapsed > args.timeout) {
        findings.push({ target: name, grade: 'hang', kind: 'slow', message: `${elapsed} ms`, input, from: seed.name, mutator: mutate.name });
      }
    }
  }

  console.log(`fuzz: ${executed} inputs executed`);

  // One line per distinct bug, not per input that triggered it.
  const groups = new Map();
  for (const finding of findings) {
    const key = `${finding.grade}\u0000${finding.target}\u0000${finding.kind}\u0000${normalise(finding.message)}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { ...finding, count: 1 });
  }

  const crashes = [...groups.values()].filter((g) => g.grade === 'crash' || g.grade === 'hang');
  const leaks = [...groups.values()].filter((g) => g.grade === 'leak');

  if (leaks.length) {
    const total = leaks.reduce((n, g) => n + g.count, 0);
    console.log(`\nfuzz: ${leaks.length} rejection kind(s) escaped as a raw Error (${total} inputs).`);
    console.log('      Not crashes — the parsers refused corrupt input — but the type is not one');
    console.log('      a caller can match on. Shown for the record:');
    for (const g of leaks.slice(0, 12)) {
      console.log(`        ${g.target.padEnd(8)} ${g.kind.padEnd(12)} ${normalise(g.message)} (x${g.count})`);
    }
    if (leaks.length > 12) console.log(`        … and ${leaks.length - 12} more`);
  }

  if (crashes.length === 0) {
    console.log('\nfuzz: no crash and no hang.');
    return 0;
  }

  const dir = join(process.cwd(), 'fuzz-findings');
  mkdirSync(dir, { recursive: true });
  console.log(`\nfuzz: ${crashes.length} crash/hang finding(s):`);
  let written = 0;
  for (const finding of crashes) {
    const file = join(dir, `${finding.target}-${finding.kind}-${written}.bin`);
    writeFileSync(file, finding.input);
    console.log(
      `  ${finding.grade.padEnd(6)} ${finding.target.padEnd(8)} ${finding.kind.padEnd(14)} ${finding.message}\n` +
        `         from ${finding.from} via ${finding.mutator} (x${finding.count}), input at ${file}`,
    );
    written++;
  }
  console.log(`\nfuzz: reproduce with --seed ${args.seed}.`);
  return 1;
}

process.exit(await main());

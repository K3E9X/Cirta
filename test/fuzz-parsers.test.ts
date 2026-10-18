import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { ArchiveTooLargeError, BinaryInputError, inspectFile, redactFile, UnsupportedFormatError } from '../src/core/index.js';
import { readCfb } from '../src/core/cfb.js';
import { readPropertySet } from '../src/core/ole-props.js';
import { pptStorages } from '../src/core/legacy-office.js';
import { parseMail } from '../src/core/mime.js';
import { parseExif } from '../src/core/exif.js';
import { inspectImage } from '../src/core/image.js';
import { parseRules } from '../src/core/rules.js';
import { piiFindings } from '../src/core/pii.js';
import { vbaProject } from './helpers/cfb.js';
import { compObj, legacyOffice, ole10Native, outlookMessage, pptOleRecord, propertySet, SUMMARY, DOC_SUMMARY } from './helpers/ole.js';
import { jpegWith, tiff } from './helpers/tiff.js';
import { mutations, ITERATIONS, SEED } from './helpers/mutate.js';

/*
 * [F-2.8] The parsers added since the fuzzer was written, fuzzed the same
 * way: a valid seed, mutated — bits, lengths set to edge values, offsets aimed
 * back at earlier positions, truncation, splices. A refusal is the parser
 * working; a TypeError, a RangeError or a stack overflow is a bug, and so is
 * an input that takes seconds. FUZZ_ITERATIONS and FUZZ_SEED run a longer
 * campaign; a failure names the seed and the iteration that reproduce it.
 */

const REFUSALS = [UnsupportedFormatError, BinaryInputError, ArchiveTooLargeError];
const LIMIT_MS = 3000;

async function fuzz(name: string, corpus: Uint8Array[], target: (input: Uint8Array) => unknown): Promise<void> {
  for (const { input, iteration } of mutations(corpus)) {
    const started = Date.now();
    try {
      await target(input);
    } catch (error) {
      if (REFUSALS.some((type) => error instanceof type)) continue;
      throw new Error(`${name}: seed ${SEED}, iteration ${iteration}: ${(error as Error)?.constructor?.name}: ${(error as Error)?.message}`);
    }
    const elapsed = Date.now() - started;
    if (elapsed > LIMIT_MS) throw new Error(`${name}: seed ${SEED}, iteration ${iteration}: ${elapsed} ms`);
  }
}

const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(bytes);
const TIMEOUT = Math.max(60_000, ITERATIONS * 400);

describe('[F-2.8] fuzzing the new parsers', () => {
  const project = vbaProject({ ThisDocument: 'Sub AutoOpen()\r\nShell "cmd"\r\nEnd Sub' });
  const doc = legacyOffice('doc', {
    summary: { 4: 'Jeanne', 7: 'C:\\Users\\j\\a.dot', 10: { seconds: 60 }, 12: { time: new Date(0) } },
    docSummary: { 15: 'Cabinet' },
    custom: { Client: 'X' },
    streams: {
      'ObjectPool/_1/\x01CompObj': compObj('Package', 'Package'),
      'ObjectPool/_1/\x01Ole10Native': ole10Native('a.txt', 'C:\\a.txt', 'C:\\t\\a.txt', strToU8('hello')),
    },
  });
  const ppt = legacyOffice('ppt', { summary: { 4: 'J' }, streams: { 'PowerPoint Document': pptOleRecord(project) } });
  const msg = outlookMessage({
    strings: { 0x0037: 'Objet', 0x0c1a: 'Jeanne', 0x0c1f: '/O=A/CN=J', 0x007d: 'From: a@b.fr\r\nX-Mailer: x\r\nMessage-ID: <a@b>\r\n\r\n', 0x1000: 'Bonjour' },
    times: { 0x0039: new Date(0) },
    recipients: [{ name: 'M', address: 'm@b.fr', type: 3 }],
    attachments: [{ name: 'a.txt', data: strToU8('x') }, { name: 'Fwd', message: { strings: { 0x0c1a: 'P' } } }],
  });

  it('compound files: the reader, then .doc, .ppt and .msg end to end', async () => {
    await fuzz('cfb', [doc, ppt, msg, project], (input) => {
      const cfb = readCfb(input);
      for (const entry of cfb?.entries ?? []) if (entry.type === 'stream') cfb!.read(entry.path);
    });
    await fuzz('legacy', [doc, ppt, project], (input) => inspectFile(input, 'a.doc'));
    await fuzz('msg', [msg], (input) => inspectFile(input, 'a.msg'));
  }, TIMEOUT * 3);

  it('OLE property sets and PowerPoint records', async () => {
    const set = propertySet(
      { fmtid: SUMMARY, props: { 2: 'Titre', 4: { wide: 'Jeanne' }, 10: { seconds: 60 }, 12: { time: new Date(0) }, 14: { i4: 3 } } },
      { fmtid: DOC_SUMMARY, props: { 15: 'Cabinet' }, names: { 2: 'Client' } },
    );
    await fuzz('property set', [set], (input) => readPropertySet(input));
    await fuzz('ppt records', [pptOleRecord(project)], (input) => pptStorages(input));
  }, TIMEOUT * 2);

  it('MIME mail', async () => {
    const mail = strToU8(
      'From: Jeanne <j@b.fr>\r\nTo: m@b.fr\r\nSubject: =?utf-8?B?w6l0w6k=?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n' +
        '--b\r\nContent-Type: multipart/alternative; boundary="c"\r\n\r\n--c\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nBonjour=E2=80=8B\r\n' +
        '--c\r\nContent-Type: text/html\r\n\r\n<p hidden>x</p>\r\n--c--\r\n' +
        '--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="a.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nAAEC\r\n--b--\r\n',
    );
    await fuzz('mime', [mail], (input) => parseMail(input));
    await fuzz('eml', [mail], (input) => inspectFile(input, 'a.eml'));
  }, TIMEOUT * 2);

  it('Exif IFDs, an offset loop among them', async () => {
    const block = tiff([{ tag: 0x010f, ascii: 'Pomme' }, { tag: 0x013b, ascii: 'J' }], [{ tag: 0x9003, ascii: '2026:01:01 00:00:00' }], [{ tag: 1, ascii: 'N' }, { tag: 2, rational: [[48, 1], [0, 1], [0, 1]] }]);
    // IFD0 whose Exif pointer and next-IFD pointer both point back at itself.
    const loop = new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x69, 0x87, 4, 0, 1, 0, 0, 0, 8, 0, 0, 0, 8, 0, 0, 0]);
    const started = Date.now();
    expect(() => parseExif(loop)).not.toThrow();
    expect(() => inspectImage(jpegWith(loop), 'x')).not.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
    await fuzz('exif', [block, loop], (input) => parseExif(input));
    await fuzz('jpeg exif', [jpegWith(block), jpegWith(loop)], (input) => inspectImage(input, 'x'));
  }, TIMEOUT * 2);

  it('the rules parser and the personal-data scan', async () => {
    const yaml = strToU8(
      'rules:\n  - id: projet\n    label: "Nom de projet"\n    level: confirmed\n    words: [Orion, "Bleu Ciel"]\n  - id: dossier\n    label: Dossier\n    pattern: "D-[0-9]{4}"\n    flags: i\n',
    );
    const json = strToU8(JSON.stringify({ rules: [{ id: 'a', label: 'A', words: ['x'] }] }));
    await fuzz('rules', [yaml, json], (input) => {
      try {
        parseRules(decode(input));
      } catch (error) {
        // An unreadable rules file is refused with a RulesError, an UnsupportedFormatError.
        if (!(error instanceof UnsupportedFormatError)) throw error;
      }
    });
    const text = strToU8('IBAN FR76 3000 6000 0112 3456 7890 189, carte 4970 1012 3456 7893, j.dupont@exemple.fr, +33 6 12 34 56 78, 192.168.1.10, fe80::1, 00:1A:2B:3C:4D:5E, AB-123-CD');
    await fuzz('pii', [text], (input) => piiFindings(decode(input), 'x'));
  }, TIMEOUT * 2);

  it('notebooks, inspected and cleaned', async () => {
    const nb = strToU8(
      JSON.stringify({
        cells: [
          { cell_type: 'code', metadata: { execution: { 'iopub.execute_input': '2026-01-01T00:00:00Z' } }, source: ['x'], outputs: [{ output_type: 'stream', text: ['/home/j/a\n'] }, { output_type: 'error', ename: 'E', evalue: 'v', traceback: ['C:\\Users\\j\\a.py'] }, { output_type: 'display_data', data: { 'image/png': 'iVBORw0KGgo=' } }] },
        ],
        metadata: { kernelspec: { name: 'python3' }, authors: [{ name: 'J' }] },
        nbformat: 4,
        nbformat_minor: 5,
      }),
    );
    await fuzz('notebook', [nb], async (input) => {
      await inspectFile(input, 'a.ipynb');
      await redactFile(input, 'a.ipynb', { clearOutputs: true });
    });
  }, TIMEOUT * 2);
});

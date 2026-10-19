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
import { gifWithMetadata, heifWithMetadata, tiffWithMetadata, webpWithMetadata } from './helpers/pictures.js';
import { vsdx } from './helpers/visio.js';
import { apev2, bytes, id3Text, id3v1, id3v2, lameFrame, mpegFrame, movie } from './helpers/media.js';
import { zipSync } from 'fflate';

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

  it('[F-P2 2.2] RTF, EPUB, Visio and the other picture formats, inspected and cleaned', async () => {
    const both = (name: string) => async (input: Uint8Array) => {
      await inspectFile(input, name);
      await redactFile(input, name, { stripActive: true });
    };
    const rtf = strToU8(
      '{\\rtf1\\ansi\\ansicpg1252{\\info{\\author J\\\'e9}{\\creatim\\yr2024\\mo1\\dy1}\\edmins5}{\\*\\generator W}{\\*\\rsidtbl \\rsid1}{\\*\\revtbl {Unknown;}{J;}}' +
        '\\pard \\insrsid1 T\\u8364?{\\object\\objemb{\\*\\objclass Package}{\\*\\objdata 01050000020000000800000050616e6b61676500000000000000000000000000}{\\result x}}' +
        '{\\pict\\jpegblip ffd8ffe1000c4578696600004949ffd9}{\\field{\\*\\fldinst {HYPERLINK "file:///C:/a"}}{\\fldrslt {a}}}\\bin3 {}x\\par}',
    );
    await fuzz('rtf', [rtf], both('a.rtf'));
    const epub = zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>'),
      'c.opf': strToU8('<package unique-identifier="u"><metadata><dc:identifier id="u">urn:uuid:1</dc:identifier><dc:creator id="a">J</dc:creator><meta refines="#a" property="role">aut</meta></metadata></package>'),
      'p.xhtml': strToU8('<html><body>x</body></html>'),
    });
    await fuzz('epub', [epub], both('a.epub'));
    await fuzz('vsdx', [vsdx({ creator: 'J', comments: [{ name: 'M', initials: 'M' }], connection: 'Password=x', hyperlink: 'file:///C:/a' })], both('a.vsdx'));
    await fuzz('latex', [strToU8('\\documentclass{article}\n% c\n\\author{J\\thanks{x}}\\input{/home/j/a}\n\\verb|%|\\url{a%b}\n\\begin{comment}\nx\n\\end{comment}\n\\begin{document}\\end{document}\n')], both('a.tex'));
    await fuzz('ics', [strToU8('BEGIN:VCALENDAR\r\nPRODID:x\r\nBEGIN:VEVENT\r\nUID:1@h.l\r\nORGANIZER;CN=J:mailto:j@a\r\nDESCRIPTION:https://z.us/j?pwd=1\r\n  suite\r\nX-A:b\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')], both('a.ics'));
    await fuzz('vcf', [strToU8('BEGIN:VCARD\r\nFN:J\r\nREV:1\r\nPHOTO;ENCODING=b:/9j/4QAMRXhpZgAASUkqAP/Z\r\nEND:VCARD\r\n')], both('a.vcf'));
    await fuzz('pictures', [await webpWithMetadata(), await gifWithMetadata(), tiffWithMetadata(), heifWithMetadata('heic'), heifWithMetadata('avif')], both('a'));
  }, TIMEOUT * 6);

  it('[F-P3 2.2] video and audio, inspected and cleaned', async () => {
    const both = (name: string) => async (input: Uint8Array) => {
      await inspectFile(input, name);
      await redactFile(input, name);
    };
    const phone = { 'com.apple.quicktime.location.ISO6709': '+48.8584+002.2945/', 'com.apple.quicktime.model': 'iPhone' };
    const mp3 = bytes(id3v2(3, [['TPE1', id3Text('M')], ['COMM', bytes([1], 'fra', [0xff, 0xfe, 0, 0], [0x41, 0])], ['APIC', bytes([0], 'image/jpeg', [0], [3], [0], [0xff, 0xd8, 0xff, 0xd9])]]), lameFrame(), mpegFrame(), apev2({ Artist: 'M' }), id3v1('T', 'A', 'B', '2024', 'C'));
    await fuzz('mp3', [mp3, bytes(id3v2(4, [['TPE1', id3Text('M', 3)]]), mpegFrame(), mpegFrame()), bytes(id3v2(2, [['TP1', id3Text('M')]]), mpegFrame())], both('a.mp3'));
    await fuzz('mp4', [movie({ gps: '+45.7640+004.8357/', encoder: 'Lavf', apple: phone, xmpCreator: 'M' }), movie({ brand: 'qt  ' }), movie({ brand: 'M4A ' })], both('a.mp4'));
  }, TIMEOUT * 4);
});

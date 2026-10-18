import { describe, expect, it } from 'vitest';
import { inspectFile, redactFile, type Finding } from '../src/core/index.js';
import { makeDocx, makeJpeg, makePdf, makePng, makePptx, makeRichPptx, makeXlsx } from './fixtures.js';
import { jpegWith, png, tEXt, tiff } from './helpers/tiff.js';

/*
 * [C10.1] A mail came back "0 fields removed" with X-Mailer and User-Agent
 * gone. Whatever a redactor believes it removed, the number announced must be
 * the number of findings that inspection saw before and no longer sees after.
 * One rule, checked on every format the cleaner writes.
 */

const enc = (text: string) => new TextEncoder().encode(text);
const key = (f: Finding) => `${f.label}\u0000${f.location}`;

const MAIL =
  'From: Jean Dupont <jean@example.com>\r\nTo: marie@example.com\r\nSubject: Relance\r\n' +
  'Date: Mon, 12 Oct 2026 09:00:00 +0200\r\nMessage-ID: <CAF1234@mail.gmail.com>\r\n' +
  'X-Mailer: Microsoft Outlook 16.0\r\nUser-Agent: Mozilla/5.0 (Macintosh)\r\nMIME-Version: 1.0\r\n' +
  'Content-Type: text/plain; charset=utf-8\r\n\r\nBonjour Marie,\r\n\r\nJe reviens vers vous.​\r\n';

const FILES: Array<[string, () => Uint8Array | Promise<Uint8Array>]> = [
  ['report.pdf', makePdf],
  ['deck.pptx', makePptx],
  ['rich.pptx', makeRichPptx],
  ['letter.docx', makeDocx],
  ['sheet.xlsx', makeXlsx],
  ['photo.jpg', () => makeJpeg()],
  ['camera.jpg', () => jpegWith(tiff([{ tag: 0x013b, ascii: 'Jean Dupont' }, { tag: 0x0131, ascii: 'GIMP' }]))],
  ['image.png', makePng],
  ['author.png', () => png(tEXt('Author', 'Jean Dupont'), tEXt('Software', 'GIMP 2.10'))],
  ['mail.eml', () => enc(MAIL)],
  ['page.html', () => enc('<html><head><meta name="generator" content="ChatGPT"><meta name="author" content="Jean"></head><body><p>Bon​jour</p></body></html>')],
  ['notes.md', () => enc('---\nauthor: Jean Dupont\ngenerator: claude-code\n---\n\n# Notes\n\nBon​jour.\n')],
  ['draft.txt', () => enc('Bon​jour⁣ Marie.\n')],
];

describe('[C10.1] the count announced is the count that went', () => {
  for (const [name, make] of FILES) {
    it(name, async () => {
      const data = await make();
      const before = (await inspectFile(data, name)).findings;
      const result = await redactFile(data, name);
      const after = new Set((await inspectFile(result.data!, name)).findings.map(key));
      const gone = before.filter((f) => !after.has(key(f)));
      expect(result.removed.map(key).sort()).toEqual(gone.map(key).sort());
    });
  }
});

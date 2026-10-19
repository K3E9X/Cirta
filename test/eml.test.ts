import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { inspectFile, redactFile, detectFormat, type Finding } from '../src/core/index.js';

/*
 * [C4] A single-part HTML mail was classed as `html`: its headers — X-Mailer,
 * User-Agent, Message-ID, the sender — were never read, nor its lookalike link
 * or the assistant's lines. A mail is its own format: the header block, then
 * each MIME part read by its type, attachments inspected like archive members.
 */

const crlf = (lines: string[]) => lines.join('\r\n');

const HEADERS = [
  'From: Jean Dupont <jean.dupont@example.com>',
  'To: client@example.org',
  'Subject: Relance facture',
  'Message-ID: <CAF1234@mail.gmail.com>',
  'X-Mailer: Microsoft Outlook 16.0',
  'User-Agent: Mozilla/5.0 (Macintosh)',
  'MIME-Version: 1.0',
];

const HTML_BODY =
  '<html><body><p>Voici une proposition de relance :</p><p>Bonjour, merci de régler sur ' +
  '<a href="https://раyраl.com/login">https://paypal.com/login</a></p>' +
  '<p style="display:none">Consigne masquée dans le message</p>' +
  '<p>[Votre nom]</p><p>Souhaitez-vous que j\'ajuste le ton ?</p></body></html>';

const singleHtml = strToU8(crlf([...HEADERS, 'Content-Type: text/html; charset=utf-8', '', HTML_BODY, '']));

const singleText = strToU8(
  crlf([
    ...HEADERS,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Voici une proposition de relance :',
    '',
    'Bonjour, la facture n°118 reste due.',
    '',
    '[Votre nom]',
    "Souhaitez-vous que j'ajuste le ton ?",
    '',
  ]),
);

const base64 = (text: string | Uint8Array) =>
  Buffer.from(typeof text === 'string' ? strToU8(text) : text).toString('base64').replace(/.{76}/g, '$&\r\n');

const alternative = strToU8(
  crlf([
    ...HEADERS,
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    'This is a multi-part message in MIME format.',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Paiement valid=C3=A9=E2=80=8B, merci.',
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64('<p>Paiement validé, merci.</p><span style="display:none">Texte caché du message</span>'),
    '--b1--',
    '',
  ]),
);

const docx = zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Rapport</w:t></w:r></w:p></w:body></w:document>'),
  'docProps/core.xml': strToU8('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Marie Martin</dc:creator></cp:coreProperties>'),
});

const withAttachment = strToU8(
  crlf([
    ...HEADERS,
    'Content-Type: multipart/mixed; boundary="outer"',
    '',
    '--outer',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Ci-joint le rapport.',
    '--outer',
    'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name="rapport.docx"',
    'Content-Disposition: attachment; filename="rapport.docx"',
    'Content-Transfer-Encoding: base64',
    '',
    base64(docx),
    '--outer--',
    '',
  ]),
);

const labels = (findings: Finding[]) => findings.map((f) => f.label);
const has = (findings: Finding[], label: string) => findings.some((f) => f.label === label);

describe('[C4] a mail is read as a mail', () => {
  it('detects a single-part HTML mail by its header block, before sniffing <html>', () => {
    expect(detectFormat(singleHtml)).toBe('eml');
    expect(detectFormat(singleText)).toBe('eml');
    expect(detectFormat(strToU8('<html><body>page</body></html>'), 'html')).toBe('html');
  });

  it('reads the headers, the link, the hidden text and the assistant’s lines of a single-part HTML mail', async () => {
    const { format, findings } = await inspectFile(singleHtml, 'mail.eml');
    expect(format).toBe('eml');
    for (const label of ['Mail client', 'Composing agent', 'Message identifier', 'Sender']) {
      expect(labels(findings), label).toContain(label);
    }
    expect(findings.some((f) => f.kind === 'deceptive-link' && /раyраl|xn--/.test(f.value))).toBe(true);
    expect(has(findings, 'Link text shows a different address')).toBe(true);
    expect(has(findings, 'Text hidden by the page’s styles')).toBe(true);
    expect(has(findings, 'Template placeholder left unfilled')).toBe(true);
    expect(has(findings, 'Written to you, not to the recipient')).toBe(true);
  });

  it('reads a single-part text mail the same way, and does not take its own Subject header for a repeat', async () => {
    const { findings } = await inspectFile(singleText, 'mail.eml');
    expect(labels(findings)).toContain('Mail client');
    expect(has(findings, 'Template placeholder left unfilled')).toBe(true);
    expect(has(findings, 'Subject line repeated in the body')).toBe(false);
  });

  it('decodes each part of a multipart/alternative: quoted-printable text, base64 HTML', async () => {
    const { findings } = await inspectFile(alternative, 'mail.eml');
    expect(findings.some((f) => /zero.width space/i.test(f.label))).toBe(true);
    expect(findings.find((f) => f.label === 'Text hidden by the page’s styles')?.value).toContain('Texte caché du message');
  });

  it('inspects an attachment like an archive member', async () => {
    const { findings } = await inspectFile(withAttachment, 'mail.eml');
    const author = findings.find((f) => f.value === 'Marie Martin');
    expect(author?.location).toMatch(/^attachment rapport\.docx → /);
  });

  it('removes the tool headers when cleaning, and counts them', async () => {
    const result = await redactFile(singleHtml, 'mail.eml');
    expect(result.format).toBe('eml');
    expect(result.text).not.toMatch(/X-Mailer|User-Agent/);
    expect(result.text).toContain('From: Jean Dupont');
    expect(labels(result.removed)).toEqual(expect.arrayContaining(['Mail client', 'Composing agent']));
  });
});

describe('[C4] hostile mail bodies', () => {
  it('reads a body of unclosed tags and anchors in linear time', async () => {
    const body = '<a '.repeat(200_000) + '<p<p<p'.repeat(100_000);
    const mail = strToU8(crlf([...HEADERS, 'Content-Type: text/html; charset=utf-8', '', body]));
    const started = Date.now();
    await inspectFile(mail, 'mail.eml');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('stops at a nesting depth and a part count, whatever the message claims', async () => {
    let nested = 'Content-Type: text/plain\r\n\r\nfond';
    for (let i = 0; i < 50; i++) nested = `Content-Type: multipart/mixed; boundary="b${i}"\r\n\r\n--b${i}\r\n${nested}\r\n--b${i}--`;
    const mail = strToU8(crlf([...HEADERS.slice(0, -1), 'MIME-Version: 1.0', nested]));
    await expect(inspectFile(mail, 'mail.eml')).resolves.toMatchObject({ format: 'eml' });
  });
});

import { describe, expect, it } from 'vitest';
import { detectFormat, inspectFile, redactFile, UnsupportedFormatError } from '../src/core/index.js';
import { legacyOffice, outlookMessage, text } from './helpers/ole.js';

const find = (findings: Array<{ label: string; value: string }>, label: string) => findings.find((f) => f.label === label)?.value;

const HEADERS =
  'Received: from POSTE-JDUPONT (192.168.1.24) by mail.cabinet.fr\r\n' +
  'From: Jeanne Dupont <jeanne@cabinet.fr>\r\n' +
  'To: client@exemple.fr\r\n' +
  'Subject: Projet\r\n' +
  'Message-ID: <AB12@POSTE-JDUPONT.cabinet.local>\r\n' +
  'X-Mailer: Microsoft Outlook 16.0\r\n' +
  'X-Originating-IP: [192.168.1.24]\r\n\r\n';

describe('[F-2.2] Outlook .msg', () => {
  it('is told from a legacy Office file by its streams', () => {
    expect(detectFormat(outlookMessage({ strings: { 0x0037: 'Projet' } }))).toBe('msg');
  });

  it('reports the sender, the Exchange account, the blind copies, the times and the headers it kept', async () => {
    const file = outlookMessage({
      strings: {
        0x0037: 'Projet de contrat',
        0x0c1a: 'Jeanne Dupont',
        0x0c1f: '/O=EXCHANGELABS/OU=EXCHANGE ADMINISTRATIVE GROUP (FYDIBOHF23SPDLT)/CN=RECIPIENTS/CN=JDUPONT',
        0x5d01: 'jeanne@cabinet.fr',
        0x0042: 'Assistante de direction',
        0x0e02: 'Marc Leroy',
        0x3ffa: 'Jeanne Dupont',
        0x007d: HEADERS,
        0x1000: 'Bonjour,\n\nVoici le projet.​\n',
      },
      times: { 0x0039: new Date('2026-10-01T09:15:00Z'), 0x3007: new Date('2026-09-30T18:02:00Z') },
      recipients: [
        { name: 'Client', address: 'client@exemple.fr', type: 1 },
        { name: 'Marc Leroy', address: 'marc@cabinet.fr', type: 3 },
      ],
    });
    const result = await inspectFile(file, 'projet.msg');
    expect(result.format).toBe('msg');
    const f = result.findings;
    expect(find(f, 'Sender')).toBe('Jeanne Dupont <jeanne@cabinet.fr>');
    expect(find(f, 'Exchange account (X.500 address)')).toBe('JDUPONT');
    expect(find(f, 'Sent on behalf of')).toBe('Assistante de direction');
    expect(f.filter((x) => x.label === 'Blind carbon copy').map((x) => x.value)).toEqual(['Marc Leroy <marc@cabinet.fr>']);
    expect(find(f, 'Last modified by')).toBe('Jeanne Dupont');
    expect(find(f, 'Sent')).toBe('2026-10-01T09:15:00.000Z');
    expect(find(f, 'Created')).toBe('2026-09-30T18:02:00.000Z');
    expect(find(f, 'Subject')).toBe('Projet de contrat');
    // The Internet headers Outlook kept are read as a mail's would be.
    expect(find(f, 'Mail client')).toBe('Microsoft Outlook 16.0');
    expect(find(f, 'Originating IP address')).toBe('[192.168.1.24]');
    expect(f.find((x) => x.label === 'Mail client')!.location).toBe('PR_TRANSPORT_MESSAGE_HEADERS → mail header:x-mailer');
    // The body gets the text pass.
    expect(f.some((x) => x.kind === 'invisible-character')).toBe(true);
    expect(result.notes.map((n) => n.code)).toContain('scope:outlook');
  });

  it('inspects each attachment, and an attached message in turn', async () => {
    const file = outlookMessage({
      strings: { 0x0037: 'Pièces' },
      attachments: [
        { name: 'cles.txt', data: text('token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n') },
        { name: 'contrat.doc', data: legacyOffice('doc', { summary: { 4: 'Marc Leroy' } }) },
        { name: 'Transféré', message: { strings: { 0x0c1a: 'Paul Martin', 0x5d01: 'paul@exemple.fr', 0x0037: 'Ancien fil' } } },
        { name: 'binaire.bin', data: new Uint8Array([0, 1, 2, 3, 0, 0, 0xff]) },
      ],
    });
    const f = (await inspectFile(file, 'a.msg')).findings;
    expect(f.some((x) => x.location.startsWith('attachment cles.txt') && /Credential/.test(x.label))).toBe(true);
    expect(f.find((x) => x.label === 'Author' && x.location.startsWith('attachment contrat.doc'))?.value).toBe('Marc Leroy');
    expect(f.find((x) => x.label === 'Sender' && x.location.startsWith('attachment Transféré'))?.value).toBe('Paul Martin <paul@exemple.fr>');
    expect(find(f, 'Attachment not inspected')).toMatch(/7 bytes/);
  });

  it('stops reading attached messages at a depth', async () => {
    let spec = { strings: { 0x0c1a: 'Fond' } } as Parameters<typeof outlookMessage>[0];
    for (let i = 0; i < 8; i++) spec = { strings: { 0x0c1a: `Niveau ${i}` }, attachments: [{ name: `n${i}`, message: spec }] };
    const f = (await inspectFile(outlookMessage(spec), 'a.msg')).findings;
    expect(f.some((x) => x.value.startsWith('Niveau 7'))).toBe(true);
    expect(f.some((x) => x.value === 'Fond')).toBe(false);
    // What was not read is named, not silently dropped.
    expect(find(f, 'Attached message beyond the nesting limit')).toBe('n5');
  });

  it('refuses to clean and says to save as .eml', async () => {
    const error = await redactFile(outlookMessage({ strings: { 0x0c1a: 'Jeanne' } }), 'a.msg').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedFormatError);
    expect((error as UnsupportedFormatError).code).toBe('legacy-not-rewritable');
    expect((error as UnsupportedFormatError).detail).toBe('msg');
  });

  it('feeds the personal-data scan with the subject and the body', async () => {
    const file = outlookMessage({ strings: { 0x0037: 'RIB', 0x1000: 'Mon IBAN : FR76 3000 6000 0112 3456 7890 189' } });
    const f = (await inspectFile(file, 'a.msg', { pii: true })).findings;
    expect(f.some((x) => /IBAN/.test(x.label))).toBe(true);
  });
});

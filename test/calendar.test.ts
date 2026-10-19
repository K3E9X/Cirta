import { describe, expect, it } from 'vitest';
import { detectFormat, inspectFile, redactFile } from '../src/core/index.js';
import { makeJpeg } from './fixtures.js';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const crlf = (lines: string[]) => lines.join('\r\n') + '\r\n';
const values = (findings: Array<{ label: string; value: string }>, label: string) => findings.filter((f) => f.label === label).map((f) => f.value);

const ICS = crlf([
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
  'X-WR-CALNAME:Agenda de Jeanne',
  'BEGIN:VEVENT',
  'UID:20240305T102000Z-4521@poste-jdupont.cabinet.local',
  'DTSTAMP:20240305T102000Z',
  'CREATED:20240301T080000Z',
  'LAST-MODIFIED:20240304T170000Z',
  'DTSTART:20240310T090000Z',
  'SUMMARY:Point budg​et',
  'ORGANIZER;CN=Jeanne Dupont:mailto:jeanne.dupont@cabinet.fr',
  'ATTENDEE;CN=Marc Leroy;ROLE=REQ-PARTICIPANT:mailto:marc.leroy@client.fr',
  'ATTENDEE;CN=Paul Durand:mailto:paul@client.fr',
  'DESCRIPTION:Rejoindre : https://cabinet.zoom.us/j/123456789?pwd=Q2FiaW5ldA',
  '  et le dossier https://www.google.com/url?q=https://evil.example/x',
  'GEO:48.8566;2.3522',
  'X-MS-OLK-SENDER;CN=Jeanne Dupont:mailto:jeanne.dupont@cabinet.fr',
  'X-MICROSOFT-CDO-OWNERAPPTID:-1932467718',
  'END:VEVENT',
  'END:VCALENDAR',
]);

const photo = Buffer.from(makeJpeg()).toString('base64');
const VCF = crlf([
  'BEGIN:VCARD',
  'VERSION:3.0',
  'PRODID:-//Apple Inc.//macOS 14.3//EN',
  'N:Dupont;Jeanne;;;',
  'FN:Jeanne Dupont',
  'EMAIL;type=INTERNET:jeanne.dupont@cabinet.fr',
  'NOTE:Rencontrée chez le client\\, à rappeler',
  'REV:2024-03-05T10:20:00Z',
  'UID:3F2504E0-4F89-11D3-9A0C-0305E82C3301',
  'X-ABUID:3F2504E0-4F89-11D3-9A0C-0305E82C3301:ABPerson',
  `PHOTO;ENCODING=b;TYPE=JPEG:${photo.slice(0, 40)}`,
  ...photo.slice(40).match(/.{1,74}/g)!.map((line) => ` ${line}`),
  'END:VCARD',
]);

describe('[F-P2 2.2] iCalendar (.ics)', () => {
  it('is told by its first line', () => {
    expect(detectFormat(enc(ICS))).toBe('ics');
  });

  it('reports the producer, the organiser and attendees, the event’s host, vendor properties, dates, a meeting passcode and links', async () => {
    const f = (await inspectFile(enc(ICS), 'invitation.ics')).findings;
    expect(values(f, 'Producing application')).toEqual(['-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN']);
    expect(values(f, 'Organizer')).toEqual(['Jeanne Dupont <jeanne.dupont@cabinet.fr>']);
    expect(values(f, 'Attendees')).toEqual(['Marc Leroy <marc.leroy@client.fr>, Paul Durand <paul@client.fr>']);
    expect(values(f, 'Event identifier naming a host')).toEqual(['20240305T102000Z-4521@poste-jdupont.cabinet.local']);
    expect(values(f, 'Vendor property')).toEqual(['X-WR-CALNAME: Agenda de Jeanne', 'X-MS-OLK-SENDER: mailto:jeanne.dupont@cabinet.fr', 'X-MICROSOFT-CDO-OWNERAPPTID: -1932467718']);
    expect(values(f, 'Created')).toEqual(['20240301T080000Z']);
    expect(values(f, 'Modified')).toEqual(['20240304T170000Z']);
    expect(values(f, 'Meeting link carrying its passcode')).toEqual(['cabinet.zoom.us/j/123456789 (pwd)']);
    expect(values(f, 'Link through an open redirector')).toEqual(['www.google.com → https://evil.example/x']);
    expect(values(f, 'GPS position')).toEqual(['48.8566, 2.3522']);
    expect(f.some((x) => x.kind === 'invisible-character')).toBe(true);
  });

  it('removes vendor properties and optional dates, keeps what the invitation needs, CRLF and folding intact', async () => {
    const result = await redactFile(enc(ICS), 'invitation.ics');
    const text = dec(result.data!);
    expect(text).not.toMatch(/X-WR-CALNAME|X-MS-OLK|X-MICROSOFT|CREATED|LAST-MODIFIED/);
    for (const kept of ['PRODID:', 'UID:', 'DTSTAMP:', 'ORGANIZER;', 'ATTENDEE;', 'SUMMARY:Point budget', '  et le dossier']) expect(text).toContain(kept);
    expect(text.split('\r\n').every((line, i, all) => i === all.length - 1 || !line.includes('\n'))).toBe(true);
    expect((result.kept ?? []).map((x) => x.label)).toEqual(expect.arrayContaining(['Organizer', 'Attendees', 'Meeting link carrying its passcode']));
  });
});

describe('[F-P2 2.2] vCard (.vcf)', () => {
  it('is told by its first line', () => {
    expect(detectFormat(enc(VCF))).toBe('vcf');
  });

  it('reports the producer, revision date, identifiers, vendor properties, the note and the photo’s own metadata', async () => {
    const f = (await inspectFile(enc(VCF), 'contact.vcf')).findings;
    expect(values(f, 'Producing application')).toEqual(['-//Apple Inc.//macOS 14.3//EN']);
    expect(values(f, 'Modified')).toEqual(['2024-03-05T10:20:00Z']);
    expect(values(f, 'Contact identifier')).toEqual(['3F2504E0-4F89-11D3-9A0C-0305E82C3301']);
    expect(values(f, 'Vendor property')).toEqual(['X-ABUID: 3F2504E0-4F89-11D3-9A0C-0305E82C3301:ABPerson']);
    expect(values(f, 'Note')).toEqual(['Rencontrée chez le client, à rappeler']);
    expect(f.some((x) => x.location === 'VCARD 1:PHOTO' && x.label === 'Exif with GPS coordinates')).toBe(true);
  });

  it('removes the producer, revision, identifiers and vendor properties, and strips the photo', async () => {
    const result = await redactFile(enc(VCF), 'contact.vcf');
    const text = dec(result.data!);
    expect(text).not.toMatch(/PRODID|REV:|UID:|X-ABUID/);
    for (const kept of ['FN:Jeanne Dupont', 'EMAIL;type=INTERNET:jeanne.dupont@cabinet.fr', 'NOTE:', 'PHOTO;ENCODING=b;TYPE=JPEG:']) expect(text).toContain(kept);
    const after = (await inspectFile(result.data!, 'contact.vcf')).findings;
    expect(after.some((x) => x.location === 'VCARD 1:PHOTO')).toBe(false);
    expect(text.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });
});

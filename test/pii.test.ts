import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { inspectFile, redactFile, type Finding } from '../src/core/index.js';
import { piiFindings } from '../src/core/pii.js';

/*
 * [F-2.3] Personal data in the body, on request: what a document says about
 * people, accounts and machines. Checksums where they exist, so a random
 * number is not an IBAN; values always masked in the report.
 */

const values = (findings: Finding[], label: string) => findings.filter((f) => f.label === label).map((f) => f.value);

describe('[F-2.3] personal data detectors', () => {
  it('finds an IBAN only when its checksum holds, and masks it', () => {
    const found = piiFindings('Virement sur FR76 3000 6000 0112 3456 7890 189, pas sur FR76 3000 6000 0112 3456 7890 188.', 'body');
    expect(values(found, 'IBAN')).toEqual(['FR76 •••• •••• •••• •••• •••• 189']);
  });

  it('finds a payment card by Luhn, masked to its last four digits', () => {
    const found = piiFindings('Carte 4970 1012 3456 7893 et numéro 4970 1012 3456 7890.', 'body');
    expect(values(found, 'Payment card number')).toEqual(['•••• •••• •••• 7893']);
  });

  it('finds a French social security number by its key', () => {
    const found = piiFindings('NIR : 1 85 05 78 006 084 91 ; faux : 1 85 05 78 006 084 92', 'body');
    expect(values(found, 'French social security number (NIR)')).toEqual(['1 •• •• •• ••• ••• 91']);
  });

  it('finds SIREN and SIRET numbers named as such, by Luhn', () => {
    const found = piiFindings('Société X, SIREN 732 829 320, SIRET : 73282932000074. Référence 123 456 789.', 'body');
    expect(values(found, 'SIREN/SIRET number')).toEqual(['732 ••• •••', '732 ••• ••• •••••']);
  });

  it('finds addresses, phones, hosts and machines, all masked', () => {
    const text =
      'Écrire à jean.dupont@exemple.fr ou au 06 12 34 56 78, +44 20 7946 0958. Serveur 10.2.3.4, ' +
      'public 81.56.12.200, fe80::1ff:fe23:4567:890a, sql01.interne.corp, MAC 00:1A:2B:3C:4D:5E. Plaque AB-123-CD, passeport 12AB34567.';
    const found = piiFindings(text, 'body');
    expect(values(found, 'Email address')).toEqual(['j•••@exemple.fr']);
    expect(values(found, 'Phone number')).toEqual(['06 •• •• •• 78', '+44 •• •••• 0958']);
    expect(values(found, 'Private IP address')).toEqual(['10.2.•.•']);
    expect(values(found, 'IP address')).toEqual(['81.56.•.•', 'fe80:•••:•••:•••:•••']);
    expect(values(found, 'Internal host name')).toEqual(['sql01.•••.corp']);
    expect(values(found, 'MAC address')).toEqual(['00:1A:2B:••:••:••']);
    expect(values(found, 'French licence plate')).toEqual(['AB-•••-CD']);
    expect(values(found, 'Passport or ID card number')).toEqual(['•••••4567']);
    expect(found.find((f) => f.label === 'Passport or ID card number')?.confidence).toBe('probable');
  });

  it('says nothing about dates, times, versions and amounts', () => {
    expect(piiFindings('Le 12/10/2026 à 14:30:00, version 2.4.1, total 1 250 000,00 €, réf. 2026-114.', 'body')).toEqual([]);
  });
});

describe('[F-2.3] --pii on files', () => {
  it('is off by default, and reads the body of a document when asked', async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(`<w:document ${W}><w:body><w:p><w:r><w:t>Contact : marie.martin@exemple.fr</w:t></w:r></w:p></w:body></w:document>`),
    });
    expect((await inspectFile(docx, 'cv.docx')).findings.some((f) => f.label === 'Email address')).toBe(false);
    expect((await inspectFile(docx, 'cv.docx', { pii: true })).findings.find((f) => f.label === 'Email address')).toMatchObject({ value: 'm•••@exemple.fr', location: 'document body' });
  });

  it('counts personal data as still there after cleaning, never as removed', async () => {
    const result = await redactFile(new TextEncoder().encode('Écrire à jean.dupont@exemple.fr'), 'note.txt', { pii: true });
    expect(result.removed.some((f) => f.label === 'Email address')).toBe(false);
    expect((result.kept ?? []).some((f) => f.label === 'Email address')).toBe(true);
  });
});

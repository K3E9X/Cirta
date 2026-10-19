import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { inspectFile } from '../src/core/index.js';
import { fileNameFindings } from '../src/core/filenames.js';
import { outlookMessage } from './helpers/ole.js';

const labels = (findings: Array<{ label: string }>) => findings.map((f) => f.label);
const find = <T extends { label: string }>(findings: T[], label: string) => findings.find((f) => f.label === label);

describe('[F-P2 2.1] file names that lie', () => {
  it('shows what a right-to-left override makes a name look like, and what it is', () => {
    const found = fileNameFindings('invoice\u202Efdp.exe', 'x');
    const rlo = find(found, 'File name with a direction control');
    expect(rlo?.value).toBe('shown as “invoiceexe.pdf”, really ends in .exe (U+202E)');
    expect(rlo?.confidence).toBe('confirmed');
    expect(rlo?.kind).toBe('deceptive-name');
  });

  it('names a double extension that hides a program, spaces included', () => {
    expect(find(fileNameFindings('facture.pdf.exe', 'x'), 'Double extension hiding a program')?.value).toBe('facture.pdf.exe — opens as .exe, not .pdf');
    expect(find(fileNameFindings('photo.jpg          .scr', 'x'), 'Double extension hiding a program')).toBeDefined();
    // An ordinary double extension is not a disguise.
    expect(fileNameFindings('archive.tar.gz', 'x')).toEqual([]);
    expect(fileNameFindings('rapport.v2.pdf', 'x')).toEqual([]);
  });

  it('names invisible characters and mixed alphabets in a name', () => {
    expect(labels(fileNameFindings('rap\u200Bport.pdf', 'x'))).toContain('Invisible character in a file name');
    // A Cyrillic "а" in "pаypal".
    expect(labels(fileNameFindings('p\u0430ypal-facture.pdf', 'x'))).toContain('File name mixing two alphabets');
    expect(fileNameFindings('Rapport annuel — été.pdf', 'x')).toEqual([]);
    expect(fileNameFindings('Отчёт.pdf', 'x')).toEqual([]);
  });

  it('names an archive member that would be written outside its folder', () => {
    for (const name of ['../../etc/cron.d/x', '..\\..\\Windows\\a.dll', '/etc/passwd', 'C:\\Users\\a.txt', 'dossier/../../../x']) {
      expect(labels(fileNameFindings(name, 'x')), name).toContain('Archive member written outside its folder');
    }
    expect(fileNameFindings('dossier/sous-dossier/a.txt', 'x')).toEqual([]);
  });

  it('reads the names of archive members, mail attachments and Outlook attachments', async () => {
    const zip = zipSync({ 'factures/facture\u202Efdp.exe': strToU8('MZ'), '../evasion.txt': strToU8('x'), 'ok.txt': strToU8('bonjour') });
    const inZip = (await inspectFile(zip, 'a.zip')).findings;
    expect(labels(inZip)).toEqual(expect.arrayContaining(['File name with a direction control', 'Archive member written outside its folder']));

    const mail = strToU8(
      'From: a@b.fr\r\nTo: c@d.fr\r\nSubject: x\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nci-joint\r\n--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="releve.pdf.exe"\r\n\r\nMZ\r\n--b--\r\n',
    );
    expect(labels((await inspectFile(mail, 'a.eml')).findings)).toContain('Double extension hiding a program');

    const msg = outlookMessage({ strings: { 0x0037: 'x' }, attachments: [{ name: 'photo\u202Egpj.scr', data: strToU8('MZ') }] });
    expect(labels((await inspectFile(msg, 'a.msg')).findings)).toContain('File name with a direction control');
  });
});

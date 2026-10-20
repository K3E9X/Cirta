import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { inspectFile, redactFile, type Finding } from '../src/core/index.js';
import { runCli } from './helpers/cli.js';

/*
 * [C5] A DOCX with tracked changes kept the deleted sentence in w:delText:
 * inspection named its author and never showed the text, and cleaning left it,
 * dated, under an author renamed "Author". The deleted text is the finding;
 * accepting the changes is how it goes, and it is never done unasked.
 */

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const at = 'w:author="Marie Martin" w:date="2026-10-01T10:00:00Z"';

const BODY =
  `<w:p w:rsidR="00A1B2C3" w:rsidRDefault="00A1B2C3"><w:r w:rsidRPr="00D4E5F6"><w:t>Proposition commerciale.</w:t></w:r></w:p>` +
  `<w:p><w:del w:id="91" ${at}><w:r><w:delText>Montant reel negocie : 1 250 000 EUR</w:delText></w:r></w:del>` +
  `<w:ins w:id="92" ${at}><w:r><w:t>Montant : voir annexe</w:t></w:r></w:ins></w:p>` +
  `<w:p><w:moveFrom w:id="93" ${at}><w:r><w:t>Clause de non-concurrence de deux ans</w:t></w:r></w:moveFrom></w:p>` +
  `<w:p><w:moveTo w:id="94" ${at}><w:r><w:t>Clause de non-concurrence de deux ans</w:t></w:r></w:moveTo></w:p>` +
  `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="95" ${at}><w:rPr/></w:rPrChange></w:rPr><w:t>Texte passé en gras</w:t></w:r></w:p>`;

function docx(body = BODY): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr w:rsidR="00A1B2C3"/></w:body></w:document>`),
    'word/styles.xml': strToU8(`<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Normal" w:rsidR="00C0FFEE"/></w:styles>`),
    'word/comments.xml': strToU8(`<?xml version="1.0"?><w:comments ${W}><w:comment w:id="0" ${at} w:initials="MM"><w:p><w:r><w:t>À revoir</w:t></w:r></w:p></w:comment></w:comments>`),
  });
}

const part = (bytes: Uint8Array, path = 'word/document.xml') => strFromU8(unzipSync(bytes)[path]!);
const byLabel = (findings: Finding[], label: string) => findings.filter((f) => f.label === label);

describe('[C5] tracked changes in inspection', () => {
  it('quotes the deleted text, confirmed', async () => {
    const { findings } = await inspectFile(docx(), 'contrat.docx');
    const [deleted] = byLabel(findings, 'Deleted text still in the file (tracked changes)');
    expect(deleted?.confidence).toBe('confirmed');
    expect(deleted?.value).toContain('Montant reel negocie : 1 250 000 EUR');
  });

  it('reports insertions not yet accepted, and text moved away from its old place', async () => {
    const { findings } = await inspectFile(docx(), 'contrat.docx');
    expect(byLabel(findings, 'Inserted text not yet accepted (tracked changes)')[0]?.value).toContain('Montant : voir annexe');
    expect(byLabel(findings, 'Moved text still at its old place (tracked changes)')[0]?.value).toContain('Clause de non-concurrence');
  });
});

describe('[C5] cleaning without accepting changes', () => {
  it('leaves the deleted text, and names it as still in the cleaned copy', async () => {
    const result = await redactFile(docx(), 'contrat.docx');
    expect(part(result.data!)).toContain('Montant reel negocie');
    expect(result.kept?.map((f) => f.label)).toContain('Deleted text still in the file (tracked changes)');
  });

  it('removes the dates of revisions and comments, like their authors', async () => {
    const result = await redactFile(docx(), 'contrat.docx');
    expect(part(result.data!)).not.toContain('w:date=');
    expect(part(result.data!, 'word/comments.xml')).not.toContain('w:date=');
    expect(part(result.data!)).not.toContain('Marie Martin');
  });

  it('removes revision identifiers from every part, not only settings.xml', async () => {
    const result = await redactFile(docx(), 'contrat.docx');
    expect(part(result.data!)).not.toMatch(/w:rsid\w*=/);
    expect(part(result.data!, 'word/styles.xml')).not.toMatch(/w:rsid\w*=/);
  });
});

describe('[C5] cleaning with accepted changes', () => {
  it('drops deletions and moved-from text, keeps insertions and moved-to text as plain runs', async () => {
    const result = await redactFile(docx(), 'contrat.docx', { acceptChanges: true });
    const xml = part(result.data!);
    expect(xml).not.toContain('Montant reel negocie');
    expect(xml).not.toMatch(/<w:(?:del|ins|moveFrom|moveTo|rPrChange)\b/);
    expect(xml).toContain('Montant : voir annexe');
    expect(xml.match(/Clause de non-concurrence/g)).toHaveLength(1);
    expect(xml).toContain('Texte passé en gras');
    expect(result.removed.map((f) => f.label)).toContain('Deleted text still in the file (tracked changes)');
    expect(result.notes.map((n) => n.code)).toContain('removed:tracked-changes');
  });

  it('is offered from the command line as --accept-changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ciirta-c5-'));
    writeFileSync(join(dir, 'in.docx'), docx());
    const run = runCli(['redact', join(dir, 'in.docx'), '-o', join(dir, 'out.docx'), '--accept-changes']);
    expect(run.status).toBe(0);
    expect(part(new Uint8Array(readFileSync(join(dir, 'out.docx'))))).not.toContain('Montant reel negocie');
  });
});

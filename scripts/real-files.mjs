/**
 * Round-trip real Office and OpenDocument files through redaction.
 *
 * Every unit-test fixture in this repository is built by hand. That is fast and
 * precise, but a hand-built container shares the parser's own assumptions — the
 * one genuinely signed image in the suite is what caught the CBOR reader
 * assuming manifests hold no indefinite-length items.
 *
 * So this asks LibreOffice to produce a document, redacts it, and asks
 * LibreOffice to open the result. A converter that succeeds is a far stronger
 * statement than any assertion written here: a real implementation accepted the
 * file. Corrupting a Word document is the worst outcome this tool has, and
 * nothing else in the suite would notice it.
 *
 * The first conversion is the control. If LibreOffice cannot even produce the
 * input — it is absent, sandboxed, or missing a filter — this skips loudly
 * rather than failing, because that says nothing about the redaction. Only a
 * document that LibreOffice made and then refused to reopen is a real defect,
 * and that is the only thing here that fails the run.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import process from 'node:process';

import { inspectFile, redactFile } from '../dist/core/index.js';

const run = promisify(execFile);

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const skip = (reason) => {
  console.log(`\nSKIPPED — ${reason}`);
  console.log('This says nothing about redaction; it means the control could not be produced.');
  process.exit(0);
};

/** A fresh profile per call, or concurrent invocations fight over one and hang. */
async function soffice(args, tag) {
  return run(
    'soffice',
    [`-env:UserInstallation=file://${join(tmpdir(), `cirta-lo-${tag}`)}`, '--headless', ...args],
    { timeout: 180_000 },
  );
}

const dir = await mkdtemp(join(tmpdir(), 'cirta-real-'));
console.log(`real-file round trip — ${process.platform}`);

try {
  try {
    await run('soffice', ['--version'], { timeout: 60_000 });
  } catch {
    skip('LibreOffice is not installed');
  }

  const source = join(dir, 'source.txt');
  // A zero-width space and French typography, so the round trip exercises both
  // what should be removed and what should survive.
  await writeFile(source, 'Rapport trimestriel​\nObjet : typographie\n', 'utf8');

  const formats = ['docx', 'odt'];
  for (const [index, format] of formats.entries()) {
    try {
      await soffice(['--convert-to', format, '--outdir', dir, source], `in${index}`);
    } catch (error) {
      skip(`LibreOffice could not convert the source (${String(error).slice(0, 120)})`);
    }
  }

  const produced = (await readdir(dir)).filter((name) => /\.(docx|odt)$/.test(name));
  if (produced.length === 0) skip('LibreOffice produced no documents from the source');
  console.log(`  control: LibreOffice produced ${produced.join(', ')}`);

  for (const name of produced) {
    const original = new Uint8Array(await readFile(join(dir, name)));

    const report = await inspectFile(original);
    check(`${name}: inspected as ${report.format}`, report.format !== 'zip');
    check(
      `${name}: found the metadata LibreOffice wrote`,
      report.findings.length > 0,
      'no findings at all in a freshly authored document',
    );

    const redacted = await redactFile(original);
    const cleanName = name.replace(/(\.[^.]+)$/, '.clean$1');
    await writeFile(join(dir, cleanName), redacted.data);

    check(
      `${name}: nothing confirmed survives redaction`,
      !(await inspectFile(redacted.data)).findings.some((f) => f.confidence === 'confirmed'),
    );

    // The point of this whole script: a real implementation must still accept it.
    const out = join(dir, `out-${name}`);
    try {
      await soffice(['--convert-to', 'pdf', '--outdir', out, join(dir, cleanName)], `out-${name}`);
      const converted = await readdir(out);
      check(
        `${name}: reopens in LibreOffice after redaction`,
        converted.some((file) => file.endsWith('.pdf')),
        `converted: ${converted.join(', ') || 'nothing'}`,
      );
    } catch (error) {
      check(`${name}: reopens in LibreOffice after redaction`, false, String(error).slice(0, 200));
    }
  }

  // [C5] Tracked changes accepted, then reopened. LibreOffice's own DOCX with
  // a deletion and an insertion written into it the way Word records them.
  const docxName = produced.find((name) => name.endsWith('.docx'));
  if (docxName) {
    const parts = unzipSync(new Uint8Array(await readFile(join(dir, docxName))));
    const revision = 'w:id="901" w:author="Marie Martin" w:date="2026-10-01T10:00:00Z"';
    parts['word/document.xml'] = strToU8(
      strFromU8(parts['word/document.xml']).replace(
        /<w:body>/,
        `<w:body><w:p><w:del ${revision}><w:r><w:delText>Montant reel negocie 1 250 000 EUR</w:delText></w:r></w:del>` +
          `<w:ins w:id="902" w:author="Marie Martin" w:date="2026-10-01T10:00:00Z"><w:r><w:t>Montant voir annexe</w:t></w:r></w:ins></w:p>`,
      ),
    );
    const tracked = zipSync(parts);
    const before = await inspectFile(tracked, 'tracked.docx');
    check(
      'tracked.docx: the deleted text is quoted',
      before.findings.some((f) => f.value.includes('Montant reel negocie')),
    );
    const accepted = await redactFile(tracked, 'tracked.docx', { acceptChanges: true });
    await writeFile(join(dir, 'tracked.clean.docx'), accepted.data);
    const out = join(dir, 'out-tracked');
    try {
      await soffice(['--convert-to', 'txt:Text', '--outdir', out, join(dir, 'tracked.clean.docx')], 'out-tracked');
      const text = await readFile(join(out, 'tracked.clean.txt'), 'utf8');
      check('tracked.docx: reopens in LibreOffice with changes accepted', text.includes('Montant voir annexe'), text.slice(0, 120));
      check('tracked.docx: the deleted text is gone after accepting', !text.includes('Montant reel negocie'));
    } catch (error) {
      check('tracked.docx: reopens in LibreOffice with changes accepted', false, String(error).slice(0, 200));
    }
  }

  // [C6] A comment removed, then reopened: LibreOffice's DOCX with a Word
  // comment anchored in its text, the parts and references Word writes.
  if (docxName) {
    const parts = unzipSync(new Uint8Array(await readFile(join(dir, docxName))));
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    parts['word/comments.xml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${W}><w:comment w:id="7" w:author="Paul Durand" w:initials="PD"><w:p><w:r><w:t>Ne pas envoyer au client</w:t></w:r></w:p></w:comment></w:comments>`,
    );
    parts['word/document.xml'] = strToU8(
      strFromU8(parts['word/document.xml']).replace(
        /<w:body>/,
        '<w:body><w:p><w:commentRangeStart w:id="7"/><w:r><w:t>Budget commente</w:t></w:r><w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r></w:p>',
      ),
    );
    parts['word/_rels/document.xml.rels'] = strToU8(
      strFromU8(parts['word/_rels/document.xml.rels']).replace(
        '</Relationships>',
        '<Relationship Id="rIdCmt7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>',
      ),
    );
    parts['[Content_Types].xml'] = strToU8(
      strFromU8(parts['[Content_Types].xml']).replace(
        '</Types>',
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>',
      ),
    );
    const commented = zipSync(parts);
    const before = await inspectFile(commented, 'commented.docx');
    check('commented.docx: the comment text is reported', before.findings.some((f) => f.value.includes('Ne pas envoyer au client')));
    const removed = await redactFile(commented, 'commented.docx', { removeComments: true });
    await writeFile(join(dir, 'commented.clean.docx'), removed.data);
    const out = join(dir, 'out-commented');
    try {
      await soffice(['--convert-to', 'txt:Text', '--outdir', out, join(dir, 'commented.clean.docx')], 'out-commented');
      const text = await readFile(join(out, 'commented.clean.txt'), 'utf8');
      check('commented.docx: reopens in LibreOffice with comments removed', text.includes('Budget commente'), text.slice(0, 120));
      check('commented.docx: the comment is gone', !unzipSync(removed.data)['word/comments.xml']);
    } catch (error) {
      check('commented.docx: reopens in LibreOffice with comments removed', false, String(error).slice(0, 200));
    }
  }

  // [F-2.1] Active content stripped, then reopened: LibreOffice's DOCX with a
  // remote template, a DDE field and a field including a remote picture.
  if (docxName) {
    const parts = unzipSync(new Uint8Array(await readFile(join(dir, docxName))));
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const field = (instr, shown) =>
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${shown}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    parts['word/document.xml'] = strToU8(
      strFromU8(parts['word/document.xml']).replace(
        /<w:body>/,
        `<w:body><w:p>${field(' DDEAUTO c:\\\\windows\\\\system32\\\\cmd.exe "/k calc" ', 'Resultat DDE')}</w:p><w:p>${field(' INCLUDEPICTURE "http://pixel.example/p.png" ', 'Image distante')}</w:p>`,
      ),
    );
    const settings = parts['word/settings.xml'] ? strFromU8(parts['word/settings.xml']) : null;
    if (settings) {
      parts['word/settings.xml'] = strToU8(
        settings.replace(/<w:settings\b([^>]*)>/, (open, attrs) => `<w:settings${attrs.includes('xmlns:r=') ? attrs : `${attrs} xmlns:r="${R}"`}><w:attachedTemplate r:id="rIdTpl"/>`),
      );
      parts['word/_rels/settings.xml.rels'] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdTpl" Type="${R}/attachedTemplate" Target="https://templates.example/report.dotm" TargetMode="External"/></Relationships>`,
      );
    }
    const active = zipSync(parts);
    const before = await inspectFile(active, 'active.docx');
    check('active.docx: the DDE field is reported', before.findings.some((f) => f.label === 'DDE field (runs a command)'));
    check('active.docx: the remote template is reported', !settings || before.findings.some((f) => f.label === 'Remote template loaded on opening'));
    const stripped = await redactFile(active, 'active.docx', { stripActive: true });
    await writeFile(join(dir, 'active.clean.docx'), stripped.data);
    const out = join(dir, 'out-active');
    try {
      await soffice(['--convert-to', 'txt:Text', '--outdir', out, join(dir, 'active.clean.docx')], 'out-active');
      const text = await readFile(join(out, 'active.clean.txt'), 'utf8');
      check('active.docx: reopens in LibreOffice with active content stripped', text.includes('Resultat DDE'), text.slice(0, 120));
      const xml = strFromU8(unzipSync(stripped.data)['word/document.xml']);
      check('active.docx: no DDE or remote INCLUDE instruction is left', !/DDEAUTO|INCLUDEPICTURE/.test(xml));
    } catch (error) {
      check('active.docx: reopens in LibreOffice with active content stripped', false, String(error).slice(0, 200));
    }
  }

  // [F-2.4] A deck with notes and a hidden slide, both removed, then opened by
  // LibreOffice: two pages exported, where there were three slides.
  {
    const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const PML = 'application/vnd.openxmlformats-officedocument.presentationml';
    const rels = (...items) =>
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
    const tree = (content) => `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${content}</p:spTree></p:cSld>`;
    const box = (words) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="6000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${words}</a:t></a:r></a:p></p:txBody></p:sp>`;
    const files = {};
    const overrides = [`<Override PartName="/ppt/presentation.xml" ContentType="${PML}.presentation.main+xml"/>`, `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${PML}.slideMaster+xml"/>`, `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${PML}.slideLayout+xml"/>`];
    const slides = [['Premiere', 'Note un'], ['Secrete', 'Note deux', true], ['Derniere']];
    slides.forEach(([words, notes, hidden], i) => {
      const n = i + 1;
      files[`ppt/slides/slide${n}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${P}${hidden ? ' show="0"' : ''}>${tree(box(words))}</p:sld>`);
      overrides.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="${PML}.slide+xml"/>`);
      const own = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']];
      if (notes) {
        files[`ppt/notesSlides/notesSlide${n}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${P}>${tree(box(notes))}</p:notes>`);
        files[`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`] = strToU8(rels(['rId1', 'slide', `../slides/slide${n}.xml`]));
        overrides.push(`<Override PartName="/ppt/notesSlides/notesSlide${n}.xml" ContentType="${PML}.notesSlide+xml"/>`);
        own.push(['rId2', 'notesSlide', `../notesSlides/notesSlide${n}.xml`]);
      }
      files[`ppt/slides/_rels/slide${n}.xml.rels`] = strToU8(rels(...own));
    });
    files['ppt/presentation.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
    files['ppt/_rels/presentation.xml.rels'] = strToU8(rels(['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ...slides.map((_, i) => [`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`])));
    files['ppt/slideMasters/slideMaster1.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${P}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
    files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8(rels(['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']));
    files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${P}>${tree('')}</p:sldLayout>`);
    files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = strToU8(rels(['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']));
    files['_rels/.rels'] = strToU8(rels(['rId1', 'officeDocument', 'ppt/presentation.xml']));
    files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>`);
    const deck = zipSync(files);
    const cleaned = await redactFile(deck, 'deck.pptx', { removeNotes: true, removeHiddenSlides: true });
    await writeFile(join(dir, 'deck.clean.pptx'), cleaned.data);
    const out = join(dir, 'out-deck');
    try {
      await soffice(['--convert-to', 'pdf', '--outdir', out, join(dir, 'deck.clean.pptx')], 'out-deck');
      const pdf = await readFile(join(out, 'deck.clean.pdf'), 'latin1');
      const pages = (pdf.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
      // LibreOffice leaves hidden slides out of a PDF export anyway, so the
      // page count says the deck opens; the package says the slide is gone.
      check('deck.pptx: reopens in LibreOffice with notes and the hidden slide removed', pages === 2, `${pages} page(s)`);
      const kept = unzipSync(cleaned.data);
      check('deck.pptx: the hidden slide and every notes part are gone from the package', !kept['ppt/slides/slide2.xml'] && !Object.keys(kept).some((p) => p.includes('notesSlide')));
    } catch (error) {
      check('deck.pptx: reopens in LibreOffice with notes and the hidden slide removed', false, String(error).slice(0, 200));
    }
  }
  // [F-2.2] Legacy Office as LibreOffice writes it: the properties read, the clean refused.
  {
    const meta = '<office:meta><meta:initial-creator>Jeanne Dupont</meta:initial-creator><dc:creator>Marc Leroy</dc:creator></office:meta>';
    const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.3"';
    await writeFile(join(dir, 'legacy.fodt'), `<?xml version="1.0" encoding="UTF-8"?><office:document ${NS} office:mimetype="application/vnd.oasis.opendocument.text">${meta}<office:body><office:text><text:p>Bonjour</text:p></office:text></office:body></office:document>`);
    await writeFile(join(dir, 'legacy.fodp'), `<?xml version="1.0" encoding="UTF-8"?><office:document ${NS} office:mimetype="application/vnd.oasis.opendocument.presentation">${meta}<office:body><office:presentation><draw:page draw:name="p1"/></office:presentation></office:body></office:document>`);
    for (const [source, format] of [['legacy.fodt', 'doc'], ['legacy.fodp', 'ppt']]) {
      const name = `legacy.${format}`;
      try {
        await soffice(['--convert-to', format, '--outdir', dir, join(dir, source)], `legacy-${format}`);
        const bytes = new Uint8Array(await readFile(join(dir, name)));
        const report = await inspectFile(bytes, name);
        const author = report.findings.find((f) => f.label === 'Author')?.value;
        const saver = report.findings.find((f) => f.label === 'Last modified by')?.value;
        check(`${name}: read as ${format}, author and last saver from its property sets`, report.format === format && author === 'Jeanne Dupont' && saver === 'Marc Leroy', `${report.format}, ${author}, ${saver}`);
        const refusal = await redactFile(bytes, name).then(() => undefined, (error) => error);
        check(`${name}: cleaning refused rather than attempted`, refusal?.code === 'legacy-not-rewritable', String(refusal?.code));
      } catch (error) {
        check(`${name}: produced by LibreOffice and inspected`, false, String(error).slice(0, 200));
      }
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall real-file checks passed');

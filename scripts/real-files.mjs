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
  // [F-2.2] A cleaned notebook must still be a notebook, as Jupyter's own validator reads it.
  // Needs Python with nbformat (CIRTA_PYTHON names the interpreter); without it, says so and moves on.
  {
    const python = process.env.CIRTA_PYTHON ?? 'python3';
    let available = true;
    try {
      await run(python, ['-I', '-c', 'import nbformat'], { timeout: 60_000 });
    } catch {
      available = false;
      console.log('  skip  notebook: nbformat is not installed for ' + python);
    }
    if (available) {
      const nb = {
        cells: [
          { cell_type: 'markdown', id: 'a1', metadata: {}, source: ['# Analyse'] },
          {
            cell_type: 'code', id: 'b2', execution_count: 3,
            metadata: { tags: ['parameters'], execution: { 'iopub.execute_input': '2026-10-01T09:14:58.120Z' } },
            source: ['print(1)'],
            outputs: [
              { output_type: 'stream', name: 'stdout', text: ['/home/jdupont/donnees.csv\n'] },
              { output_type: 'error', ename: 'E', evalue: 'x', traceback: ['C:\\Users\\jdupont\\a.py'] },
              { output_type: 'execute_result', execution_count: 3, metadata: {}, data: { 'text/plain': ['1'] } },
            ],
          },
        ],
        metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' }, authors: [{ name: 'Jeanne Dupont' }], papermill: { input_path: '/home/jdupont/a.ipynb' } },
        nbformat: 4,
        nbformat_minor: 5,
      };
      const bytes = strToU8(JSON.stringify(nb));
      for (const [name, options] of [['notebook.clean.ipynb', {}], ['notebook.cleared.ipynb', { clearOutputs: true }]]) {
        const cleaned = await redactFile(bytes, 'notebook.ipynb', options);
        await writeFile(join(dir, name), cleaned.data);
        try {
          const { stdout } = await run(python, ['-I', '-c', 'import nbformat, sys; nb = nbformat.read(sys.argv[1], as_version=4); nbformat.validate(nb); print(sorted(nb.metadata), sum(len(c.get("outputs", [])) for c in nb.cells))', join(dir, name)], { timeout: 60_000 });
          const expected = `['kernelspec', 'language_info'] ${options.clearOutputs ? 0 : 3}`;
          check(`${name}: valid for nbformat, metadata reduced to the kernel, outputs ${options.clearOutputs ? 'emptied' : 'kept'}`, stdout.trim() === expected, stdout.trim());
        } catch (error) {
          check(`${name}: valid for nbformat`, false, String(error).slice(0, 200));
        }
      }
    }
  }
  // [F-2.8] A wider corpus, made by LibreOffice: spreadsheets, decks and a PDF, each with an author.
  // Each must be read (the author found), cleaned (nothing confirmed left) and reopened by a real
  // implementation: LibreOffice for the packages, poppler's pdfinfo and pdftotext for the PDF.
  {
    const META = '<office:meta><meta:initial-creator>Jeanne Dupont</meta:initial-creator><dc:creator>Marc Leroy</dc:creator><dc:title>Budget</dc:title></office:meta>';
    const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.3"';
    const flat = (type, body) => `<?xml version="1.0" encoding="UTF-8"?><office:document ${NS} office:mimetype="application/vnd.oasis.opendocument.${type}">${META}<office:body>${body}</office:body></office:document>`;
    await writeFile(join(dir, 'corpus-sheet.fods'), flat('spreadsheet', '<office:spreadsheet><table:table table:name="F1"><table:table-row><table:table-cell><text:p>Montant 42</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>'));
    await writeFile(join(dir, 'corpus-deck.fodp'), flat('presentation', '<office:presentation><draw:page draw:name="p1"/></office:presentation>'));
    await writeFile(join(dir, 'corpus-text.fodt'), flat('text', '<office:text><text:p>Bonjour le corpus</text:p></office:text>'));
    const cases = [['corpus-sheet.fods', 'xlsx'], ['corpus-sheet.fods', 'ods'], ['corpus-deck.fodp', 'pptx'], ['corpus-deck.fodp', 'odp'], ['corpus-text.fodt', 'pdf']];
    let poppler = true;
    try {
      await run('pdfinfo', ['-v'], { timeout: 30_000 });
    } catch {
      poppler = false;
    }
    for (const [source, format] of cases) {
      const name = `${source.replace(/\.f?od.$/, '')}.${format}`;
      try {
        await soffice(['--convert-to', format, '--outdir', dir, join(dir, source)], `corpus-${format}`);
        const bytes = new Uint8Array(await readFile(join(dir, name)));
        const report = await inspectFile(bytes, name);
        const author = report.findings.find((f) => f.label === 'Author' || f.label === 'Initial author')?.value;
        check(`${name}: read as ${format}, the author found`, report.format === format && author === 'Jeanne Dupont', `${report.format}, ${author}`);
        const cleaned = await redactFile(bytes, name);
        const left = (await inspectFile(cleaned.data, name)).findings.filter((f) => f.confidence === 'confirmed');
        check(`${name}: nothing confirmed survives the clean`, left.length === 0, left.map((f) => `${f.label}: ${f.value}`).join('; '));
        const cleanName = name.replace(/(\.[^.]+)$/, '.clean$1');
        await writeFile(join(dir, cleanName), cleaned.data);
        if (format === 'pdf') {
          if (!poppler) {
            console.log(`  skip  ${cleanName}: poppler (pdfinfo, pdftotext) is not installed`);
            continue;
          }
          const info = (await run('pdfinfo', [join(dir, cleanName)], { timeout: 60_000 })).stdout;
          const text = (await run('pdftotext', [join(dir, cleanName), '-'], { timeout: 60_000 })).stdout;
          check(`${cleanName}: poppler opens it, no author, the page text intact`, !/Jeanne|Marc/.test(info) && text.includes('Bonjour le corpus'), info.split('\n').filter((l) => /Author|Creator|Producer/.test(l)).join('; '));
        } else {
          const out = join(dir, `out-corpus-${format}`);
          await soffice(['--convert-to', 'pdf', '--outdir', out, join(dir, cleanName)], `out-corpus-${format}`);
          const pdf = await readFile(join(out, cleanName.replace(/\.[^.]+$/, '.pdf')));
          check(`${cleanName}: reopens in LibreOffice`, pdf.length > 500, `${pdf.length} bytes`);
        }
      } catch (error) {
        check(`${name}: produced by LibreOffice, cleaned and reopened`, false, String(error).slice(0, 200));
      }
    }
  }
  // [F-P2 2.4] An archive of real documents: cleaned member by member, repacked, each member
  // reopened by LibreOffice; and the same input cleaned twice gives the same bytes.
  {
    const docx = new Uint8Array(await readFile(join(dir, 'source.docx')));
    const odt = new Uint8Array(await readFile(join(dir, 'source.odt')));
    const archive = zipSync({ 'lettres/source.docx': docx, 'lettres/source.odt': odt, 'lisez-moi.txt': strToU8('Bon​jour') });
    try {
      const cleaned = await redactFile(archive, 'dossier.zip');
      const again = await redactFile(archive, 'dossier.zip');
      check('dossier.zip: cleaned twice, the same bytes', Buffer.from(cleaned.data).equals(Buffer.from(again.data)));
      const left = (await inspectFile(cleaned.data, 'dossier.zip')).findings.filter((f) => f.confidence === 'confirmed');
      check('dossier.zip: nothing confirmed survives in any member', left.length === 0, left.map((f) => `${f.location}: ${f.label}`).join('; '));
      const members = unzipSync(cleaned.data);
      for (const name of ['source.docx', 'source.odt']) {
        const path = join(dir, `zip-${name}`);
        await writeFile(path, members[`lettres/${name}`]);
        const out = join(dir, `out-zip-${name}`);
        await soffice(['--convert-to', 'pdf', '--outdir', out, path], `out-zip-${name}`);
        const pdf = await readFile(join(out, `zip-${name.replace(/\.[^.]+$/, '.pdf')}`));
        check(`dossier.zip → ${name}: reopens in LibreOffice after the archive clean`, pdf.length > 500, `${pdf.length} bytes`);
      }
    } catch (error) {
      check('dossier.zip: cleaned and its members reopened', false, String(error).slice(0, 200));
    }
  }
  // [F-P2 2.2] LibreOffice's own RTF, an author and a company written into its info group:
  // inspected, cleaned, and the cleaned copy read back as text by LibreOffice.
  try {
    await soffice(['--convert-to', 'rtf', '--outdir', dir, join(dir, 'source.docx')], 'rtf');
    const rtf = (await readFile(join(dir, 'source.rtf'), 'latin1')).replace('{\\info', '{\\info{\\author Marie Martin}{\\*\\company Cabinet Martin}');
    const original = new Uint8Array(Buffer.from(rtf, 'latin1'));
    const report = await inspectFile(original, 'source.rtf');
    check('source.rtf: inspected as rtf', report.format === 'rtf', report.format);
    check('source.rtf: the author and the generator are named', report.findings.some((f) => f.label === 'Author' && f.value === 'Marie Martin') && report.findings.some((f) => f.label === 'Producing application' && /LibreOffice/.test(f.value)));
    const cleaned = await redactFile(original, 'source.rtf');
    const left = (await inspectFile(cleaned.data, 'source.rtf')).findings.filter((f) => f.confidence !== 'informational');
    check('source.rtf: nothing survives the clean', left.length === 0, left.map((f) => `${f.location}: ${f.label}`).join('; '));
    await writeFile(join(dir, 'clean.rtf'), cleaned.data);
    const out = join(dir, 'out-rtf');
    await soffice(['--convert-to', 'txt:Text', '--outdir', out, join(dir, 'clean.rtf')], 'out-rtf');
    const text = await readFile(join(out, 'clean.txt'), 'utf8');
    check('source.rtf: the cleaned copy reopens with its text', text.includes('Rapport trimestriel') && text.includes('Objet'), text.slice(0, 120));
  } catch (error) {
    check('source.rtf: produced by LibreOffice, cleaned and reopened', false, String(error).slice(0, 200));
  }
  // [F-P2 2.2] LibreOffice's own EPUB: cleaned, nothing confirmed left, and every
  // XML part still well formed (xmllint, where it is installed).
  try {
    await soffice(['--convert-to', 'epub', '--outdir', dir, join(dir, 'source.docx')], 'epub');
    const original = new Uint8Array(await readFile(join(dir, 'source.epub')));
    const report = await inspectFile(original, 'source.epub');
    check('source.epub: inspected as epub', report.format === 'epub', report.format);
    check('source.epub: the generator and the identifier are named', report.findings.some((f) => f.label === 'Producing application' && /LibreOffice/.test(f.value)) && report.findings.some((f) => f.label === 'Book identifier'));
    const cleaned = await redactFile(original, 'source.epub');
    const left = (await inspectFile(cleaned.data, 'source.epub')).findings.filter((f) => f.confidence === 'confirmed');
    check('source.epub: nothing confirmed survives the clean', left.length === 0, left.map((f) => `${f.location}: ${f.label}`).join('; '));
    const members = unzipSync(cleaned.data);
    check('source.epub: the pages keep their text', Object.entries(members).some(([p, b]) => p.endsWith('.xhtml') && strFromU8(b).includes('Rapport trimestriel')));
    let xmllint = true;
    try {
      await run('xmllint', ['--version']);
    } catch {
      xmllint = false;
      console.log('  skip  source.epub: xmllint is not installed, well-formedness not checked');
    }
    if (xmllint) {
      for (const [path, bytes] of Object.entries(members)) {
        if (!/\.(?:xhtml|opf|ncx|xml)$/.test(path)) continue;
        const file = join(dir, `epub-${path.replace(/[/\\]/g, '_')}`);
        await writeFile(file, bytes);
        let ok = true;
        try {
          await run('xmllint', ['--noout', file]);
        } catch {
          ok = false;
        }
        check(`source.epub → ${path}: well formed after the clean`, ok);
      }
    }
  } catch (error) {
    check('source.epub: produced by LibreOffice and cleaned', false, String(error).slice(0, 200));
  }
  // [F-P2 2.2] A Visio drawing written the way Visio lays one out, with an author, a comment
  // author and a picture: cleaned, then opened by LibreOffice's Visio import.
  try {
    const V = 'http://schemas.microsoft.com/office/visio/2012/main';
    const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const REL = 'http://schemas.microsoft.com/visio/2010/relationships';
    const xml = (body) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`);
    const drawing = zipSync({
      '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/><Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'),
      '_rels/.rels': xml(`<Relationships xmlns="${R}"><Relationship Id="rId1" Type="${REL}/document" Target="visio/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
      'docProps/core.xml': xml('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Marie Martin</dc:creator><cp:lastModifiedBy>Marie Martin</cp:lastModifiedBy></cp:coreProperties>'),
      'visio/document.xml': xml(`<VisioDocument xmlns="${V}"><DocumentSettings/></VisioDocument>`),
      'visio/_rels/document.xml.rels': xml(`<Relationships xmlns="${R}"><Relationship Id="rId1" Type="${REL}/pages" Target="pages/pages.xml"/><Relationship Id="rId2" Type="${REL}/comments" Target="comments.xml"/></Relationships>`),
      'visio/comments.xml': xml(`<Comments xmlns="${V}"><AuthorList><AuthorEntry Name="Paul Durand" Initials="PD" ResolutionID="S::pd@example.com::0" ID="0"/></AuthorList><CommentList/></Comments>`),
      'visio/pages/pages.xml': xml(`<Pages xmlns="${V}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><Page ID="0" NameU="Page-1" Name="Page-1"><PageSheet><Cell N="PageWidth" V="8.5"/><Cell N="PageHeight" V="11"/></PageSheet><Rel r:id="rId1"/></Page></Pages>`),
      'visio/pages/_rels/pages.xml.rels': xml(`<Relationships xmlns="${R}"><Relationship Id="rId1" Type="${REL}/page" Target="page1.xml"/></Relationships>`),
      'visio/pages/page1.xml': xml(`<PageContents xmlns="${V}"><Shapes><Shape ID="1" Type="Shape"><Cell N="PinX" V="4"/><Cell N="PinY" V="5"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Section N="Geometry" IX="0"><Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row><Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row><Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row><Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row></Section><Text>Serveur​ central</Text></Shape></Shapes></PageContents>`),
    });
    const report = await inspectFile(drawing, 'plan.vsdx');
    check('plan.vsdx: inspected as vsdx', report.format === 'vsdx', report.format);
    const cleaned = await redactFile(drawing, 'plan.vsdx');
    const left = (await inspectFile(cleaned.data, 'plan.vsdx')).findings.filter((f) => f.confidence === 'confirmed');
    check('plan.vsdx: nothing confirmed survives the clean', left.length === 0, left.map((f) => `${f.location}: ${f.label}`).join('; '));
    await writeFile(join(dir, 'plan.clean.vsdx'), cleaned.data);
    const out = join(dir, 'out-vsdx');
    await soffice(['--convert-to', 'pdf', '--outdir', out, join(dir, 'plan.clean.vsdx')], 'out-vsdx');
    const { stdout } = await run('pdftotext', [join(out, 'plan.clean.pdf'), '-']).catch(() => ({ stdout: undefined }));
    if (stdout === undefined) console.log('  skip  plan.vsdx: pdftotext is not installed, the text is not compared');
    check('plan.vsdx: reopens in LibreOffice with its shape text', stdout === undefined || stdout.includes('Serveur central'), String(stdout).slice(0, 80));
  } catch (error) {
    check('plan.vsdx: cleaned and reopened', false, String(error).slice(0, 200));
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall real-file checks passed');

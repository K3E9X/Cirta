/**
 * [F-2.4] A complete deck: presentation, slide list, relationships both
 * ways, content types, notes — so that removing a slide or its notes is
 * checked against every reference a real deck holds.
 */

import { strToU8, zipSync } from 'fflate';

const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PML = 'application/vnd.openxmlformats-officedocument.presentationml';

const rels = (...items: Array<[string, string, string]>) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`)
    .join('')}</Relationships>`;

const text = (words: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${words}</a:t></a:r></a:p></p:txBody></p:sp>`;
const tree = (content: string) =>
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${content}</p:spTree></p:cSld>`;

export interface SlideSpec {
  words: string;
  hidden?: boolean;
  notes?: string;
}

export function deck(slides: SlideSpec[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const overrides: string[] = [`<Override PartName="/ppt/presentation.xml" ContentType="${PML}.presentation.main+xml"/>`];
  const presRels: Array<[string, string, string]> = [];
  const ids: string[] = [];
  slides.forEach((slide, i) => {
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] = strToU8(`<?xml version="1.0"?><p:sld ${P}${slide.hidden ? ' show="0"' : ''}>${tree(text(slide.words))}</p:sld>`);
    overrides.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="${PML}.slide+xml"/>`);
    presRels.push([`rId${n + 1}`, 'slide', `slides/slide${n}.xml`]);
    ids.push(`<p:sldId id="${255 + n}" r:id="rId${n + 1}"/>`);
    const slideRels: Array<[string, string, string]> = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']];
    if (slide.notes) {
      files[`ppt/notesSlides/notesSlide${n}.xml`] = strToU8(`<?xml version="1.0"?><p:notes ${P}>${tree(text(slide.notes))}</p:notes>`);
      files[`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`] = strToU8(rels(['rId1', 'slide', `../slides/slide${n}.xml`], ['rId2', 'notesMaster', '../notesMasters/notesMaster1.xml']));
      overrides.push(`<Override PartName="/ppt/notesSlides/notesSlide${n}.xml" ContentType="${PML}.notesSlide+xml"/>`);
      slideRels.push(['rId2', 'notesSlide', `../notesSlides/notesSlide${n}.xml`]);
    }
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = strToU8(rels(...slideRels));
  });
  files['ppt/presentation.xml'] = strToU8(
    `<?xml version="1.0"?><p:presentation ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId90"/></p:notesMasterIdLst><p:sldIdLst>${ids.join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  files['ppt/_rels/presentation.xml.rels'] = strToU8(rels(['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId90', 'notesMaster', 'notesMasters/notesMaster1.xml'], ...presRels));
  files['ppt/slideMasters/slideMaster1.xml'] = strToU8(`<?xml version="1.0"?><p:sldMaster ${P}>${tree('')}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8(rels(['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']));
  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(`<?xml version="1.0"?><p:sldLayout ${P}>${tree('')}</p:sldLayout>`);
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = strToU8(rels(['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']));
  files['ppt/notesMasters/notesMaster1.xml'] = strToU8(`<?xml version="1.0"?><p:notesMaster ${P}>${tree('')}</p:notesMaster>`);
  files['_rels/.rels'] = strToU8(rels(['rId1', 'officeDocument', 'ppt/presentation.xml']));
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>`,
  );
  return zipSync(files);
}

/**
 * [F-2.4] Content a clean removes only when asked: speaker notes, hidden
 * slides, hidden sheets. Each changes what the document contains, so each is
 * opt-in and announced; each takes every reference with it, or does not run.
 */

import { strFromU8, strToU8 } from 'fflate';

type Parts = Record<string, Uint8Array>;
type RemovePart = (parts: Parts, path: string) => void;

const relsOf = (path: string) => path.replace(/([^/]+)$/, '_rels/$1.rels');
const text = (parts: Parts, path: string) => (parts[path] ? strFromU8(parts[path]!) : undefined);

function targets(parts: Parts, rels: string, type: string): Array<{ id: string; target: string }> {
  const xml = text(parts, rels) ?? '';
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)]
    .filter((m) => new RegExp(`\\sType="[^"]*/${type}"`).test(m[0]))
    .map((m) => ({ id: /\sId="([^"]*)"/.exec(m[0])?.[1] ?? '', target: /\sTarget="([^"]*)"/.exec(m[0])?.[1] ?? '' }));
}

/** Resolve a target written relative to the part that owns the rels file. */
function resolve(owner: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const segments: string[] = [];
  for (const segment of (owner.replace(/[^/]*$/, '') + target).split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

function dropPart(parts: Parts, path: string, removePart: RemovePart): void {
  removePart(parts, path);
  delete parts[relsOf(path)];
}

export function removeNotes(parts: Parts, removePart: RemovePart): number {
  const notes = Object.keys(parts).filter((p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p));
  for (const path of notes) dropPart(parts, path, removePart);
  return notes.length;
}

export function removeHiddenSlides(parts: Parts, removePart: RemovePart): number {
  const hidden = Object.keys(parts).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p) && /<p:sld\b[^>]*\sshow="(0|false)"/.test(strFromU8(parts[p]!)));
  if (!hidden.length) return 0;
  let presentation = text(parts, 'ppt/presentation.xml') ?? '';
  const presRels = targets(parts, 'ppt/_rels/presentation.xml.rels', 'slide');
  for (const slide of hidden) {
    // Its notes go with it.
    for (const { target } of targets(parts, relsOf(slide), 'notesSlide')) dropPart(parts, resolve(slide, target), removePart);
    const rel = presRels.find((r) => resolve('ppt/presentation.xml', r.target) === slide);
    if (rel) {
      const entry = new RegExp(`<p:sldId\\b[^>]*\\sr:id="${rel.id}"[^>]*/>`).exec(presentation)?.[0];
      const numeric = entry ? /\sid="(\d+)"/.exec(entry)?.[1] : undefined;
      if (entry) presentation = presentation.replace(entry, '');
      // Custom shows and sections name the slide too.
      presentation = presentation.replace(new RegExp(`<p:sld\\b[^>]*\\sr:id="${rel.id}"[^>]*/>`, 'g'), '');
      if (numeric) presentation = presentation.replace(new RegExp(`<p14:sldId\\b[^>]*\\sid="${numeric}"[^>]*/>`, 'g'), '');
    }
    dropPart(parts, slide, removePart);
  }
  parts['ppt/presentation.xml'] = strToU8(presentation);
  return hidden.length;
}

/**
 * Hidden sheets go only when nothing else reads them: a formula or a defined
 * name naming the sheet, or a name scoped to a sheet by position, would be
 * broken — #REF! in cells the reader sees. Then nothing is removed, and the
 * caller says why.
 */
export function removeHiddenSheets(parts: Parts, removePart: RemovePart): { removed: number; refused: string[] } {
  const workbookPath = 'xl/workbook.xml';
  let workbook = text(parts, workbookPath);
  if (!workbook) return { removed: 0, refused: [] };
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => ({
    tag: m[0],
    name: /\sname="([^"]*)"/.exec(m[0])?.[1] ?? '',
    id: /\sr:id="([^"]*)"/.exec(m[0])?.[1] ?? '',
    hidden: /\sstate="(hidden|veryHidden)"/.test(m[0]),
  }));
  const hidden = sheets.filter((s) => s.hidden);
  if (!hidden.length) return { removed: 0, refused: [] };
  if (hidden.length === sheets.length) return { removed: 0, refused: hidden.map((s) => s.name) };

  const formulas = Object.entries(parts)
    .filter(([p]) => /^xl\/(worksheets|chartsheets)\/[^/]+\.xml$|^xl\/charts\/[^/]+\.xml$|^xl\/pivotCache\//.test(p))
    .map(([, raw]) => strFromU8(raw))
    .join('\n');
  const names = /<definedNames>([\s\S]*?)<\/definedNames>/.exec(workbook)?.[1] ?? '';
  const decoded = (s: string) => s.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"');
  const referenced = (name: string) => {
    const quoted = `'${name.replace(/'/g, "''")}'!`;
    const bare = `${name}!`;
    return [formulas, names].some((xml) => decoded(xml).includes(quoted) || decoded(xml).includes(bare));
  };
  const refused = hidden.filter((s) => referenced(s.name)).map((s) => s.name);
  if (refused.length || /localSheetId=/.test(names)) return { removed: 0, refused: refused.length ? refused : hidden.map((s) => s.name) };

  const rels = targets(parts, 'xl/_rels/workbook.xml.rels', 'worksheet');
  for (const sheet of hidden) {
    workbook = workbook.replace(sheet.tag, '');
    const rel = rels.find((r) => r.id === sheet.id);
    if (rel) dropPart(parts, resolve(workbookPath, rel.target), removePart);
  }
  parts[workbookPath] = strToU8(workbook);
  // The calculation chain lists cells by sheet position; Excel rebuilds it.
  if (parts['xl/calcChain.xml']) removePart(parts, 'xl/calcChain.xml');
  return { removed: hidden.length, refused: [] };
}

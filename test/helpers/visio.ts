import { strToU8, zipSync } from 'fflate';

const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const V = 'http://schemas.microsoft.com/office/visio/2012/main';
const REL = 'http://schemas.microsoft.com/visio/2010/relationships';

export interface VisioSpec {
  creator?: string;
  company?: string;
  pageText?: string;
  /** Extra cells in the shape's Hyperlink section. */
  hyperlink?: string;
  comments?: Array<{ name: string; initials: string }>;
  connection?: string;
  media?: Uint8Array;
}

/** A Visio drawing with one page and one shape, written the way Visio 2013+ lays it out. */
export function vsdx(spec: VisioSpec = {}): Uint8Array {
  const parts: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>` +
        '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/><Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${R}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    ),
    'docProps/core.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:creator>${spec.creator ?? ''}</dc:creator><cp:lastModifiedBy>${spec.creator ?? ''}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2024-03-05T10:20:00Z</dcterms:created></cp:coreProperties>`,
    ),
    'docProps/app.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Visio</Application><Company>${spec.company ?? ''}</Company><AppVersion>16.0000</AppVersion></Properties>`,
    ),
    'visio/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><VisioDocument xmlns="${V}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><DocumentSettings/></VisioDocument>`),
    'visio/_rels/document.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${R}"><Relationship Id="rId1" Type="${REL}/pages" Target="pages/pages.xml"/>` +
        (spec.comments ? `<Relationship Id="rId2" Type="${REL}/comments" Target="comments.xml"/>` : '') +
        (spec.connection ? `<Relationship Id="rId3" Type="${REL}/connections" Target="data/connections.xml"/>` : '') +
        '</Relationships>',
    ),
    'visio/pages/pages.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Pages xmlns="${V}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><Page ID="0" NameU="Page-1" Name="Page-1"><PageSheet><Cell N="PageWidth" V="8.5"/><Cell N="PageHeight" V="11"/></PageSheet><Rel r:id="rId1"/></Page></Pages>`,
    ),
    'visio/pages/_rels/pages.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${R}"><Relationship Id="rId1" Type="${REL}/page" Target="page1.xml"/></Relationships>`),
    'visio/pages/page1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><PageContents xmlns="${V}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><Shapes><Shape ID="1" Type="Shape"><Cell N="PinX" V="4"/><Cell N="PinY" V="5"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/>` +
        '<Section N="Geometry" IX="0"><Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row><Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row><Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row><Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row><Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row></Section>' +
        (spec.hyperlink ? `<Section N="Hyperlink"><Row N="Row_1"><Cell N="Address" V="${spec.hyperlink}"/></Row></Section>` : '') +
        `<Text>${spec.pageText ?? 'Serveur'}</Text></Shape></Shapes></PageContents>`,
    ),
  };
  if (spec.comments) {
    parts['visio/comments.xml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Comments xmlns="${V}"><AuthorList>${spec.comments.map((c, i) => `<AuthorEntry Name="${c.name}" Initials="${c.initials}" ResolutionID="S::${c.initials.toLowerCase()}@example.com::0" ID="${i}"/>`).join('')}</AuthorList><CommentList><CommentEntry AuthorID="0" PageID="0" ShapeID="1" Date="2024-03-05T10:20:00">À revoir</CommentEntry></CommentList></Comments>`,
    );
  }
  if (spec.connection) {
    parts['visio/data/connections.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><DataConnections xmlns="${V}"><DataConnection ID="0" FileName="C:\\Users\\jdupont\\Documents\\parc.xlsx" ConnectionString="${spec.connection}" FriendlyName="parc" Timestamp="2024-03-05T10:20:00"/></DataConnections>`);
  }
  if (spec.media) parts['visio/media/image1.jpeg'] = spec.media;
  return zipSync(parts);
}

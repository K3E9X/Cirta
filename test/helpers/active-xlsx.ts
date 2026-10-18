/**
 * [F-2.1] A workbook that connects and hides: a database connection with its
 * password, a web query, Power Query code, hidden rows and columns, a cell
 * typed in white on white.
 */

import { strToU8, zipSync } from 'fflate';

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** The DataMashup binary: version, the package zip's length, the zip, then empty sections. */
function dataMashup(m: string): string {
  const pkg = zipSync({ 'Formulas/Section1.m': strToU8(m), '[Content_Types].xml': strToU8('<Types/>') });
  const out = new Uint8Array(8 + pkg.length + 16);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0, true);
  view.setUint32(4, pkg.length, true);
  out.set(pkg, 8);
  return Buffer.from(out).toString('base64');
}

export function workbook(): Uint8Array {
  const M = 'section Section1;\r\nshared Ventes = let Source = Sql.Database("sql-prod.interne.exemple", "Ventes"), Web = Web.Contents("https://api.exemple/tarifs") in Source;';
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8(`<workbook ${NS}><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/connections.xml': strToU8(
      `<connections ${NS}><connection id="1" name="Ventes" type="1"><dbPr connection="Provider=SQLOLEDB;Data Source=sql-prod.interne.exemple;Initial Catalog=Ventes;User ID=compta;Password=Hiver2026!" command="SELECT * FROM ventes"/></connection>` +
        `<connection id="2" name="Tarifs" type="4"><webPr url="https://api.exemple/tarifs.xml"/></connection></connections>`,
    ),
    'xl/queryTables/queryTable1.xml': strToU8(`<queryTable ${NS} name="Ventes" connectionId="1"/>`),
    'customXml/item1.xml': strToU8(`<?xml version="1.0" encoding="utf-16"?><DataMashup xmlns="http://schemas.microsoft.com/DataMashup">${dataMashup(M)}</DataMashup>`),
    'xl/sharedStrings.xml': strToU8(`<sst ${NS}><si><t>Budget</t></si><si><t>Marge réelle 31 %</t></si></sst>`),
    'xl/styles.xml': strToU8(
      `<styleSheet ${NS}><fonts count="2"><font><sz val="11"/></font><font><color rgb="FFFFFFFF"/><sz val="11"/></font></fonts>` +
        `<cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet ${NS}><cols><col min="3" max="4" hidden="1"/></cols><sheetData>` +
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1" t="s"><v>1</v></c></row>` +
        `<row r="2" hidden="1"><c r="A2"><v>42</v></c></row><row r="5" hidden="1"><c r="A5"><v>7</v></c></row></sheetData></worksheet>`,
    ),
  });
}


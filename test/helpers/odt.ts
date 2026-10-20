/** [P0-2] A one-file OpenDocument text: a body, its automatic styles, and named styles with an A4 page layout. */

import { strToU8, zipSync } from 'fflate';

export function odt(body: string, automaticStyles = '', styles = ''): Uint8Array {
  const ns =
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
    'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
  return zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'META-INF/manifest.xml': strToU8('<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>'),
    'content.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ns}><office:automatic-styles>${automaticStyles}</office:automatic-styles>` +
        `<office:body><office:text>${body}</office:text></office:body></office:document-content>`,
    ),
    'styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${ns}><office:styles>${styles}</office:styles>` +
        '<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm"/></style:page-layout></office:automatic-styles>' +
        '</office:document-styles>',
    ),
  });
}

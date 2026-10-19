/**
 * [F-2.3] All the text a document holds, hidden passages included: what a
 * search for personal data or for an organisation's words must read. Hidden
 * text is read on purpose — an IBAN in a white run is still an IBAN.
 */

import { strFromU8, unzipSync } from 'fflate';
import type { Format } from './types.js';
import { collectTextContent } from './xml.js';
import { decodeTextInput } from './text.js';
import { parseMail } from './mime.js';
import { pdfText } from './pdf.js';
import { msgText } from './msg.js';
import { notebookText, parseNotebook } from './notebook.js';
import { rtfText } from './rtf.js';

const MAX = 8 * 1024 * 1024;

function partsText(data: Uint8Array, pattern: RegExp): string {
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(data, { filter: (file) => pattern.test(file.name) && file.originalSize < MAX });
  } catch {
    return '';
  }
  return Object.keys(parts)
    .sort()
    .map((path) => collectTextContent(strFromU8(parts[path]!)))
    .join('\n');
}

export async function bodyText(data: Uint8Array, format: Format): Promise<string> {
  switch (format) {
    case 'docx':
      return partsText(data, /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/);
    case 'pptx':
      return partsText(data, /^ppt\/(?:slides|notesSlides|comments)\/[^/]+\.xml$/);
    case 'xlsx':
      return partsText(data, /^xl\/(?:sharedStrings\.xml|worksheets\/[^/]+\.xml|comments\d*\.xml)$/);
    case 'odt':
    case 'ods':
    case 'odp':
      return partsText(data, /^(?:content|styles)\.xml$/);
    case 'pdf':
      return pdfText(data);
    case 'eml': {
      const mail = parseMail(data);
      return [mail.headerText, ...mail.parts.filter((p) => p.text !== undefined).map((p) => p.text!)].join('\n');
    }
    case 'msg':
      return msgText(data);
    case 'ipynb': {
      const notebook = parseNotebook(decodeTextInput(data, { allowBinary: true }));
      return notebook ? notebookText(notebook) : '';
    }
    case 'rtf':
      return rtfText(data);
    case 'html':
    case 'markdown':
    case 'svg':
    case 'latex':
    case 'ics':
    case 'vcf':
    case 'text':
      return decodeTextInput(data, { allowBinary: true });
    default:
      return '';
  }
}

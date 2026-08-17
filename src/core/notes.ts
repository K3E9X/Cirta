/**
 * The caveat attached to each note code, in the library's own language.
 *
 * Notes are codes rather than sentences precisely so that each front-end can
 * word them for its own audience, and the French web interface does. English
 * still has to be written once, and it was being written twice — the command
 * line had these strings, and the page had no English at all. Shared from here
 * so the two cannot drift into saying different things about the same result.
 */

import type { Note } from './types.js';

export const NOTE_TEXT_EN: Record<Note['code'], (detail?: string) => string> = {
  'scope:pdf-metadata-only': () =>
    'Metadata, plus a scan of decompressed streams for credentials and provider identifiers, and of page text decoded through each font\'s ToUnicode map. That map is what turns a subset font\'s glyph codes back into characters; a page whose font carries none is still read as raw codes, where a hit is real but a miss proves nothing. A statistical model watermark would not show up either way.',
  'scope:ooxml-metadata-only': () =>
    'Document properties, a scan of the parts for credentials and provider identifiers, and a scan of the visible text for invisible characters. What is not analysed is the wording: a statistical model watermark lives there and is unaffected by redaction.',
  'scope:invisible-characters-only': () =>
    'Character-level only: invisible codepoints, lookalike letters, and the credentials and provider identifiers that cannot occur innocently. A statistical model watermark in this text, if present, is unaffected and cannot be detected locally.',
  'scope:markup-metadata-only': () =>
    'Markup metadata, plus a scan of the body for invisible characters. What is not analysed is the wording: a statistical model watermark lives there and would not show up here.',
  'scope:image-metadata-only': () =>
    'Image container metadata only. The pixels are not analysed: an invisible watermark encoded in the image data itself would not show up here, and is not removed.',
  'removed:c2pa': (detail) =>
    `Removed a C2PA manifest${detail ? ` (${detail})` : ''}. The file no longer carries verifiable provenance — third parties can no longer confirm its origin in either direction. Two things this does not mean. C2PA also supports soft binding, where a mark in the content itself lets a vendor re-attach the credential, so a removed manifest does not mean no provenance remains. And the reverse: a credential is metadata attached to the file rather than embedded in it, so re-saving, converting or resizing strips it without a trace — its absence from any file proves nothing about origin.`,
  'scope:archive': () =>
    'Archive report. Every member was dispatched through the normal detection path; members no parser recognises at all were scanned for credentials and provider identifiers only.',
  'limit:archive-truncated': (detail) =>
    `Archive traversal stopped at a built-in limit (${detail ?? 'member cap'}). Some members were not examined.`,
  'kept:in-content': (detail) =>
    `Not removed: ${detail ?? 'traces inside the content'}. These sit in the document's own content rather than in a metadata field, and rewriting it would change what the document says. Edit the source and regenerate — and if a credential is listed, rotate it.`,
  'kept:content': (detail) =>
    `Left in place: ${detail ?? 'document content'}. These are content rather than metadata — removing them would change what the recipient reads, so review them yourself.`,
};

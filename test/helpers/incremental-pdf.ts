/**
 * A PDF carrying a genuine incremental update.
 *
 * pdf-lib always rewrites a whole document on save, so it cannot produce the
 * shape this is about: a second revision appended to a complete first one, with
 * its own cross-reference section pointing back through `/Prev`. That shape is
 * what a word processor writes when it saves a file it already had open, and
 * it is why text someone deleted is still in the bytes they send.
 *
 * Built by hand because the offsets are the point — an xref entry that is off
 * by a byte produces a file no parser agrees with, and then a test proves
 * nothing about anything.
 */

const enc = new TextEncoder();

function xrefEntry(offset: number, generation: number, type: 'n' | 'f'): string {
  // Exactly 20 bytes, as the specification requires.
  return `${String(offset).padStart(10, '0')} ${String(generation).padStart(5, '0')} ${type}\r\n`;
}

/**
 * A one-page document showing `first`, plus an incremental update replacing it
 * with `second`. Omit `second` for a single-revision file — the control every
 * one of these checks needs, written by the same code so the two differ in the
 * update and in nothing else.
 */
export function incrementalPdf(first: string, second?: string): Uint8Array {
  const body = (shown: string) => `BT /F1 12 Tf 20 100 Td (${shown}) Tj ET\n`;

  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    null, // object 4 is the content stream, written separately
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];

  let out = '%PDF-1.7\n';
  const offsets: number[] = [];

  for (const [index, object] of objects.entries()) {
    offsets[index] = out.length;
    if (index === 3) {
      const stream = body(first);
      out += `4 0 obj\n<</Length ${stream.length}>>\nstream\n${stream}endstream\nendobj\n`;
    } else {
      out += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
  }

  const firstXref = out.length;
  out += 'xref\n0 6\n' + xrefEntry(0, 65535, 'f');
  for (const offset of offsets) out += xrefEntry(offset, 0, 'n');
  out += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${firstXref}\n%%EOF\n`;

  if (second === undefined) return enc.encode(out);

  // ---- the incremental update: object 4 again, with the text replaced ------
  const updatedAt = out.length;
  const updated = body(second);
  out += `4 0 obj\n<</Length ${updated.length}>>\nstream\n${updated}endstream\nendobj\n`;

  const secondXref = out.length;
  out +=
    'xref\n0 1\n' +
    xrefEntry(0, 65535, 'f') +
    '4 1\n' +
    xrefEntry(updatedAt, 0, 'n') +
    `trailer\n<</Size 6/Root 1 0 R/Prev ${firstXref}>>\nstartxref\n${secondXref}\n%%EOF\n`;

  return enc.encode(out);
}

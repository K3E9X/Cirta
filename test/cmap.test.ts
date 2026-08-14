import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parseToUnicode, decodeWithToUnicode } from '../src/core/cmap.js';
import { inspectFile } from '../src/core/index.js';

/**
 * A ToUnicode CMap is what makes PDF page text readable at all. Without it the
 * content stream of any document whose font was subset holds glyph indices
 * numbered from 1 — "Réduire les flux" appears as <000100020003…> and a scan
 * for a zero-width space finds nothing, forever.
 */
describe('ToUnicode CMap', () => {
  it('reads single-code mappings', () => {
    const table = parseToUnicode(`
      /CIDInit /ProcSet findresource begin
      1 begincodespacerange <0000> <FFFF> endcodespacerange
      3 beginbfchar
      <0001> <004E>
      <0002> <006F>
      <0003> <0074>
      endbfchar
    `);
    expect(table?.codeBytes).toBe(2);
    expect(decodeWithToUnicode(new Uint8Array([0, 1, 0, 2, 0, 3]), table!)).toBe('Not');
  });

  it('reads ranges that walk upward', () => {
    const table = parseToUnicode(`
      1 begincodespacerange <0000> <FFFF> endcodespacerange
      1 beginbfrange <0010> <0013> <0061> endbfrange
    `);
    expect(decodeWithToUnicode(new Uint8Array([0, 0x10, 0, 0x11, 0, 0x13]), table!)).toBe('abd');
  });

  it('reads ranges given as an explicit list', () => {
    const table = parseToUnicode(`
      1 begincodespacerange <0000> <FFFF> endcodespacerange
      1 beginbfrange <0020> <0022> [<0041> <0042> <0043>] endbfrange
    `);
    expect(decodeWithToUnicode(new Uint8Array([0, 0x20, 0, 0x22]), table!)).toBe('AC');
  });

  it('handles a destination that is more than one character', () => {
    // One glyph can stand for a ligature, so "fl" is a single code.
    const table = parseToUnicode(`
      1 begincodespacerange <0000> <FFFF> endcodespacerange
      1 beginbfchar <0005> <00660066006C> endbfchar
    `);
    expect(decodeWithToUnicode(new Uint8Array([0, 5]), table!)).toBe('ffl');
  });

  it('reads single-byte codes when the codespace says so', () => {
    const table = parseToUnicode(`
      1 begincodespacerange <00> <FF> endcodespacerange
      1 beginbfchar <41> <0041> endbfchar
    `);
    expect(table?.codeBytes).toBe(1);
    expect(decodeWithToUnicode(new Uint8Array([0x41]), table!)).toBe('A');
  });

  it('contributes nothing for an unmapped code rather than a wrong letter', () => {
    // This feeds a scanner: inventing a character here invents a finding.
    const table = parseToUnicode(`
      1 begincodespacerange <0000> <FFFF> endcodespacerange
      1 beginbfchar <0001> <0041> endbfchar
    `);
    expect(decodeWithToUnicode(new Uint8Array([0, 1, 0, 9, 0, 1]), table!)).toBe('AA');
  });

  it('returns nothing for a CMap with no mappings', () => {
    expect(parseToUnicode('/CIDInit begin end')).toBeUndefined();
    expect(parseToUnicode('')).toBeUndefined();
  });

  it('bounds a range that claims to be enormous', () => {
    const table = parseToUnicode(`
      1 begincodespacerange <0000> <FFFF> endcodespacerange
      1 beginbfrange <0000> <FFFFFF> <0041> endbfrange
    `);
    expect(table!.map.size).toBeLessThanOrEqual(65536);
  });
});

describe('PDF page text', () => {
  it('still reads a simple encoding, where codes are the characters', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    // A zero-width space has no glyph in a standard font, so the carrier here
    // is one that does: a Cyrillic lookalike would not encode either. Use the
    // soft hyphen, which WinAnsi carries.
    pdf.addPage([200, 200]).drawText('bien­sur', { x: 10, y: 100, size: 12, font });
    const labels = (await inspectFile(await pdf.save())).findings.map((f) => f.label);
    expect(labels).toContain('soft hyphen');
  });
});

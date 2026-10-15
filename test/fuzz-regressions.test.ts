import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { inspectFile, UnsupportedFormatError, inspectPdf } from '../src/core/index.js';

/**
 * Inputs that once crashed, kept so they cannot come back.
 *
 * Each of these was produced by scripts/fuzz.mjs rather than reasoned about.
 * That is the point: none of them is a shape anybody would have thought to
 * write by hand, which is exactly why the code assumed they could not happen.
 */
describe('fuzzer regressions', () => {
  it('survives a PDF whose catalog is not a dictionary', async () => {
    // `doc.catalog` is typed as a dictionary and, on a damaged file loaded with
    // throwOnInvalidObject: false, can be anything the trailer pointed at.
    // `catalog?.get(…)` guards against absent and not against wrong-shaped, so
    // this threw "doc.catalog?.get is not a function".
    const broken = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n' +
        'trailer\n<< /Root 9 0 R /Size 2 >>\nstartxref\n0\n%%EOF\n',
    );
    // The invariant is narrower than "it rejects". pdf-lib is lenient enough to
    // parse this one, and that is fine: what must not happen is a TypeError,
    // which would be this library being wrong rather than the file being.
    const outcome = await inspectFile(broken).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(outcome).not.toBeInstanceOf(TypeError);
  });

  it('refuses a corrupt archive as unsupported rather than as a raw Error', async () => {
    // Fuzzing escaped 21 distinct rejections through the public entry point as
    // bare Errors — correct refusals that no caller could match on.
    const zip = zipSync({ 'word/document.xml': strToU8('<w:document/>') });
    const corrupt = zip.slice();
    corrupt.fill(0xff, 30, 60);
    await expect(inspectFile(corrupt)).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it('does not disguise a programming error as an unsupported file', async () => {
    // The wrapper must let TypeError through. Passing something that is not a
    // byte array is this code's mistake, and hiding it would defeat the fuzzer.
    await expect(inspectFile(undefined as unknown as Uint8Array)).rejects.toBeInstanceOf(TypeError);
  });

  it('keeps the parser message when it refuses', async () => {
    // Truncated mid-object, which pdf-lib does refuse. The refusal must carry
    // its account of what was wrong, or the wrapper has thrown away the only
    // information a user could act on.
    const truncated = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type');
    await expect(inspectFile(truncated)).rejects.toThrow(/could not be parsed: Failed to parse/);
  });

  it('leaves the low-level parsers raising their own errors', async () => {
    // inspectPdf is the raw parser; a library user calling it directly gets
    // pdf-lib's account of what is wrong, which is more useful than a refusal.
    await expect(inspectPdf(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

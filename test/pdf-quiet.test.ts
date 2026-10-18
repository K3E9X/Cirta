import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectFile } from '../src/core/index.js';
import { makePdf } from './fixtures.js';

/*
 * [C11.3] On a truncated PDF, pdf-lib wrote "Trying to parse invalid object"
 * and "Invalid object ref" to the console — onto stderr, in the middle of a
 * report, in the terminal's own words rather than the tool's. Its messages
 * are captured; what the file is, is said by the report.
 */

afterEach(() => vi.restoreAllMocks());

describe('[C11.3] pdf-lib says nothing on the console', () => {
  it('on a truncated PDF', async () => {
    const warn = vi.spyOn(console, 'warn');
    const log = vi.spyOn(console, 'log');
    const whole = await makePdf();
    // Cut inside an object, so the parser meets one it cannot read.
    const text = new TextDecoder('latin1').decode(whole);
    const cut = whole.subarray(0, text.lastIndexOf('endobj') - 5);
    await inspectFile(cut, 'cut.pdf').catch(() => undefined);
    expect([...warn.mock.calls, ...log.mock.calls].map((c) => String(c[0]))).toEqual([]);
  });

  it('and leaves the console working afterwards', async () => {
    await inspectFile(await makePdf(), 'ok.pdf');
    expect(typeof console.warn).toBe('function');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    console.warn('still here');
    expect(warn).toHaveBeenCalledWith('still here');
  });
});

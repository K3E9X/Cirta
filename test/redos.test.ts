import { strToU8, unzipSync, zipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeDocx } from './fixtures.js';
import { bundleCore, timed } from './helpers/redos.js';

/*
 * [P0-1] Regular expressions that a hostile file can make backtrack. Each
 * case is a file built to make one of them take exponential or quadratic
 * time; inspecting and cleaning it must end within the budget, which the
 * vulnerable expression overran by orders of magnitude (measured before each
 * fix, and named in the case). scripts/redos.mjs finds the candidates.
 */

const BUDGET = 10_000;
let core = '';
beforeAll(async () => {
  core = await bundleCore();
}, 60_000);

/** A file of an Office package with one more part. */
function withPart(base: Uint8Array, path: string, content: string): Uint8Array {
  const parts = unzipSync(base);
  parts[path] = strToU8(content);
  return zipSync(parts);
}

async function expectQuick(bytes: Uint8Array, name: string): Promise<void> {
  const ms = await timed(core, bytes, name, BUDGET);
  expect(ms, `${name}: still running after ${BUDGET} ms`).toBeDefined();
}

describe('[P0-1] ReDoS: a hostile file is read in time', () => {
  it('an Office part whose prolog is a run of broken comments (rootOf: exponential, 9 s for 195 bytes)', async () => {
    const prolog = '<!-' + '---><!--><!----><!-'.repeat(40) + '-\t';
    await expectQuick(withPart(makeDocx(), 'word/notes.xml', prolog), 'piege.docx');
  }, 30_000);
});

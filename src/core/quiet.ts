/**
 * [C11.3] pdf-lib reports a damaged object with console.warn — "Trying to
 * parse invalid object", "Invalid object ref" — which lands on stderr in the
 * middle of a report, in the library's words. The report already says what
 * the file is; the library is kept quiet while it works.
 *
 * Nested and overlapping calls share one silence, lifted when the last ends.
 */

let depth = 0;
let saved: { warn: typeof console.warn; log: typeof console.log } | undefined;

export async function quietly<T>(work: () => Promise<T>): Promise<T> {
  if (depth++ === 0) {
    saved = { warn: console.warn, log: console.log };
    console.warn = () => undefined;
    console.log = () => undefined;
  }
  try {
    return await work();
  } finally {
    if (--depth === 0 && saved) {
      console.warn = saved.warn;
      console.log = saved.log;
      saved = undefined;
    }
  }
}

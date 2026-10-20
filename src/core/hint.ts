/**
 * [P0-3] The format a file's name suggests, for the formats that cannot be
 * told from their first bytes alone: Markdown, SVG, HTML, a saved mail. A
 * hint is a name — `cv.html`, `/home/camille/CV.HTM` — or already a kind
 * (`html`, `text`), and the library reads it the way the command line always
 * did: `inspectFile(bytes, 'cv.html')` is HTML, hidden text and all.
 */

const KINDS = new Set(['markdown', 'svg', 'html', 'eml', 'text']);

export function hintFromName(hint: string | undefined): string | undefined {
  if (hint === undefined) return undefined;
  const lower = hint.toLowerCase();
  if (KINDS.has(lower)) return lower;
  const ext = /\.[a-z0-9]+$/.exec(lower)?.[0];
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown';
  if (ext === '.svg') return 'svg';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.eml') return 'eml';
  // Anything else is kept as given: a name the content decides on.
  return hint;
}

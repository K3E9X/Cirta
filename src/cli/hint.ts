/**
 * The format a file's name suggests, for the formats that cannot be told
 * from their first bytes alone. Shared by the commands and the MCP server.
 */

import { extname } from 'node:path';

export function formatHint(path: string, forceText = false): string | undefined {
  if (forceText) return 'text';
  const ext = extname(path).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown';
  if (ext === '.svg') return 'svg';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.eml') return 'eml';
  return undefined;
}

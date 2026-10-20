/**
 * The format a file's name suggests, for the formats that cannot be told
 * from their first bytes alone. Shared by the commands and the MCP server;
 * the rule itself is the library's (src/core/hint.ts), so a name means the
 * same thing to both.
 */

import { hintFromName } from '../core/hint.js';

const NAMED = new Set(['markdown', 'svg', 'html', 'eml']);

export function formatHint(path: string, forceText = false): string | undefined {
  if (forceText) return 'text';
  const kind = hintFromName(path);
  return kind && NAMED.has(kind) ? kind : undefined;
}

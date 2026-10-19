/**
 * The version of this Cirta, read from its own package.json — two levels up
 * from both src/cli and dist/cli, so the sources and the build agree.
 */

import { readFileSync } from 'node:fs';

let cached: string | undefined;

export function version(): string {
  if (cached === undefined) {
    try {
      cached = String(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version ?? 'unknown');
    } catch {
      cached = 'unknown';
    }
  }
  return cached;
}

/**
 * The version of this Cirta, read from its own package.json — two levels up
 * from both src/cli and dist/cli, so the sources and the build agree.
 */

import { readFileSync } from 'node:fs';

/** [F-P2 2.8] Written in by scripts/build-sea.mjs: a single binary has no package.json beside it. */
declare const CIRTA_VERSION: string | undefined;

let cached: string | undefined;

export function version(): string {
  if (cached === undefined && typeof CIRTA_VERSION === 'string') cached = CIRTA_VERSION;
  if (cached === undefined) {
    try {
      cached = String(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version ?? 'unknown');
    } catch {
      cached = 'unknown';
    }
  }
  return cached;
}

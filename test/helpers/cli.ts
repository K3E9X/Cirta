/**
 * The command line, run as a user runs it — a separate process, real argv,
 * real exit code, real bytes on stdout — but from the TypeScript sources, so a
 * test needs no prior build. vite-node ships with vitest.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface CliRun {
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
}

/** `cwd` runs it from another folder — a git repository, for --changed-only. */
export function runCli(args: string[], input?: Uint8Array, { cwd = ROOT }: { cwd?: string } = {}): CliRun {
  const result = spawnSync(process.execPath, [`${ROOT}/node_modules/vite-node/vite-node.mjs`, '--root', ROOT, `${ROOT}/src/cli/index.ts`, ...args], {
    cwd,
    input,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    maxBuffer: 32 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

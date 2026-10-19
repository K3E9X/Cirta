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

export function runCli(args: string[], input?: Uint8Array): CliRun {
  const result = spawnSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'src/cli/index.ts', ...args], {
    cwd: ROOT,
    input,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    maxBuffer: 32 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

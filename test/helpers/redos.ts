/**
 * [P0-1] Running Ciirta on a hostile file with a stopwatch that can stop it.
 * A regular expression that backtracks blocks its thread: no timer inside it
 * fires. So the core is bundled once, and each file goes to a worker thread
 * that is terminated when the budget runs out — the test then fails, instead
 * of hanging the suite.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';

export async function bundleCore(): Promise<string> {
  const outfile = join(mkdtempSync(join(tmpdir(), 'ciirta-redos-')), 'core.mjs');
  await build({ entryPoints: ['src/core/index.ts'], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'error' });
  return pathToFileURL(outfile).href;
}

const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { inspectFile, redactFile, sanitizeForLlm } = await import(workerData.core);
  const start = performance.now();
  await inspectFile(workerData.bytes, workerData.name).catch(() => {});
  await redactFile(workerData.bytes, workerData.name).catch(() => {});
  await sanitizeForLlm(workerData.bytes, workerData.name).catch(() => {});
  parentPort.postMessage(Math.round(performance.now() - start));
})();
`;

/** Inspects the file, cleans it and reads it for a model; the milliseconds it took, or undefined when the budget ran out. */
export function timed(core: string, bytes: Uint8Array, name: string, budgetMs: number): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { eval: true, workerData: { core, bytes, name } });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve(undefined);
    }, budgetMs);
    worker.once('message', (ms: number) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(ms);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

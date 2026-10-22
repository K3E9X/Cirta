/**
 * [R1] The organisation's rules, run in a worker thread the command line can
 * terminate: a rule that overruns its budget is abandoned and reported, the
 * others still run. The worker's code is sent as source, so it needs no file
 * of its own beside the compiled command.
 */

import { Worker } from 'node:worker_threads';
import { budgetedRules, rulesWorkerMain, type RulesChannel } from '../core/rules-runner.js';
import type { RulesRunner } from '../core/rules.js';

const SOURCE = `const { parentPort } = require('node:worker_threads');
(${rulesWorkerMain.toString()})((message) => parentPort.postMessage(message), (listener) => parentPort.on('message', listener));`;

function spawn(): RulesChannel {
  const worker = new Worker(SOURCE, { eval: true });
  // A rule still running must not keep the command from exiting once its answer is in.
  worker.unref();
  return {
    send: (message) => worker.postMessage(message),
    onMessage: (listener) => worker.on('message', listener),
    onError: (listener) => worker.on('error', listener),
    terminate: () => void worker.terminate(),
  };
}

export const nodeRulesRunner = (budgetMs?: number): RulesRunner => budgetedRules(spawn, budgetMs);

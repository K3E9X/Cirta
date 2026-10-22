/**
 * [R1] The organisation's rules, in a worker of their own: the analysis
 * worker gives each rule a time budget and terminates this one when a rule
 * overruns, which no code can do to a regular expression in its own thread.
 */

import { rulesWorkerMain } from '../core/rules-runner.js';

// Like the analysis worker: nothing in this thread can open a connection.
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport'] as const) {
  try {
    Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
  } catch {
    // Already absent in this browser.
  }
}

rulesWorkerMain(
  (message) => self.postMessage(message),
  (listener) => self.addEventListener('message', (event: MessageEvent) => listener(event.data)),
);

/**
 * Analysis, moved off the main thread.
 *
 * Inspection walks every stream of a PDF and every member of an archive
 * synchronously. On a large file that is seconds of work, and on the main
 * thread those are seconds of a frozen tab with no way to say so. Here the
 * page stays responsive and can show progress.
 *
 * Nothing about the guarantees changes: this is the same core, still local,
 * still without a single network call — a worker is another thread in the same
 * page, not another machine.
 */

import { inspectFile, redactFile, type InspectResult, type RedactResult } from '../core/index.js';
import { parseRules, type Rule } from '../core/rules.js';
import type { XrayEngine, XrayRegion } from '../core/xray.js';

/*
 * This worker runs PDF.js, a large third-party library with network code of
 * its own: it can fetch a document by URL, and load fonts and decoders from a
 * server. Cirta never asks it to — every byte it needs is handed over from
 * memory — but "never asks" is a claim about how it is called. Removing the
 * means makes it a fact about what it can do: from here on, nothing in this
 * thread can open a connection. The page's own Content-Security-Policy says
 * the same for the main thread, and is not inherited by a worker.
 */
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport'] as const) {
  try {
    Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
  } catch {
    // Already absent in this browser.
  }
}

/*
 * Requested at start-up rather than on the first PDF: the page starts this
 * worker while idle, so the renderer is already here when the visitor goes
 * offline and drops a file.
 */
const xray: Promise<XrayEngine | undefined> = import('./xray-engine.js')
  .then((module) => module.webXrayEngine())
  .catch(() => undefined);

/** A PDF, or an archive that may hold one: the inputs the renderer can matter to. */
const mayRender = (bytes: Uint8Array): boolean =>
  (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) ||
  (bytes[0] === 0x50 && bytes[1] === 0x4b);

export type WorkerRequest =
  | { id: number; op: 'inspect'; data: ArrayBuffer; hint?: string; scan?: ScanChoices }
  | { id: number; op: 'redact'; data: ArrayBuffer; hint?: string; clean?: CleanChoices; scan?: ScanChoices };

/** [F-2.3] What else to look for: personal data, and the organisation's rules as written in their file. */
export interface ScanChoices {
  pii?: boolean;
  rules?: string;
}

let parsedRules: { text: string; rules: Rule[] } | undefined;
const rulesFrom = (text?: string): Rule[] | undefined => {
  if (!text) return undefined;
  if (parsedRules?.text !== text) parsedRules = { text, rules: parseRules(text) };
  return parsedRules.rules;
};

/** What the reader chose to have changed in the document itself; every choice is off unless ticked. */
export interface CleanChoices {
  removeHidden?: boolean;
  acceptChanges?: boolean;
  removeComments?: boolean;
  stripActive?: boolean;
  stripRemote?: boolean;
  removeNotes?: boolean;
  removeHiddenSlides?: boolean;
  removeHiddenSheets?: boolean;
  removeAttachments?: boolean;
  flattenAnnotations?: boolean;
  stripTracking?: boolean;
  burnRedactions?: boolean;
}

export type WorkerResponse =
  | { id: number; ok: true; op: 'inspect'; result: InspectResult; hidden: XrayRegion[] }
  | { id: number; ok: true; op: 'redact'; result: Omit<RedactResult, 'data'>; data?: ArrayBuffer }
  | { id: number; ok: false; error: string; code?: string; detail?: string };

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { id, op, data, hint } = event.data;
  const clean = event.data.op === 'redact' ? (event.data.clean ?? {}) : {};
  const scan = event.data.scan ?? {};
  try {
    const bytes = new Uint8Array(data);
    const engine = mayRender(bytes) ? await xray : undefined;
    if (op === 'inspect') {
      const hidden: XrayRegion[] = [];
      const result = await inspectFile(bytes, hint, { xray: engine, onHidden: (regions) => hidden.push(...regions), pii: scan.pii === true, rules: rulesFrom(scan.rules) });
      (self as unknown as Worker).postMessage(
        { id, ok: true, op, result, hidden } satisfies WorkerResponse,
        hidden.map((region) => region.crop.rgba.buffer as ArrayBuffer),
      );
      return;
    }

    const { data: redacted, ...rest } = await redactFile(bytes, hint, {
      xray: engine,
      removeHidden: clean.removeHidden === true,
      acceptChanges: clean.acceptChanges === true,
      removeComments: clean.removeComments === true,
      stripActive: clean.stripActive === true,
      stripRemote: clean.stripRemote === true,
      removeNotes: clean.removeNotes === true,
      removeHiddenSlides: clean.removeHiddenSlides === true,
      removeHiddenSheets: clean.removeHiddenSheets === true,
      removeAttachments: clean.removeAttachments === true,
      flattenAnnotations: clean.flattenAnnotations === true,
      stripTracking: clean.stripTracking === true,
      burnRedactions: clean.burnRedactions === true,
      pii: scan.pii === true,
      rules: rulesFrom(scan.rules),
    });
    // The buffer is transferred rather than copied: a redacted file can be tens
    // of megabytes and structured cloning it twice is pure waste.
    const buffer = redacted ? redacted.slice().buffer : undefined;
    (self as unknown as Worker).postMessage(
      { id, ok: true, op, result: rest, data: buffer } satisfies WorkerResponse,
      buffer ? [buffer] : [],
    );
  } catch (error) {
    // The code travels with the message, so the page can word the refusal in
    // its reader's language rather than the core's.
    const coded = error as { code?: unknown; detail?: unknown };
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: typeof coded?.code === 'string' ? coded.code : undefined,
      detail: typeof coded?.detail === 'string' ? coded.detail : undefined,
    } satisfies WorkerResponse);
  }
});

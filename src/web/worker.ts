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

export type WorkerRequest =
  | { id: number; op: 'inspect'; data: ArrayBuffer; hint?: string }
  | { id: number; op: 'redact'; data: ArrayBuffer; hint?: string };

export type WorkerResponse =
  | { id: number; ok: true; op: 'inspect'; result: InspectResult }
  | { id: number; ok: true; op: 'redact'; result: Omit<RedactResult, 'data'>; data?: ArrayBuffer }
  | { id: number; ok: false; error: string };

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { id, op, data, hint } = event.data;
  try {
    const bytes = new Uint8Array(data);
    if (op === 'inspect') {
      const result = await inspectFile(bytes, hint);
      (self as unknown as Worker).postMessage({ id, ok: true, op, result } satisfies WorkerResponse);
      return;
    }

    const { data: redacted, ...rest } = await redactFile(bytes, hint);
    // The buffer is transferred rather than copied: a redacted file can be tens
    // of megabytes and structured cloning it twice is pure waste.
    const buffer = redacted ? redacted.slice().buffer : undefined;
    (self as unknown as Worker).postMessage(
      { id, ok: true, op, result: rest, data: buffer } satisfies WorkerResponse,
      buffer ? [buffer] : [],
    );
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerResponse);
  }
});

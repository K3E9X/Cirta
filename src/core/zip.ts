/**
 * Opening a ZIP container without trusting it.
 *
 * Every ZIP path in this codebase used to call `unzipSync` directly, which
 * decompresses every member into memory before anything gets a chance to look
 * at the result. The limits in the archive walker ran *after* that call, so
 * they capped what was reported rather than what was decompressed: a 50 kB
 * container declaring 20 GB of members took the process down before the first
 * check executed. In the browser that is the tab, and the tab is the product.
 *
 * The fix is to read the sizes the central directory already states and refuse
 * on the declared total, which fflate exposes through its filter callback —
 * the callback runs per member before that member is inflated.
 *
 * A declared size is the archive's own claim and a crafted file can understate
 * it, so this is a guard rather than a proof. It closes the accidental and the
 * casually hostile cases; a container that lies about its sizes still inflates
 * to whatever it really holds.
 */

import { unzipSync, type Unzipped } from 'fflate';

export const ZIP_LIMITS = {
  /** Declared uncompressed total across all members. */
  maxDeclaredBytes: 512 * 1024 * 1024,
  /** Member count, which bounds the per-member work regardless of size. */
  maxMembers: 8192,
  /**
   * [F-P2 2.2] A member that inflates more than this many times its stored
   * size, once past {@link ZIP_LIMITS.ratioFloorBytes}: deflate tops out
   * near 1032:1, so only a run of identical bytes gets there — a bomb, not a
   * document. Found by the fuzzer: a mutated length turned 300 bytes into
   * 335 MB of zeros, and cleaning it took twenty seconds.
   */
  maxRatio: 1000,
  ratioFloorBytes: 16 * 1024 * 1024,
} as const;

/**
 * [F-P2 2.4] The date every rewritten member carries: 1980-01-01, the first a
 * ZIP can hold. The hour of the clean is not the document's to keep, and two
 * cleans of the same file must give the same bytes.
 */
export const ZIP_EPOCH = new Date(1980, 0, 1);

export class ArchiveTooLargeError extends Error {
  /** [F-P2 2.2] A code, so the refusal reads in the reader's language. */
  readonly code = 'archive-too-large';
  /** Which limit, and its value: `members:8192`, `bytes:512`, `ratio:<member>`. */
  readonly detail: string;

  constructor(reason: string, detail: string) {
    super(reason);
    this.name = 'ArchiveTooLargeError';
    this.detail = detail;
  }
}

/**
 * `unzipSync` with a budget applied before decompression.
 *
 * Returning false from the filter skips the member without inflating it, so
 * once the budget is spent nothing further is decompressed. The refusal is
 * raised afterwards rather than thrown from inside the callback, because a
 * throw crossing fflate's internals is not part of its contract.
 */
export function unzipGuarded(data: Uint8Array): Unzipped {
  let declared = 0;
  let members = 0;
  let refusal: string | undefined;
  let detail = '';

  const parts = unzipSync(data, {
    filter: (file) => {
      if (refusal) return false;
      members++;
      declared += file.originalSize;
      if (members > ZIP_LIMITS.maxMembers) {
        refusal = `archive declares more than ${ZIP_LIMITS.maxMembers} members`;
        detail = `members:${ZIP_LIMITS.maxMembers}`;
      } else if (declared > ZIP_LIMITS.maxDeclaredBytes) {
        refusal = `archive declares more than ${Math.round(ZIP_LIMITS.maxDeclaredBytes / 1024 / 1024)} MB of uncompressed content`;
        detail = `bytes:${Math.round(ZIP_LIMITS.maxDeclaredBytes / 1024 / 1024)}`;
      } else if (file.originalSize > ZIP_LIMITS.ratioFloorBytes && file.originalSize > ZIP_LIMITS.maxRatio * Math.max(1, file.size)) {
        refusal = `member "${file.name}" inflates more than ${ZIP_LIMITS.maxRatio} times its stored size`;
        detail = `ratio:${file.name}`;
      }
      return !refusal;
    },
  });

  if (refusal) throw new ArchiveTooLargeError(refusal, detail);
  return parts;
}

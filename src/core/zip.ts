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
} as const;

export class ArchiveTooLargeError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ArchiveTooLargeError';
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

  const parts = unzipSync(data, {
    filter: (file) => {
      if (refusal) return false;
      members++;
      declared += file.originalSize;
      if (members > ZIP_LIMITS.maxMembers) {
        refusal = `archive declares more than ${ZIP_LIMITS.maxMembers} members`;
      } else if (declared > ZIP_LIMITS.maxDeclaredBytes) {
        refusal = `archive declares more than ${Math.round(ZIP_LIMITS.maxDeclaredBytes / 1024 / 1024)} MB of uncompressed content`;
      }
      return !refusal;
    },
  });

  if (refusal) throw new ArchiveTooLargeError(refusal);
  return parts;
}

/**
 * Refusals, with a code each.
 *
 * The core speaks English, so its messages are English; but a refusal is
 * something a person reads in their own language, in the terminal or the page.
 * A code lets each front-end word it for its reader, and the English message
 * stays as the library's own description and the fallback.
 */

export type ErrorCode =
  /** No parser recognises the input. */
  | 'unsupported'
  /** A parser recognised the format and could not read this file. */
  | 'unparseable'
  /** An encrypted PDF: rewriting it without its key would destroy it. */
  | 'encrypted-pdf'
  /** A cleaned copy failed to parse again, so it was not delivered. */
  | 'output-unreadable'
  /** A plain archive: reported, never rewritten. */
  | 'archive-not-rewritable'
  /** An empty file. */
  | 'empty-file'
  /** [F-2.4] Burning redactions was asked for and needs the page renderer, which is not available. */
  | 'burn-unavailable';

export class UnsupportedFormatError extends Error {
  readonly code: ErrorCode;
  /** The parser's own words or the specifics, kept for the report. */
  readonly detail?: string;

  constructor(message: string, code: ErrorCode = 'unsupported', detail?: string) {
    super(message);
    this.name = 'UnsupportedFormatError';
    this.code = code;
    this.detail = detail;
  }
}

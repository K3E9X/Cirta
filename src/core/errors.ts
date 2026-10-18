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
  /** [F-2.2] A legacy Office file or an Outlook message: inspected, never rewritten. Detail: the format. */
  | 'legacy-not-rewritable'
  /** [F-P2 2.4] Re-encoding pictures was asked for and no codec is available. */
  | 'reencode-unavailable'
  /** An empty file. */
  | 'empty-file'
  /** [F-2.4] Burning redactions was asked for and needs the page renderer, which is not available. */
  | 'burn-unavailable'
  /** [F-2.5] What a reader of a PDF sees cannot be told without the renderer. */
  | 'renderer-unavailable'
  /** [F-2.3] A rules file that cannot be read. */
  | 'rules-invalid';

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

/**
 * Everything the tool can say about a piece of running text.
 *
 * This lives in its own module for two reasons, one structural and one that was
 * a bug.
 *
 * The structural one: the browser's main bundle needs this function and must
 * not pull in `core/index.js`, which drags pdf-lib and fflate along with it for
 * code that only ever runs in the worker.
 *
 * The bug: text reached the tool by three separate routes — a file on disk,
 * standard input, and the paste box in the page — and the three had drifted
 * apart. The same mail draft named the assistant that wrote it when saved as a
 * file, and reported nothing but its odd characters when piped in or pasted.
 * One function is what stops that from happening a second time.
 *
 * The layers, in the order they answer different questions:
 *
 *   - Character level — invisible codepoints, lookalikes, whitespace channels.
 *   - Recovered payloads — data hidden *in* those characters.
 *   - Mail headers, when the text turns out to be a message.
 *   - Declared source type, the IPTC vocabulary a generator may write.
 *   - Credentials and provider identifiers anywhere in the text.
 *   - fingerprint(), which reads all of the above and the body itself.
 */

import type { Finding } from './types.js';
import { byConfidence } from './types.js';
import { scanContent } from './archive.js';
import { emailHeaders, stripToolHeaders } from './email.js';
import { findResidue, stripMarkdownResidue } from './residue.js';
import { scanText, cleanText, type CleanTextResult } from './text.js';
import { findSourceTypes } from './sourcetype.js';
import { fingerprint, BODY_TEXT } from './fingerprint.js';
import { hiddenInHtml, htmlInMail } from './hidden-text.js';

/** Recovered steganographic payloads, promoted from strings to findings. */
function decodedFindings(decoded: string[]): Finding[] {
  return decoded.map((payload) => ({
    kind: 'invisible-character' as const,
    confidence: 'confirmed' as const,
    location: 'file contents',
    label: 'Hidden payload in text',
    value: payload,
  }));
}

/**
 * The HTML part of a saved mail. Only where a MIME header says there is one:
 * a source file full of markup strings is not a message.
 */
function hiddenInMail(text: string): Finding[] {
  if (!/^content-type:\s*text\/html/im.test(text)) return [];
  const html = htmlInMail(text);
  return html ? hiddenInHtml(html, 'file contents') : [];
}

export function inspectPlainText(text: string): Finding[] {
  const scan = scanText(text);
  // The same reading every other format gets. Withholding it here made the tool
  // answer differently for the same bytes depending on the extension: a draft
  // saved as .md declared its generative source and named the assistant, and
  // the identical file as .txt reported nothing. That was an inconsistency, not
  // a scope decision — a mail body or a pasted draft carries exactly the paths,
  // session identifiers and tool names the container formats do, and often
  // carries them more openly.
  const findings = [
    ...scan.findings,
    ...scanContent(text, 'file contents'),
    ...decodedFindings(scan.decoded),
    ...emailHeaders(text),
    ...findSourceTypes(text, 'file contents'),
    ...findResidue(text),
    ...hiddenInMail(text),
  ];
  // The body is handed to fingerprint() as a source so that a path or a session
  // identifier written into the prose is found — in a mail draft that is
  // exactly where they land, in a signature block or a trailing "generated
  // from …" line. It goes in under BODY_TEXT, which suppresses tool matching: a
  // message *about* an assistant must not be reported as written *by* one.
  const body: Finding = {
    kind: 'provenance',
    confidence: 'informational',
    location: 'file contents',
    label: BODY_TEXT,
    value: text,
  };
  findings.push(...fingerprint([...findings, body]));
  return findings.sort(byConfidence);
}

export interface PlainTextClean extends CleanTextResult {
  /** Mail headers that named a tool, removed. */
  headersRemoved: string[];
  /** Markdown markers removed, as the symbols a reader would have seen. */
  markdownRemoved: string;
  /** Set when the text reads as a Markdown document, whose markup was kept. */
  markdownKept: boolean;
  /**
   * What the clean found and left for you: lines an assistant addressed to you,
   * placeholders a template expected you to fill. Words, so never removed here.
   */
  toReview: Finding[];
  /**
   * [C8] What the cleaned text still carries above informational, measured by
   * reading it again: a lookalike domain, styled letters, a secret, the lines
   * an assistant wrote. A clean that only says what it removed reads as "the
   * text is clean"; this says what it is not.
   */
  survivors: Finding[];
}

export interface PlainTextCleanOptions {
  /** Replace no-break and other typographic spaces with U+0020. Off by default. */
  normalizeSpaces?: boolean;
}

/*
 * One clean for every surface. The page removed tool-naming mail headers and
 * the CLI did not, so the same draft came out of the two different. Each step
 * runs on the previous one's output: invisible characters first, because a
 * zero-width space inside `**bold**` would otherwise stop the Markdown rule
 * from seeing the markers at all.
 */
export function cleanPlainText(text: string, options: PlainTextCleanOptions = {}): PlainTextClean {
  // [C8] Only what is confirmed or probable goes. A no-break space before a
  // colon is French typography, reported as informational, and stays unless
  // asked; decomposed letters are recomposed only when the forms were mixed.
  const characters = cleanText(text, { normalizeSpaces: options.normalizeSpaces ?? false, normalize: 'when-flagged' });
  const headers = stripToolHeaders(characters.text);
  const markdown = stripMarkdownResidue(headers.text);
  const toReview = findResidue(markdown.text).filter(
    (finding) =>
      finding.label === 'Written to you, not to the recipient' ||
      finding.label === 'Template placeholder left unfilled',
  );
  return {
    ...characters,
    text: markdown.text,
    headersRemoved: headers.removed,
    markdownRemoved: markdown.removed,
    markdownKept: markdown.keptAsDocument,
    toReview,
    survivors: inspectPlainText(markdown.text).filter((finding) => finding.confidence !== 'informational'),
  };
}

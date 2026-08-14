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
import { scanText } from './text.js';
import { scanContent } from './archive.js';
import { emailHeaders } from './email.js';
import { findSourceTypes } from './sourcetype.js';
import { fingerprint, BODY_TEXT } from './fingerprint.js';

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

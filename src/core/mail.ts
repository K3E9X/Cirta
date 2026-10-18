/**
 * A saved mail, read as a mail.
 *
 * [C4] A message whose single part was HTML went down the HTML path, which
 * never reads mail headers: X-Mailer, User-Agent, Message-ID and the sender
 * vanished from the report, along with the lookalike link and the assistant's
 * lines in the body. A message is its header block, then MIME parts, each read
 * for what it is — plain text by the text pass, HTML by the HTML pass plus its
 * links, attachments like the members of an archive.
 */

import type { Finding, InspectResult, Note, RedactResult } from './types.js';
import { byConfidence } from './types.js';
import { emailHeaders, stripToolHeaders } from './email.js';
import { decodeWords, parseMail, type MailPart } from './mime.js';
import { inspectPlainText } from './plaintext.js';
import { inspectMarkup } from './markup.js';
import { findHtmlLinks } from './url.js';
import { remoteFindings } from './beacons.js';
import { trackingFindings } from './tracking.js';
import { findResidue } from './residue.js';
import { fingerprint } from './fingerprint.js';
import { cleanText, decodeTextInput } from './text.js';

/** Inspect another file — an attachment — as the dispatcher would. */
export type InspectMember = (data: Uint8Array, name: string) => Promise<InspectResult>;

const prefix = (findings: Finding[], where: string): Finding[] =>
  findings.map((finding) => ({ ...finding, location: `${where} → ${finding.location}` }));

const BLOCKS = /^\/?(?:p|div|br|li|tr|td|th|h[1-6]|table|ul|ol|blockquote|section|article|header|footer|pre|hr)\b/i;

/**
 * The text of an HTML body, a line per block. The residue an assistant leaves
 * is recognised by where a line sits — first, last, alone — so paragraphs run
 * together lose it. One pass with indexOf: every "<" is consumed with the tag
 * it opens, so a body full of unclosed brackets is still read once.
 */
function htmlLines(html: string): string {
  let out = '';
  let i = 0;
  const lower = html.toLowerCase();
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    if (lower.startsWith('<style', lt) || lower.startsWith('<script', lt)) {
      const close = lower.indexOf(lower.startsWith('<style', lt) ? '</style' : '</script', lt);
      const end = close < 0 ? -1 : html.indexOf('>', close);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt < 0) break;
    if (BLOCKS.test(html.slice(lt + 1, Math.min(gt, lt + 12)))) out += '\n';
    i = gt + 1;
  }
  return out
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join('\n');
}

function partFindings(part: MailPart): Finding[] {
  const text = part.text ?? '';
  if (part.type === 'text/html') {
    return [
      ...inspectMarkup(text, 'html'),
      ...findHtmlLinks(text),
      ...remoteFindings(text, 'document body'),
      ...trackingFindings(text, 'links'),
      // The words of an HTML body are what a recipient reads; the residue an
      // assistant leaves is looked for there, not in the markup.
      ...findResidue(htmlLines(text)),
    ];
  }
  return inspectPlainText(text);
}

export async function inspectEml(data: Uint8Array, inspectMember: InspectMember): Promise<InspectResult> {
  const mail = parseMail(data);
  const headers = emailHeaders(`${mail.headerText}\n\n`).map((finding) => ({ ...finding, value: decodeWords(finding.value) }));
  const findings: Finding[] = [...headers, ...fingerprint(headers)];
  const notes: Note[] = [{ code: 'scope:email' }];

  const bodies = mail.parts.filter((part) => !part.attachment);
  for (const [index, part] of mail.parts.entries()) {
    if (part.attachment) {
      const name = part.filename ?? `part ${index + 1}`;
      try {
        findings.push(...prefix((await inspectMember(part.body, name)).findings, `attachment ${name}`));
      } catch {
        // No parser claims it; it is still listed, so the reader knows it is there.
        findings.push({
          kind: 'environment',
          confidence: 'informational',
          location: `attachment ${name}`,
          label: 'Attachment not inspected',
          value: `${part.type}, ${part.body.length} bytes`,
        });
      }
      continue;
    }
    const found = partFindings(part);
    findings.push(...(bodies.length > 1 ? prefix(found, `part ${index + 1} (${part.type})`) : found));
  }

  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.label}\u0000${f.location}\u0000${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { format: 'eml', findings: unique.sort(byConfidence), notes };
}

/**
 * Clean a mail: the header lines that name a tool go, as in a pasted draft,
 * and invisible characters go from the text. The body's encoded parts are
 * left as they are — re-encoding them is not a clean, it is a rewrite — and
 * whatever survives is measured by re-inspection and named.
 */
export async function redactEml(data: Uint8Array, inspectMember: InspectMember): Promise<RedactResult> {
  const before = await inspectEml(data, inspectMember);
  const text = decodeTextInput(data, { allowBinary: true });
  const stripped = stripToolHeaders(cleanText(text, { normalizeSpaces: false }).text);
  return {
    format: 'eml',
    data: new TextEncoder().encode(stripped.text),
    text: stripped.text,
    // Measured, not assumed: noteSurvivors() keeps only what re-inspection no
    // longer finds, so the count is what really went.
    removed: before.findings,
    notes: [{ code: 'scope:email' }],
  };
}

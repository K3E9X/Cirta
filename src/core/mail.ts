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
import { byConfidence, PLACES } from './types.js';
import { emailHeaders, stripToolHeaders } from './email.js';
import { bytesOf, decodeTransfer, decodeWords, encodeTransfer, latin1, parseMail, type MailPart } from './mime.js';
import { stripActiveMarkup } from './markup-active.js';
import { inspectPlainText } from './plaintext.js';
import { inspectMarkup } from './markup.js';
import { findHtmlLinks } from './url.js';
import { htmlLinkTargets, linkFindings } from './links.js';
import { fileNameFindings } from './filenames.js';
import { remoteFindings } from './beacons.js';
import { trackingFindings } from './tracking.js';
import { findResidue } from './residue.js';
import { fingerprint } from './fingerprint.js';
import { cleanText, decodeTextInput } from './text.js';

/** Inspect another file — an attachment — as the dispatcher would. */
export type InspectMember = (data: Uint8Array, name: string) => Promise<InspectResult>;

const prefix = (findings: Finding[], where: string): Finding[] =>
  findings.map((finding) => ({ ...finding, location: `${where} → ${finding.location}` }));

/**
 * [R2] A message usually comes as text and as HTML, the same words twice: a
 * lookalike link was reported once per version. A finding the body parts
 * share — same label, same value — is reported once, at each of its places.
 */
function samePlaces(findings: Finding[]): Finding[] {
  const merged = new Map<string, Finding>();
  for (const finding of findings) {
    const key = `${finding.label}\u0000${finding.value}`;
    const first = merged.get(key);
    if (!first) merged.set(key, { ...finding });
    else if (!first.location.split(PLACES).includes(finding.location)) first.location += `${PLACES}${finding.location}`;
  }
  return [...merged.values()];
}

const BLOCKS = /^\/?(?:p|div|br|li|tr|td|th|h[1-6]|table|ul|ol|blockquote|section|article|header|footer|pre|hr)\b/i;

/**
 * The text of an HTML body, a line per block. The residue an assistant leaves
 * is recognised by where a line sits — first, last, alone — so paragraphs run
 * together lose it. One pass with indexOf: every "<" is consumed with the tag
 * it opens, so a body full of unclosed brackets is still read once.
 */
export function htmlLines(html: string): string {
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

/** A body part's findings by its type: the HTML pass with links and residue, or the text pass. */
export function partFindings(part: Pick<MailPart, 'type' | 'text'>): Finding[] {
  const text = part.text ?? '';
  if (part.type === 'text/html') {
    return [
      ...inspectMarkup(text, 'html'),
      ...findHtmlLinks(text),
      ...linkFindings(htmlLinkTargets(text), 'links'),
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
  const bodyFindings: Finding[] = [];
  for (const [index, part] of mail.parts.entries()) {
    if (part.attachment) {
      const name = part.filename ?? `part ${index + 1}`;
      // [F-P2 2.1] The name itself, before what it holds.
      if (part.filename) findings.push(...fileNameFindings(part.filename, `attachment ${name}`));
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
    if (bodies.length > 1) bodyFindings.push(...prefix(found, `part ${index + 1} (${part.type})`));
    else findings.push(...found);
  }
  findings.push(...samePlaces(bodyFindings));

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
/** A part a browser would run: an HTML body, an HTML or SVG attachment. */
const runnable = (part: MailPart) =>
  part.type === 'text/html' || part.type === 'image/svg+xml' || /\.(?:html?|xhtml|svg)$/i.test(part.filename ?? '');

/**
 * [R3] --strip-active on a mail: each HTML or SVG part decoded, its scripts,
 * handlers and running addresses taken out, and encoded again as it was. The
 * markup is ASCII, so the part is worked on byte for byte, whatever its
 * charset; the other parts and the headers are left as they are.
 */
function stripActiveParts(data: Uint8Array): { data: Uint8Array; removed: number } {
  const raw = latin1(data);
  let out = '';
  let cursor = 0;
  let removed = 0;
  for (const part of parseMail(data).parts) {
    if (!runnable(part) || !part.encoded) continue;
    const at = raw.indexOf(part.encoded, cursor);
    if (at < 0) continue;
    const stripped = stripActiveMarkup(latin1(decodeTransfer(part.encoded, part.transferEncoding)), part.type === 'image/svg+xml' || /\.svg$/i.test(part.filename ?? ''));
    if (!stripped.removed) continue;
    out += raw.slice(cursor, at) + encodeTransfer(stripped.text, part.transferEncoding);
    cursor = at + part.encoded.length;
    removed += stripped.removed;
  }
  return removed ? { data: bytesOf(out + raw.slice(cursor)), removed } : { data, removed: 0 };
}

export async function redactEml(data: Uint8Array, inspectMember: InspectMember, { stripActive = false }: { stripActive?: boolean } = {}): Promise<RedactResult> {
  const before = await inspectEml(data, inspectMember);
  const active = stripActive ? stripActiveParts(data) : { data, removed: 0 };
  const text = decodeTextInput(active.data, { allowBinary: true });
  const stripped = stripToolHeaders(cleanText(text, { normalizeSpaces: false }).text);
  return {
    format: 'eml',
    data: new TextEncoder().encode(stripped.text),
    text: stripped.text,
    // Measured, not assumed: noteSurvivors() keeps only what re-inspection no
    // longer finds, so the count is what really went.
    removed: before.findings,
    notes: [{ code: 'scope:email' }, ...(active.removed ? [{ code: 'removed:active-content' as const, detail: String(active.removed) }] : [])],
  };
}

/**
 * [F-2.2] Outlook .msg (MS-OXMSG), read, never rewritten.
 *
 * A .msg is a compound file holding one stream per MAPI property, a storage
 * per recipient and per attachment, and an attached message as a storage of
 * its own. What it says beyond an .eml: the sender's Exchange account (an
 * X.500 address naming the organisation and the mailbox), blind copies a
 * sent message keeps, who it was sent on behalf of, who last changed it, and
 * the Internet headers Outlook stored as they arrived.
 *
 * Attachments are inspected as an .eml's are; an attached message is read in
 * turn, three levels down at most.
 */

import { readCfb, type Cfb } from './cfb.js';
import { emailHeaders } from './email.js';
import { partFindings } from './mail.js';
import { fingerprint } from './fingerprint.js';
import { fileNameFindings } from './filenames.js';
import { ARCHIVE_SEPARATOR } from './archive.js';
import { byConfidence, type Confidence, type Finding, type InspectOptions, type InspectResult } from './types.js';

const MAX_DEPTH = 3;
const MAX_ITEMS = 256;

/** FILETIME ticks (100 ns since 1601) between 1601 and 1970. */
const EPOCH_DIFF = 116_444_736_000_000_000n;

interface Field {
  /** The property's canonical name, used as its location: an identifier, the same in every language. */
  name: string;
  label: string;
  kind: Finding['kind'];
  confidence: Confidence;
}

const STRINGS: Record<number, Field> = {
  0x0037: { name: 'PR_SUBJECT', label: 'Subject', kind: 'identity', confidence: 'probable' },
  0x0042: { name: 'PR_SENT_REPRESENTING_NAME', label: 'Sent on behalf of', kind: 'identity', confidence: 'confirmed' },
  0x3ff8: { name: 'PR_CREATOR_NAME', label: 'Author', kind: 'identity', confidence: 'confirmed' },
  0x3ffa: { name: 'PR_LAST_MODIFIER_NAME', label: 'Last modified by', kind: 'identity', confidence: 'confirmed' },
  0x1035: { name: 'PR_INTERNET_MESSAGE_ID', label: 'Message identifier', kind: 'identity', confidence: 'probable' },
  0x1042: { name: 'PR_IN_REPLY_TO_ID', label: 'In reply to', kind: 'identity', confidence: 'probable' },
};

const TIMES: Record<number, Field> = {
  0x0039: { name: 'PR_CLIENT_SUBMIT_TIME', label: 'Sent', kind: 'timestamp', confidence: 'probable' },
  0x0e06: { name: 'PR_MESSAGE_DELIVERY_TIME', label: 'Received', kind: 'timestamp', confidence: 'probable' },
  0x3007: { name: 'PR_CREATION_TIME', label: 'Created', kind: 'timestamp', confidence: 'probable' },
  0x3008: { name: 'PR_LAST_MODIFICATION_TIME', label: 'Modified', kind: 'timestamp', confidence: 'probable' },
};

const wide = new TextDecoder('utf-16le');
const ansi = new TextDecoder('windows-1252');
const utf8 = new TextDecoder('utf-8');

/** A view of one storage: the message, a recipient, an attachment. */
interface Storage {
  cfb: Cfb;
  prefix: string;
  /** Header length of its property stream: 32 for a message, 24 for an attached one, 8 otherwise. */
  header: number;
}

const hex4 = (id: number) => id.toString(16).toUpperCase().padStart(4, '0');

function string(s: Storage, id: number): string | undefined {
  const unicode = s.cfb.read(`${s.prefix}__substg1.0_${hex4(id)}001F`);
  if (unicode) return wide.decode(unicode).replace(/(?<!\0)\0+$/, '').trim() || undefined;
  const narrow = s.cfb.read(`${s.prefix}__substg1.0_${hex4(id)}001E`);
  return narrow ? ansi.decode(narrow).replace(/(?<!\0)\0+$/, '').trim() || undefined : undefined;
}

const binary = (s: Storage, id: number) => s.cfb.read(`${s.prefix}__substg1.0_${hex4(id)}0102`);

/** The fixed-size properties of a storage's property stream: integers and times, by id. */
function fixed(s: Storage): Map<number, bigint> {
  const bytes = s.cfb.read(`${s.prefix}__properties_version1.0`);
  const out = new Map<number, bigint>();
  if (!bytes) return out;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = s.header; at + 16 <= bytes.length && out.size < 4096; at += 16) {
    const tag = view.getUint32(at, true);
    const type = tag & 0xffff;
    if (type === 0x0040 || type === 0x0014) out.set(tag >>> 16, view.getBigUint64(at + 8, true));
    else if (type === 0x0003) out.set(tag >>> 16, BigInt(view.getUint32(at + 8, true)));
  }
  return out;
}

function time(ticks: bigint | undefined): string | undefined {
  if (ticks === undefined || ticks <= EPOCH_DIFF) return undefined;
  const date = new Date(Number((ticks - EPOCH_DIFF) / 10_000n));
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() >= 10_000 ? undefined : date.toISOString();
}

/** The mailbox an X.500 address ends with: "/O=…/CN=RECIPIENTS/CN=JDUPONT" names JDUPONT. */
const x500 = (address: string) => (address.startsWith('/') ? /\/CN=([^/]+)$/i.exec(address)?.[1] : undefined);

const person = (name?: string, address?: string) =>
  name && address && address !== name && !address.startsWith('/') ? `${name} <${address}>` : (name ?? address);

/** Storages directly under `prefix` whose names start with `kind`, in order. */
function children(s: Storage, kind: string): string[] {
  const depth = s.prefix.split('/').length;
  return s.cfb.entries
    .filter((e) => e.type === 'storage' && e.path.startsWith(s.prefix) && e.path.split('/').length === depth && e.name.toLowerCase().startsWith(kind))
    .map((e) => `${e.path}/`)
    .sort()
    .slice(0, MAX_ITEMS);
}

const prefixed = (findings: Finding[], where: string): Finding[] =>
  findings.map((finding) => ({ ...finding, location: `${where}${ARCHIVE_SEPARATOR}${finding.location}` }));

async function messageFindings(s: Storage, options: InspectOptions, depth: number): Promise<Finding[]> {
  const findings: Finding[] = [];
  const push = (field: Field, value: string | undefined) =>
    value && findings.push({ kind: field.kind, confidence: field.confidence, location: field.name, label: field.label, value });

  const senderName = string(s, 0x0c1a);
  const senderAddress = string(s, 0x5d01) ?? string(s, 0x0c1f);
  push({ name: 'PR_SENDER_NAME', label: 'Sender', kind: 'identity', confidence: 'confirmed' }, person(senderName, senderAddress));
  for (const id of [0x0c1f, 0x0065]) {
    const account = x500(string(s, id) ?? '');
    if (account) push({ name: id === 0x0c1f ? 'PR_SENDER_EMAIL_ADDRESS' : 'PR_SENT_REPRESENTING_EMAIL_ADDRESS', label: 'Exchange account (X.500 address)', kind: 'identity', confidence: 'confirmed' }, account);
  }
  for (const [id, field] of Object.entries(STRINGS)) push(field, string(s, Number(id)));

  const props = fixed(s);
  for (const [id, field] of Object.entries(TIMES)) push(field, time(props.get(Number(id))));

  // Blind copies: Outlook keeps them in a sent message's recipient table.
  for (const path of children(s, '__recip_version1.0_')) {
    const r: Storage = { cfb: s.cfb, prefix: path, header: 8 };
    if (fixed(r).get(0x0c15) !== 3n) continue;
    const who = person(string(r, 0x3001), string(r, 0x39fe) ?? string(r, 0x3003));
    if (who) findings.push({ kind: 'identity', confidence: 'confirmed', location: `${path.slice(s.prefix.length, -1)}:PR_RECIPIENT_TYPE`, label: 'Blind carbon copy', value: who });
  }

  // The Internet headers as they arrived, read as a mail's.
  const headers = string(s, 0x007d);
  if (headers) findings.push(...prefixed(emailHeaders(`${headers.replace(/\r?\n\r?\n[\s\S]*$/, '')}\r\n\r\n`), 'PR_TRANSPORT_MESSAGE_HEADERS'));

  const body = string(s, 0x1000);
  if (body) findings.push(...prefixed(partFindings({ type: 'text/plain', text: body }), 'PR_BODY'));
  const html = binary(s, 0x1013);
  if (html) findings.push(...prefixed(partFindings({ type: 'text/html', text: utf8.decode(html) }), 'PR_HTML'));

  for (const [index, path] of children(s, '__attach_version1.0_').entries()) {
    const a: Storage = { cfb: s.cfb, prefix: path, header: 8 };
    const name = string(a, 0x3707) ?? string(a, 0x3704) ?? string(a, 0x3001) ?? `attachment ${index + 1}`;
    const where = `attachment ${name}`;
    findings.push(...fileNameFindings(name, where));
    const embedded = `${path}__substg1.0_3701000D`;
    if (s.cfb.entries.some((e) => e.type === 'storage' && e.path.toLowerCase() === embedded.toLowerCase())) {
      if (depth + 1 >= MAX_DEPTH) {
        findings.push({ kind: 'environment', confidence: 'informational', location: where, label: 'Attached message beyond the nesting limit', value: name });
        continue;
      }
      const inner: Storage = { cfb: s.cfb, prefix: `${embedded}/`, header: 24 };
      findings.push(...prefixed(await messageFindings(inner, options, depth + 1), where));
      continue;
    }
    const data = binary(a, 0x3701);
    if (!data) continue;
    try {
      if (!options.inspectMember) throw new Error('no member inspection');
      findings.push(...prefixed((await options.inspectMember(data, name)).findings, where));
    } catch {
      // No parser claims it; it is still listed, so the reader knows it is there.
      findings.push({ kind: 'environment', confidence: 'informational', location: where, label: 'Attachment not inspected', value: `${data.length} bytes` });
    }
  }
  return findings;
}

export async function inspectMsg(cfb: Cfb, options: InspectOptions): Promise<InspectResult> {
  const findings = await messageFindings({ cfb, prefix: '', header: 32 }, options, 0);
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.label}\u0000${f.location}\u0000${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { format: 'msg', findings: [...unique, ...fingerprint(unique)].sort(byConfidence), notes: [{ code: 'scope:outlook' }] };
}

/** [F-2.3] The subject and the bodies, for the personal-data and rules scans. */
export function msgText(data: Uint8Array): string {
  const cfb = readCfb(data);
  if (!cfb) return '';
  const s: Storage = { cfb, prefix: '', header: 32 };
  const html = binary(s, 0x1013);
  return [string(s, 0x0037), string(s, 0x1000), html ? utf8.decode(html) : undefined].filter(Boolean).join('\n');
}

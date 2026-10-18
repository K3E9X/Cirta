/**
 * [F-P2 2.2] iCalendar (.ics, RFC 5545) and vCard (.vcf, RFC 6350).
 *
 * Both are content lines — NAME;PARAM=…:value — folded at 75 octets, and
 * both carry more than their reader sees:
 *
 *   PRODID           the program and version that wrote it
 *   X-…              vendor properties: Outlook's sender and appointment
 *                    ids, Apple's address-book id, a calendar's own name
 *   UID              an event's id, often minted as <time>@<host>: the
 *                    machine it was created on
 *   CREATED, LAST-MODIFIED, REV   when it was written and edited
 *   DESCRIPTION      the meeting link, its passcode in the query string
 *   PHOTO            a contact's picture, base64, with its camera's EXIF
 *
 * The organiser, the attendees and a contact's name and numbers are what
 * the file is for: an invitation's organiser and attendees are reported,
 * kept and named as kept; a contact card's fields are its content and are
 * not listed one by one.
 *
 * Cleaning removes whole content lines — vendor properties, optional dates,
 * and for a card PRODID, REV and UID — and leaves every other physical line
 * as it was, CRLF and folding included. An event keeps PRODID, UID and
 * DTSTAMP, which RFC 5545 requires, and which an update to the invitation
 * needs. A card's photo is stripped of its metadata and folded again.
 */

import type { Finding, InspectResult, Note, RedactResult } from './types.js';
import { byConfidence, preview } from './types.js';
import { linkFindings } from './links.js';
import { inspectImage, stripImageMetadata, detectImageKind } from './image.js';
import { inspectPlainText } from './plaintext.js';
import { cleanText } from './text.js';
import { fingerprint } from './fingerprint.js';

export type CalendarFormat = 'ics' | 'vcf';

export function calendarFormat(text: string): CalendarFormat | undefined {
  const first = /^﻿?\s*([^\r\n]*)/.exec(text)?.[1]?.trim().toUpperCase();
  if (first === 'BEGIN:VCALENDAR') return 'ics';
  if (first === 'BEGIN:VCARD') return 'vcf';
  return undefined;
}

interface Line {
  name: string;
  params: string;
  value: string;
  /** The physical lines it spans, line endings included. */
  start: number;
  end: number;
  /** The component it sits in, numbered: VEVENT 1, VCARD 2. */
  component: string;
}

/** Content lines, unfolded, with where each sits in the file. */
function contentLines(text: string): Line[] {
  const out: Line[] = [];
  const stack: string[] = [];
  const counts = new Map<string, number>();
  let at = 0;
  while (at < text.length) {
    const start = at;
    let logical = '';
    // A line, then each continuation that opens with a space or a tab, that
    // folding character left out of the value.
    let first = true;
    do {
      const newline = text.indexOf('\n', at);
      const stop = newline < 0 ? text.length : newline + 1;
      const physical = text.slice(at, stop).replace(/\r?\n$/, '');
      logical += first ? physical : physical.slice(1);
      first = false;
      at = stop;
    } while (at < text.length && (text[at] === ' ' || text[at] === '\t'));
    const m = /^([A-Za-z0-9-]+)((?:;[^:]*)?):([\s\S]*)$/.exec(logical);
    if (!m) continue;
    const name = m[1]!.toUpperCase();
    const value = m[3]!;
    if (name === 'BEGIN') {
      const type = value.trim().toUpperCase();
      const n = (counts.get(type) ?? 0) + 1;
      counts.set(type, n);
      stack.push(`${type} ${n}`);
    }
    out.push({ name, params: m[2]!, value, start, end: at, component: stack.at(-1) ?? '' });
    if (name === 'END') stack.pop();
  }
  return out;
}

const param = (params: string, name: string) => new RegExp(`;${name}=("[^"]*"|[^;:]*)`, 'i').exec(params)?.[1]?.replace(/^"|"$/g, '');
const unescape = (value: string) => value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

const person = (line: Line) => {
  const cn = param(line.params, 'CN');
  const address = line.value.replace(/^mailto:/i, '');
  return cn ? `${cn} <${address}>` : address;
};

/** Query parameters that carry a meeting's passcode. */
const PASSCODE = /^(?:pwd|passcode|password|pin|p)$/i;

function meetingLinks(text: string, location: string): Finding[] {
  const out: Finding[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    let url: URL;
    try {
      url = new URL(m[0]);
    } catch {
      continue;
    }
    const secret = [...url.searchParams.keys()].filter((k) => PASSCODE.test(k) && url.searchParams.get(k));
    if (secret.length) out.push({ kind: 'identity', confidence: 'confirmed', location, label: 'Meeting link carrying its passcode', value: `${url.host}${url.pathname} (${secret.join(', ')})` });
  }
  out.push(...linkFindings([...text.matchAll(/https?:\/\/[^\s<>"]+/g)].map((m) => m[0]), location));
  return out;
}

const vendor = (line: Line, location: string): Finding => ({ kind: 'environment', confidence: 'probable', location, label: 'Vendor property', value: preview(`${line.name}: ${unescape(line.value)}`, 160) });

function inspectIcs(lines: Line[]): Finding[] {
  const findings: Finding[] = [];
  const attendees = new Map<string, string[]>();
  for (const line of lines) {
    const location = `${line.component}:${line.name}`;
    const value = unescape(line.value).trim();
    if (!value) continue;
    switch (line.name) {
      case 'PRODID':
        findings.push({ kind: 'provenance', confidence: 'informational', location, label: 'Producing application', value });
        break;
      case 'ORGANIZER':
        findings.push({ kind: 'identity', confidence: 'confirmed', location, label: 'Organizer', value: person(line) });
        break;
      case 'ATTENDEE':
        attendees.set(line.component, [...(attendees.get(line.component) ?? []), person(line)]);
        break;
      case 'UID':
        if (/@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/.test(value)) findings.push({ kind: 'environment', confidence: 'probable', location, label: 'Event identifier naming a host', value });
        break;
      case 'CREATED':
        findings.push({ kind: 'timestamp', confidence: 'probable', location, label: 'Created', value });
        break;
      case 'LAST-MODIFIED':
        findings.push({ kind: 'timestamp', confidence: 'probable', location, label: 'Modified', value });
        break;
      case 'GEO':
        findings.push({ kind: 'identity', confidence: 'probable', location, label: 'GPS position', value: value.split(/[;,]/).map((n) => n.trim()).join(', ') });
        break;
      case 'COMMENT':
        findings.push({ kind: 'identity', confidence: 'probable', location, label: 'Comment', value: preview(value, 200) });
        break;
      case 'DESCRIPTION':
      case 'LOCATION':
      case 'URL':
      case 'ATTACH':
        findings.push(...meetingLinks(value, location));
        break;
      default:
        if (line.name.startsWith('X-')) findings.push(vendor(line, location));
    }
  }
  for (const [component, people] of attendees) findings.push({ kind: 'identity', confidence: 'confirmed', location: `${component}:ATTENDEE`, label: 'Attendees', value: preview(people.join(', '), 300) });
  return findings;
}

function photoBytes(line: Line): Uint8Array | undefined {
  const value = line.value.replace(/^data:[^,]*;base64,/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(value) || value.length < 8) return undefined;
  try {
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    return detectImageKind(bytes) ? bytes : undefined;
  } catch {
    return undefined;
  }
}

function inspectVcf(lines: Line[]): Finding[] {
  const findings: Finding[] = [];
  for (const line of lines) {
    const location = `${line.component}:${line.name}`;
    const value = unescape(line.value).trim();
    if (!value) continue;
    switch (line.name) {
      case 'PRODID':
        findings.push({ kind: 'provenance', confidence: 'informational', location, label: 'Producing application', value });
        break;
      case 'REV':
        findings.push({ kind: 'timestamp', confidence: 'probable', location, label: 'Modified', value });
        break;
      case 'UID':
        findings.push({ kind: 'environment', confidence: 'probable', location, label: 'Contact identifier', value: value.replace(/^urn:uuid:/i, '') });
        break;
      case 'NOTE':
        findings.push({ kind: 'identity', confidence: 'probable', location, label: 'Note', value: preview(value, 200) });
        break;
      case 'PHOTO':
      case 'LOGO': {
        const bytes = photoBytes(line);
        if (bytes) findings.push(...inspectImage(bytes, location));
        else if (/^https?:/i.test(value)) findings.push(...linkFindings([value], location));
        break;
      }
      case 'URL':
        findings.push(...linkFindings([value], location));
        break;
      default:
        if (line.name.startsWith('X-')) findings.push(vendor(line, location));
    }
  }
  return findings;
}

export function inspectCalendar(text: string, format: CalendarFormat): InspectResult {
  const lines = contentLines(text);
  const findings = format === 'ics' ? inspectIcs(lines) : inspectVcf(lines);
  findings.push(...inspectPlainText(text).filter((f) => f.kind === 'invisible-character' || f.kind === 'deceptive-link'));
  return { format, findings: [...findings, ...fingerprint(findings)].sort(byConfidence), notes: [{ code: format === 'ics' ? 'scope:ics' : 'scope:vcf' }] };
}

/** A base64 picture folded as RFC 6350 asks: 75 octets a line, the first one holding the property name. */
function foldedPhoto(line: Line, bytes: Uint8Array, eol: string): string {
  let base64 = '';
  for (let i = 0; i < bytes.length; i += 0x8000) base64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  base64 = btoa(base64);
  const head = `${line.name}${line.params}:`;
  const first = Math.max(1, 75 - head.length);
  const rest = base64.slice(first).match(/.{1,74}/g) ?? [];
  return [head + base64.slice(0, first), ...rest.map((chunk) => ` ${chunk}`)].join(eol) + eol;
}

const ICS_DROPPED = new Set(['CREATED', 'LAST-MODIFIED']);
const VCF_DROPPED = new Set(['PRODID', 'REV', 'UID']);

export function redactCalendar(text: string, format: CalendarFormat): RedactResult {
  const before = inspectCalendar(text, format).findings;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const dropped = format === 'ics' ? ICS_DROPPED : VCF_DROPPED;
  let out = '';
  let at = 0;
  for (const line of contentLines(text)) {
    out += text.slice(at, line.start);
    at = line.end;
    if (line.name.startsWith('X-') || dropped.has(line.name)) continue;
    if (format === 'vcf' && (line.name === 'PHOTO' || line.name === 'LOGO')) {
      const bytes = photoBytes(line);
      const stripped = bytes && stripImageMetadata(bytes);
      if (stripped) {
        out += foldedPhoto(line, stripped, eol);
        continue;
      }
    }
    out += text.slice(line.start, line.end);
  }
  out += text.slice(at);
  const cleaned = cleanText(out, { normalizeSpaces: false, normalize: 'when-flagged' }).text;
  const notes: Note[] = [{ code: format === 'ics' ? 'scope:ics' : 'scope:vcf' }];
  return { format, data: new TextEncoder().encode(cleaned), text: cleaned, removed: before, notes };
}

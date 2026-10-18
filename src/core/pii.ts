/**
 * [F-2.3] Personal and technical data in a document's text, on request.
 *
 * Opt-in, because it is about what the document says rather than what the
 * file carries beside it — and a contract is supposed to hold an IBAN. Where
 * a number has a checksum it must hold: a random run of digits is not a card.
 * Numbers that are only a shape (a plate, a passport) are probable, and some
 * need a word beside them to count at all. Every value is masked: the report
 * must not become the leak it describes.
 */

import type { Finding } from './types.js';

const MAX_PER_LABEL = 50;
const MAX_TEXT = 4 * 1024 * 1024;

interface Detector {
  label: string;
  confidence: Finding['confidence'];
  pattern: RegExp;
  /** The word that must precede a match, within 40 characters, when the shape alone is not enough. */
  context?: RegExp;
  valid?: (match: string) => boolean;
  mask: (match: string) => string;
  /** A different label for some matches: a private address is not a public one. */
  relabel?: (match: string) => string | undefined;
}

const digits = (s: string) => s.replace(/\D/g, '');
const B = '•';

function luhn(number: string): boolean {
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let d = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return number.length > 0 && sum % 10 === 0;
}

function iban(match: string): boolean {
  const s = match.replace(/\s/g, '').toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  let remainder = 0;
  for (const c of s.slice(4) + s.slice(0, 4)) {
    const value = /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c;
    for (const d of value) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

function nir(match: string): boolean {
  const s = match.replace(/\s/g, '').toUpperCase().replace('2A', '19').replace('2B', '18');
  if (!/^\d{15}$/.test(s)) return false;
  let remainder = 0;
  for (const d of s.slice(0, 13)) remainder = (remainder * 10 + Number(d)) % 97;
  return 97 - remainder === Number(s.slice(13));
}

const maskDigits = (text: string, keepStart: number, keepEnd: number) => {
  const total = digits(text).length;
  let seen = 0;
  return text.replace(/\d/g, (d) => {
    seen++;
    return seen <= keepStart || seen > total - keepEnd ? d : B;
  });
};

const grouped = (chars: string, size: number) => chars.match(new RegExp(`.{1,${size}}`, 'g'))?.join(' ') ?? chars;

const PRIVATE_V4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

const DETECTORS: Detector[] = [
  {
    label: 'IBAN',
    confidence: 'confirmed',
    pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
    valid: iban,
    mask: (m) => {
      const s = m.replace(/\s/g, '');
      return `${s.slice(0, 4)} ${grouped(B.repeat(s.length - 7), 4)} ${s.slice(-3)}`;
    },
  },
  {
    label: 'Payment card number',
    confidence: 'confirmed',
    pattern: /\b(?:4|5[1-5]|2[2-7]|3[47]|6)\d{2}(?:[ -]?\d){9,15}\b/g,
    valid: (m) => {
      const d = digits(m);
      return d.length >= 13 && d.length <= 19 && luhn(d);
    },
    mask: (m) => {
      const d = digits(m);
      return `${grouped(B.repeat(d.length - 4), 4)} ${d.slice(-4)}`;
    },
  },
  {
    label: 'French social security number (NIR)',
    confidence: 'confirmed',
    pattern: /\b[12] ?\d{2} ?(?:0[1-9]|1[0-2]|[2-9]\d) ?(?:\d{2}|2[AB]) ?\d{3} ?\d{3} ?\d{2}\b/g,
    valid: nir,
    mask: (m) => `${m.trim()[0]} ${B}${B} ${B}${B} ${B}${B} ${B}${B}${B} ${B}${B}${B} ${digits(m).slice(-2)}`,
  },
  {
    label: 'SIREN/SIRET number',
    confidence: 'confirmed',
    pattern: /\b\d{3} ?\d{3} ?\d{3}(?: ?\d{5})?\b/g,
    context: /\b(?:siren|siret|rcs|tva)\b/i,
    valid: (m) => luhn(digits(m)),
    mask: (m) => {
      const d = digits(m);
      return d.length === 9 ? `${d.slice(0, 3)} ${B.repeat(3)} ${B.repeat(3)}` : `${d.slice(0, 3)} ${B.repeat(3)} ${B.repeat(3)} ${B.repeat(5)}`;
    },
  },
  {
    label: 'Email address',
    confidence: 'confirmed',
    pattern: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}\b/g,
    mask: (m) => `${m[0]}${B.repeat(3)}${m.slice(m.indexOf('@'))}`,
  },
  {
    label: 'Phone number',
    confidence: 'probable',
    pattern: /(?:\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){2,5}|\b0[1-9](?:[ .-]?\d{2}){4})\b/g,
    valid: (m) => {
      const n = digits(m).length;
      return n >= 9 && n <= 15;
    },
    mask: (m) => (m.startsWith('+') ? maskDigits(m, (/^\+(\d{1,3})/.exec(m)?.[1] ?? '').length, 4) : maskDigits(m, 2, 2)),
  },
  {
    label: 'IP address',
    confidence: 'probable',
    pattern: /(?<![\d.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\d.])/g,
    relabel: (m) => (PRIVATE_V4.test(m) ? 'Private IP address' : undefined),
    mask: (m) => m.split('.').map((part, i) => (i < 2 ? part : B)).join('.'),
  },
  // Before IPv6: six pairs separated by colons read as an address of six groups.
  {
    label: 'MAC address',
    confidence: 'probable',
    pattern: /\b[0-9A-F]{2}(?:[:-][0-9A-F]{2}){5}\b/gi,
    mask: (m) => {
      const sep = m[2]!;
      return m.split(sep).map((part, i) => (i < 3 ? part : `${B}${B}`)).join(sep);
    },
  },
  {
    label: 'IP address',
    confidence: 'probable',
    pattern: /(?<![\w:])(?:[0-9a-f]{1,4}:){1,7}:?(?:[0-9a-f]{1,4}:?){1,7}(?![\w:])/gi,
    valid: (m) => {
      const groups = m.split(':').filter(Boolean);
      // Times and ratios are digits and two colons; an address has letters, more groups, or "::".
      return groups.length <= 8 && (m.includes('::') ? groups.length >= 2 : groups.length >= 5) && groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g));
    },
    relabel: (m) => (/^(?:fc|fd)/i.test(m) ? 'Private IP address' : undefined),
    mask: (m) => {
      const groups = m.split(':').filter(Boolean);
      return [groups[0], ...groups.slice(1).map(() => `${B}${B}${B}`)].join(':');
    },
  },
  {
    label: 'Internal host name',
    confidence: 'probable',
    pattern: /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.(?:local|lan|corp|internal|intra|intranet|localdomain|home\.arpa)\b/gi,
    mask: (m) => {
      const labels = m.split('.');
      return labels.length >= 3 ? `${labels[0]}.${B.repeat(3)}.${labels[labels.length - 1]}` : `${B.repeat(3)}.${labels[labels.length - 1]}`;
    },
  },
  {
    label: 'French licence plate',
    confidence: 'probable',
    pattern: /\b[A-HJ-NP-TV-Z]{2}[- ]\d{3}[- ][A-HJ-NP-TV-Z]{2}\b/g,
    mask: (m) => `${m.slice(0, 2)}-${B.repeat(3)}-${m.slice(-2)}`,
  },
  {
    label: 'Passport or ID card number',
    confidence: 'probable',
    pattern: /\b(?:\d{2}[A-Z]{2}\d{5}|[A-Z0-9]{9}|\d{12})\b/g,
    context: /\b(?:passeport|passport|cni|carte (?:nationale )?d['’]identit[ée]|identity card|id card)\b/i,
    valid: (m) => /\d/.test(m),
    mask: (m) => `${B.repeat(Math.max(0, m.length - 4))}${m.slice(-4)}`,
  },
];

export function piiFindings(input: string, location: string): Finding[] {
  const text = input.length > MAX_TEXT ? input.slice(0, MAX_TEXT) : input;
  const claimed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number) => claimed.some(([s, e]) => start < e && end > s);
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const counts = new Map<string, number>();

  for (const detector of DETECTORS) {
    for (const m of text.matchAll(detector.pattern)) {
      const match = m[0].trim();
      const start = m.index!;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      if (detector.context && !detector.context.test(text.slice(Math.max(0, start - 40), start))) continue;
      if (detector.valid && !detector.valid(match)) continue;
      claimed.push([start, end]);
      const label = detector.relabel?.(match) ?? detector.label;
      const value = detector.mask(match);
      const key = `${label}\u0000${value}`;
      if (seen.has(key) || (counts.get(label) ?? 0) >= MAX_PER_LABEL) continue;
      seen.add(key);
      counts.set(label, (counts.get(label) ?? 0) + 1);
      findings.push({ kind: 'identity', confidence: detector.confidence, location, label, value });
    }
  }
  return findings;
}

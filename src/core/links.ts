/**
 * [F-P2 2.1] Links that do something other than open a page.
 *
 *   - `javascript:` runs a script in the reader's browser or mail client.
 *   - `data:` carries the page itself in the address — a phishing page with
 *     no server behind it to take down.
 *   - An open redirector — google.com/url, l.facebook.com, Outlook safelinks
 *     — shows a trusted host and sends the reader on to another one; the
 *     destination is decoded and named.
 *
 * Text that shows one address on a link to another is found where the link
 * text is known (HTML, Markdown): see url.ts findHtmlLinks.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';

/** Hosts whose redirect endpoint is known, with the query parameter that carries the destination. */
const REDIRECTORS: Array<[RegExp, RegExp, string[]]> = [
  [/^(?:www\.)?google\.[a-z.]+$/, /^\/url$/, ['q', 'url']],
  [/^(?:l|lm|m)\.facebook\.com$/, /^\/l\.php$/, ['u']],
  [/^(?:l\.)?instagram\.com$/, /^\/$/, ['u']],
  [/^(?:www\.)?youtube\.com$/, /^\/redirect$/, ['q']],
  [/^(?:www\.)?linkedin\.com$/, /^\/redir\/redirect$/, ['url']],
  [/^(?:[a-z0-9-]+\.)?safelinks\.protection\.outlook\.com$/, /^\/$/, ['url']],
  [/^(?:www\.)?bing\.com$/, /^\/ck\/a$/, ['u']],
  [/^duckduckgo\.com$/, /^\/l\/$/, ['uddg']],
  [/^vk\.com$/, /^\/away\.php$/, ['to']],
  [/^(?:www\.)?slack-redir\.net$/, /^\/link$/, ['url']],
  [/^out\.reddit\.com$/, /./, ['url']],
  [/^steamcommunity\.com$/, /^\/linkfilter\/$/, ['url', 'u']],
];

/** Query parameters an unknown site uses to pass a destination along. */
const GENERIC = ['url', 'u', 'redirect', 'redirect_uri', 'redirect_url', 'return', 'returnurl', 'return_to', 'goto', 'to', 'target', 'dest', 'destination', 'link', 'out', 'continue', 'next'];

const DANGEROUS_DATA = /^(?:text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/javascript|application\/javascript|application\/x-javascript)$/i;

/** Bing wraps its destination in base64 after "a1". */
function bingTarget(value: string): string {
  if (!value.startsWith('a1')) return value;
  try {
    return atob(value.slice(2).replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return value;
  }
}

function redirect(url: URL): { destination: string; known: boolean } | undefined {
  const host = url.hostname.toLowerCase();
  for (const [hostPattern, pathPattern, params] of REDIRECTORS) {
    if (!hostPattern.test(host) || !pathPattern.test(url.pathname)) continue;
    for (const param of params) {
      const value = url.searchParams.get(param);
      if (value && /^https?:\/\//i.test(host.includes('bing.') ? bingTarget(value) : value)) {
        return { destination: host.includes('bing.') ? bingTarget(value) : value, known: true };
      }
    }
  }
  for (const [key, value] of url.searchParams) {
    if (!GENERIC.includes(key.toLowerCase()) || !/^https?:\/\//i.test(value)) continue;
    try {
      if (new URL(value).hostname.toLowerCase() !== host) return { destination: value, known: false };
    } catch {
      // Not an address after all.
    }
  }
  return undefined;
}

export function linkFindings(targets: Iterable<string>, location: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const push = (finding: Omit<Finding, 'location'>) => {
    const key = `${finding.label}\u0000${finding.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ ...finding, location });
  };

  for (const raw of targets) {
    // Browsers drop leading spaces and control characters, and schemes are case-insensitive.
    const target = raw.replace(/^[\s\u0000-\u001f]+/, '');
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(target.replace(/[\t\n\r]/g, ''))?.[1]?.toLowerCase();
    if (scheme === 'javascript' || scheme === 'vbscript') {
      push({ kind: 'active-content', confidence: 'confirmed', label: 'Link that runs a script', value: preview(target, 120) });
      continue;
    }
    if (scheme === 'data') {
      const type = /^data:([^;,]*)/i.exec(target)?.[1]?.trim().toLowerCase() || 'text/plain';
      const page = DANGEROUS_DATA.test(type);
      push({ kind: 'active-content', confidence: page ? 'confirmed' : 'probable', label: 'Link to data carried in the address', value: page ? `data:${type} (a page, opened as one)` : `data:${type}` });
      continue;
    }
    if (scheme !== 'http' && scheme !== 'https') continue;
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      continue;
    }
    const bounce = redirect(url);
    if (bounce) {
      push({ kind: 'deceptive-link', confidence: bounce.known ? 'confirmed' : 'probable', label: 'Link through an open redirector', value: `${url.hostname} → ${preview(bounce.destination, 100)}` });
    }
  }
  return findings;
}

/** Link targets in HTML: href and src-less anchors, area, form actions. One pass with indexOf. */
export function htmlLinkTargets(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\b(?:href|action|formaction)\s*=\s*(?:"([^"]{0,4000})"|'([^']{0,4000})'|([^\s>"']{1,4000}))/gi)) {
    out.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/&amp;/gi, '&').replace(/&colon;|&#0*58;|&#x0*3a;/gi, ':'));
    if (out.length >= 5000) break;
  }
  return out;
}

/** Markdown link and image targets: [text](target) and <target>. */
export function markdownLinkTargets(markdown: string): Array<{ text: string; target: string }> {
  const out: Array<{ text: string; target: string }> = [];
  for (const m of markdown.matchAll(/\[([^[\]\n]{0,300})\]\(\s*<?([^)\s>]{1,2000})>?(?:\s+"[^"\n]*")?\s*\)/g)) {
    out.push({ text: m[1]!, target: m[2]! });
    if (out.length >= 5000) break;
  }
  return out;
}

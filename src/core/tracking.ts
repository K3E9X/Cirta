/**
 * [F-2.4] Tracking parameters in links: utm_* for the campaign, fbclid and
 * gclid for the click, mc_eid and _hsenc for the subscriber. A link pasted
 * from a newsletter tells the next reader's server who first received it.
 * Reported; removed from the links on request, the rest of each address —
 * scheme, host, path, other parameters, fragment — left exactly as it was.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';

const TRACKING =
  /^(?:utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_eid|mc_cid|_hsenc|_hsmi|__hssc|__hstc|__hsfp|hsctatracking|igshid|yclid|twclid|ttclid|li_fat_id|mkt_tok|vero_id|vero_conv|oly_anon_id|oly_enc_id|_openstat|rb_clickid|s_cid|ncid|sr_share|ref_src|wickedid|epik|_ga|_gl)$/i;

const URL_IN_TEXT = /https?:\/\/[^\s"'<>()[\]{}]+/g;
const MAX = 50;

/** The tracking parameters an address carries, in order. */
export function trackingParams(url: string): string[] {
  const query = url.indexOf('?');
  if (query < 0) return [];
  const end = url.indexOf('#', query);
  return url
    .slice(query + 1, end < 0 ? undefined : end)
    .split('&')
    .map((pair) => decodeURIComponent(pair.split('=')[0]!.replace(/\+/g, ' ')))
    .filter((name) => TRACKING.test(name));
}

/** The address without its tracking parameters, or undefined when it has none. */
export function cleanUrl(url: string): string | undefined {
  const query = url.indexOf('?');
  if (query < 0) return undefined;
  const hash = url.indexOf('#', query);
  const fragment = hash < 0 ? '' : url.slice(hash);
  const pairs = url.slice(query + 1, hash < 0 ? undefined : hash).split('&');
  const kept = pairs.filter((pair) => {
    try {
      return !TRACKING.test(decodeURIComponent(pair.split('=')[0]!));
    } catch {
      return true;
    }
  });
  if (kept.length === pairs.length) return undefined;
  return `${url.slice(0, query)}${kept.length ? `?${kept.join('&')}` : ''}${fragment}`;
}

const finding = (url: string, params: string[], location: string): Finding => ({
  kind: 'identity',
  confidence: 'probable',
  location,
  label: 'Tracking parameters in a link',
  value: preview(`${url.slice(0, url.indexOf('?'))} — ${[...new Set(params)].join(', ')}`, 300),
});

/** Every address in a text, markup entities included, reported once. */
export function trackingFindings(text: string, location: string): Finding[] {
  if (!text.includes('?')) return [];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const m of text.replace(/&amp;/g, '&').matchAll(URL_IN_TEXT)) {
    if (findings.length >= MAX) break;
    const url = m[0];
    const params = trackingParams(url);
    if (!params.length || seen.has(url)) continue;
    seen.add(url);
    findings.push(finding(url, params, location));
  }
  return findings;
}

export const trackingFinding = (url: string, location: string): Finding | undefined => {
  const params = trackingParams(url);
  return params.length ? finding(url, params, location) : undefined;
};

/** The text with every address cleaned. `&amp;` stays `&amp;` where the text wrote it. */
export function stripTracking(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text.replace(/https?:\/\/[^\s"'<>()[\]{}]+/g, (url) => {
    const plain = url.replace(/&amp;/g, '&');
    const cleaned = cleanUrl(plain);
    if (cleaned === undefined) return url;
    removed++;
    return url.includes('&amp;') ? cleaned.replace(/&/g, '&amp;') : cleaned;
  });
  return { text: out, removed };
}

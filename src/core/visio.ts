/**
 * [F-P2 2.2] What a Visio drawing (.vsdx, .vsdm) carries beyond the package
 * properties every OOXML file has, which ooxml.ts reads as it does for Word:
 *
 *   visio/comments.xml          the AuthorList: names, initials, and a
 *                               ResolutionID that is the author's account
 *   visio/data/connections.xml  linked data: the workbook or database a
 *                               diagram was drawn from, a password included
 *   Hyperlink sections          each shape's Address, often a local path
 *
 * Authors become "Author" on cleaning, as they do in Word. Connections and
 * links are the drawing's own content: reported, kept, and named as kept.
 */

import { strFromU8, strToU8 } from 'fflate';
import type { Finding } from './types.js';
import { preview } from './types.js';
import { ANONYMOUS } from './comments.js';
import { PASSWORD, USER } from './xlsx-active.js';
import { linkFindings } from './links.js';

type Parts = Record<string, Uint8Array>;

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]?.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const LOCAL_TARGET = /^(file:|[a-z]:[\\/]|\\\\)/i;

export function visioFindings(parts: Parts): Finding[] {
  const findings: Finding[] = [];

  const comments = parts['visio/comments.xml'];
  if (comments) {
    const authors = new Set<string>();
    for (const m of strFromU8(comments).matchAll(/<AuthorEntry\b[^<>]*>/g)) {
      const name = attr(m[0], 'Name')?.trim();
      if (name && name !== ANONYMOUS) authors.add(name);
      const account = attr(m[0], 'ResolutionID');
      if (account) findings.push({ kind: 'identity', confidence: 'confirmed', location: 'visio/comments.xml', label: 'Comment author account', value: account });
    }
    if (authors.size) findings.push({ kind: 'identity', confidence: 'confirmed', location: 'visio/comments.xml', label: 'Comment authors', value: [...authors].join(', ') });
  }

  const connections = parts['visio/data/connections.xml'];
  if (connections) {
    for (const m of strFromU8(connections).matchAll(/<DataConnection\b[^<>]*>/g)) {
      const name = attr(m[0], 'FriendlyName') ?? attr(m[0], 'ID') ?? '';
      const source = attr(m[0], 'ConnectionString') ?? attr(m[0], 'FileName') ?? '';
      if (!source) continue;
      const masked = source.replace(new RegExp(PASSWORD.source, 'gi'), '$1=••••••••');
      findings.push({ kind: 'active-content', confidence: 'probable', location: 'visio/data/connections.xml', label: 'Data connection', value: preview(`${name} — ${masked}`, 300) });
      const password = PASSWORD.exec(source);
      if (password && password[2]!.replace(/"/g, '').trim()) {
        const user = USER.exec(source)?.[1]?.replace(/"/g, '').trim();
        findings.push({ kind: 'identity', confidence: 'confirmed', location: 'visio/data/connections.xml', label: 'Password stored in a connection', value: `${name} — ${password[1]}=••••••••${user ? ` (user ${user})` : ''}` });
      }
      const file = attr(m[0], 'FileName');
      if (file && LOCAL_TARGET.test(file)) findings.push({ kind: 'environment', confidence: 'confirmed', location: 'visio/data/connections.xml', label: 'Link to a local or network path', value: file });
    }
  }

  for (const [path, raw] of Object.entries(parts)) {
    if (!/^visio\/(?:pages|masters)\/[^/]+\.xml$/.test(path)) continue;
    const addresses = [...strFromU8(raw).matchAll(/<Cell\b[^<>]*>/g)].filter((m) => /\sN="Address"/.test(m[0])).map((m) => attr(m[0], 'V')).filter((v): v is string => Boolean(v));
    findings.push(...linkFindings(addresses, path));
    for (const address of new Set(addresses)) {
      if (LOCAL_TARGET.test(address)) findings.push({ kind: 'environment', confidence: 'confirmed', location: path, label: 'Link to a local or network path', value: address });
    }
  }
  return findings;
}

/** Comment authors replaced, in place; the comments themselves stay. */
export function anonymizeVisio(parts: Parts): void {
  const comments = parts['visio/comments.xml'];
  if (!comments) return;
  parts['visio/comments.xml'] = strToU8(
    strFromU8(comments).replace(/<AuthorEntry\b[^<>]*>/g, (tag) =>
      tag
        .replace(/\sName="[^"]*"/, ` Name="${ANONYMOUS}"`)
        .replace(/\sInitials="[^"]*"/, ' Initials="A"')
        .replace(/\sResolutionID="[^"]*"/, ''),
    ),
  );
}

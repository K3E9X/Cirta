/**
 * [F-2.1] What a workbook connects to, and what it keeps out of sight.
 *
 * A data connection names a server and a database, and an old-style
 * connection string may hold the password itself. A query table refreshes
 * from it; Power Query keeps its code — every Sql.Database, Web.Contents and
 * File.Contents it reads — base64-encoded in a custom XML part. Rows and
 * columns marked hidden, and figures typed in white on white, travel with
 * the file and are one click from view.
 */

import { strFromU8, unzipSync } from 'fflate';
import type { Finding } from './types.js';
import { preview } from './types.js';
import { elements } from './tracked-changes.js';

type Parts = Record<string, Uint8Array>;

const MAX_CELLS = 20;
const MAX_MASHUP = 8 * 1024 * 1024;

export const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]?.replace(/&amp;/g, '&').replace(/&quot;/g, '"');

export const PASSWORD = /\b(Password|Pwd)\s*=\s*("[^"]*"|[^;]*)/i;
export const USER = /\b(?:User ID|UID|User)\s*=\s*("[^"]*"|[^;]*)/i;

function connectionFindings(parts: Parts): Finding[] {
  const xml = parts['xl/connections.xml'];
  if (!xml) return [];
  const findings: Finding[] = [];
  for (const element of elements(strFromU8(xml), 'connection')) {
    const name = attr(element.open, 'name') ?? '';
    const db = /<dbPr\b[^<>]*>/.exec(element.inner)?.[0];
    const web = /<webPr\b[^<>]*>/.exec(element.inner)?.[0];
    const text = /<textPr\b[^<>]*>/.exec(element.inner)?.[0];
    const source = (db && attr(db, 'connection')) ?? (web && attr(web, 'url')) ?? (text && attr(text, 'sourceFile')) ?? attr(element.open, 'sourceFile') ?? '';
    if (!source) continue;
    const masked = source.replace(new RegExp(PASSWORD.source, 'gi'), '$1=••••••••');
    findings.push({ kind: 'active-content', confidence: 'probable', location: 'xl/connections.xml', label: 'Data connection', value: preview(`${name} — ${masked}`, 300) });
    const password = PASSWORD.exec(source);
    if (password && password[2]!.replace(/"/g, '').trim()) {
      const user = USER.exec(source)?.[1]?.replace(/"/g, '').trim();
      findings.push({
        kind: 'identity',
        confidence: 'confirmed',
        location: 'xl/connections.xml',
        label: 'Password stored in a connection',
        value: `${name} — ${password[1]}=••••••••${user ? ` (user ${user})` : ''}`,
      });
    }
  }
  return findings;
}

function queryTables(parts: Parts): Finding[] {
  return Object.keys(parts)
    .filter((p) => /^xl\/queryTables\/queryTable\d+\.xml$/.test(p))
    .sort()
    .map((path) => ({
      kind: 'active-content' as const,
      confidence: 'probable' as const,
      location: path,
      label: 'Query table',
      value: attr(/<queryTable\b[^<>]*>/.exec(strFromU8(parts[path]!))?.[0] ?? '', 'name') ?? path,
    }));
}

const M_SOURCE =
  /\b(Sql\.Databases?|Web\.Contents|Web\.Page|File\.Contents|Folder\.Files|Folder\.Contents|Odbc\.DataSource|Odbc\.Query|OData\.Feed|SharePoint\.(?:Files|Tables|Contents)|Oracle\.Database|MySQL\.Database|PostgreSQL\.Database|AzureStorage\.\w+)\s*\(([^()]{0,300})\)/g;

/** Power Query's code, from the DataMashup custom XML part. */
function powerQuery(parts: Parts): Finding[] {
  const findings: Finding[] = [];
  for (const [path, raw] of Object.entries(parts)) {
    if (!/^customXml\/item\d+\.xml$/.test(path)) continue;
    const xml = raw[0] === 0xff && raw[1] === 0xfe ? new TextDecoder('utf-16le').decode(raw) : strFromU8(raw);
    const encoded = /<DataMashup\b[^<>]*>([^<]+)<\/DataMashup>/.exec(xml)?.[1];
    if (!encoded || encoded.length > MAX_MASHUP * 2) continue;
    let code = '';
    try {
      const binary = Uint8Array.from(atob(encoded.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
      const length = new DataView(binary.buffer).getUint32(4, true);
      if (length > MAX_MASHUP || 8 + length > binary.length) continue;
      const pkg = unzipSync(binary.subarray(8, 8 + length), { filter: (file) => file.name.startsWith('Formulas/') && file.originalSize < MAX_MASHUP });
      code = Object.values(pkg).map((bytes) => strFromU8(bytes)).join('\n');
    } catch {
      continue;
    }
    const seen = new Set<string>();
    for (const m of code.matchAll(M_SOURCE)) {
      const call = `${m[1]}(${m[2]!.trim()})`;
      if (seen.has(call)) continue;
      seen.add(call);
      findings.push({ kind: 'active-content', confidence: 'probable', location: `${path} (Power Query)`, label: 'Power Query source', value: preview(call, 300) });
    }
  }
  return findings;
}

/** Sheet names by worksheet part, through the workbook's relationships; in order if those are missing. */
export function sheets(parts: Parts): Array<{ name: string; path: string; hidden: boolean }> {
  const workbook = parts['xl/workbook.xml'] ? strFromU8(parts['xl/workbook.xml']) : '';
  const rels = parts['xl/_rels/workbook.xml.rels'] ? strFromU8(parts['xl/_rels/workbook.xml.rels']) : '';
  const out: Array<{ name: string; path: string; hidden: boolean }> = [];
  for (const [index, m] of [...workbook.matchAll(/<sheet\b[^<>]*>/g)].entries()) {
    const name = attr(m[0], 'name') ?? `sheet${index + 1}`;
    const id = attr(m[0], 'r:id');
    // [P0-1] Each relationship, then its id: two attributes in one pattern backtracked across a long tag.
    const relationship = id ? [...rels.matchAll(/<Relationship\b[^<>]*/g)].find((r) => /Id="([^"]*)"/.exec(r[0])?.[1] === id)?.[0] : undefined;
    const target = relationship ? /Target="([^"]+)"/.exec(relationship)?.[1] : undefined;
    const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : `xl/worksheets/sheet${index + 1}.xml`;
    if (parts[path]) out.push({ name, path, hidden: /\sstate="(hidden|veryHidden)"/.test(m[0]) });
  }
  return out;
}

const column = (n: number): string => (n <= 0 ? '' : column(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)));

function hiddenRowsAndColumns(parts: Parts): Finding[] {
  const findings: Finding[] = [];
  for (const { name, path } of sheets(parts)) {
    const xml = strFromU8(parts[path]!);
    const rows = [...xml.matchAll(/<row\b[^<>]*>/g)].filter((m) => /\shidden="(1|true)"/.test(m[0])).map((m) => attr(m[0], 'r') ?? '?');
    const cols = [...xml.matchAll(/<col\b[^<>]*>/g)]
      .filter((m) => /\shidden="(1|true)"/.test(m[0]))
      .map((m) => ({ min: Number(attr(m[0], 'min')), max: Number(attr(m[0], 'max')) }))
      .filter((c) => c.min > 0 && c.max >= c.min);
    if (!rows.length && !cols.length) continue;
    const colCount = cols.reduce((n, c) => n + c.max - c.min + 1, 0);
    const parts_: string[] = [];
    if (rows.length) parts_.push(`${rows.length} row${rows.length > 1 ? 's' : ''} (${rows.slice(0, 10).join(', ')}${rows.length > 10 ? ', …' : ''})`);
    if (cols.length) {
      const ranges = cols.slice(0, 10).map((c) => (c.min === c.max ? column(c.min) : `${column(c.min)}–${column(c.max)}`));
      parts_.push(`${colCount} column${colCount > 1 ? 's' : ''} (${ranges.join(', ')}${cols.length > 10 ? ', …' : ''})`);
    }
    findings.push({ kind: 'identity', confidence: 'probable', location: path, label: 'Hidden rows and columns', value: `${name}: ${parts_.join(', ')}` });
  }
  return findings;
}

const WHITE = /^(?:FF)?FFFFFF$/i;

/** Cell formats whose font is white on an unfilled background. */
export function whiteStyles(parts: Parts): Set<number> {
  const styles = parts['xl/styles.xml'] ? strFromU8(parts['xl/styles.xml']) : '';
  const white = new Set<number>();
  if (!styles) return white;
  const fonts = elements(elements(styles, 'fonts')[0]?.inner ?? '', 'font').map((f) => {
    const rgb = /<color\b[^<>]*\srgb="([0-9A-Fa-f]{6,8})"/.exec(f.inner)?.[1];
    return rgb !== undefined && WHITE.test(rgb);
  });
  const fills = elements(elements(styles, 'fills')[0]?.inner ?? '', 'fill').map((f) => {
    const rgb = /<fgColor\b[^<>]*\srgb="([0-9A-Fa-f]{6,8})"/.exec(f.inner)?.[1];
    return /patternType="solid"/.test(f.inner) && rgb !== undefined && !WHITE.test(rgb);
  });
  const xfs = elements(styles, 'cellXfs')[0]?.inner ?? '';
  [...xfs.matchAll(/<xf\b[^<>]*>/g)].forEach((m, index) => {
    const font = Number(attr(m[0], 'fontId') ?? 0);
    const fill = Number(attr(m[0], 'fillId') ?? 0);
    // White on a coloured fill is ordinary; only white on the sheet's white is not.
    if (fonts[font] && !fills[fill]) white.add(index);
  });
  return white;
}

/** The workbook's shared strings, by index. */
export function sharedStrings(parts: Parts): string[] {
  return parts['xl/sharedStrings.xml']
    ? elements(strFromU8(parts['xl/sharedStrings.xml']), 'si').map((si) => [...si.inner.matchAll(/<t\b[^<>]*>([^<]*)<\/t>/g)].map((m) => m[1]).join(''))
    : [];
}

function whiteCells(parts: Parts): Finding[] {
  const white = whiteStyles(parts);
  if (!white.size) return [];
  const shared = sharedStrings(parts);
  const findings: Finding[] = [];
  for (const { name, path } of sheets(parts)) {
    const xml = strFromU8(parts[path]!);
    for (const cell of elements(xml, 'c')) {
      if (findings.length >= MAX_CELLS) return findings;
      const style = Number(attr(cell.open, 's') ?? -1);
      if (!white.has(style)) continue;
      const type = attr(cell.open, 't');
      const raw = type === 'inlineStr' ? /<t\b[^<>]*>([^<]*)<\/t>/.exec(cell.inner)?.[1] : /<v>([^<]*)<\/v>/.exec(cell.inner)?.[1];
      if (raw === undefined || raw === '') continue;
      const value = type === 's' ? shared[Number(raw)] ?? '' : raw;
      if (!value.trim()) continue;
      findings.push({
        kind: 'invisible-character',
        confidence: 'probable',
        location: path,
        label: 'Cells in white type',
        value: preview(`${name}!${attr(cell.open, 'r') ?? '?'}: ${value}`, 200),
      });
    }
  }
  return findings;
}

export function workbookActiveFindings(parts: Parts): Finding[] {
  if (!parts['xl/workbook.xml']) return [];
  return [...connectionFindings(parts), ...queryTables(parts), ...powerQuery(parts), ...hiddenRowsAndColumns(parts), ...whiteCells(parts)];
}

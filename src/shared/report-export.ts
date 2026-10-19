/**
 * [F-P2 2.7] The report as a page or a Markdown file, in the reader's
 * language — for an e-mail to the person who sent the documents, a ticket,
 * an audit file.
 *
 * Every value comes from a document someone else wrote, so neither form
 * may let one act:
 *
 *   - The HTML page escapes every value and declares a policy that allows
 *     no script, no request, no frame: `default-src 'none'`, inline styles
 *     only. Should an escape ever be missed, the page still cannot run or
 *     fetch anything.
 *   - In Markdown a value is code: a `![x](https://…)` read as Markdown would
 *     fetch a tracking pixel the moment the report is viewed. Pipes are
 *     escaped so a value cannot add a column to the table.
 *
 * Unlike the manifest, a report carries the values: it is the reader's own
 * account of what the files say, and showing them is its point.
 */

import type { Finding, InspectResult } from '../core/types.js';
import { noteText, translateLabel, translateLocation, translateValue, type Lang } from './french.js';

export interface ReportEntry {
  file: string;
  result?: InspectResult;
  error?: string;
}

const TEXT = {
  fr: {
    title: 'Rapport Cirta',
    generated: (version: string, at: string) => `Établi par Cirta ${version} le ${at}, localement : aucun fichier n’a quitté la machine.`,
    columns: ['Niveau', 'Type', 'Champ', 'Valeur', 'Emplacement'],
    nothing: 'Aucune métadonnée identifiante trouvée.',
    format: 'Format :',
    summary: (files: number, flagged: number) => `${files} fichier${files > 1 ? 's' : ''}, ${flagged} portant des données identifiantes confirmées.`,
    confidence: { confirmed: 'confirmé', probable: 'probable', informational: 'informatif' },
    kinds: {
      identity: 'identité',
      provenance: 'provenance',
      timestamp: 'horodatage',
      environment: 'environnement',
      'invisible-character': 'invisible',
      'deceptive-link': 'lien trompeur',
      'deceptive-name': 'nom trompeur',
      'active-content': 'contenu actif',
    },
    caveat: 'Un filigrane statistique dans la formulation d’un texte généré n’apparaîtrait pas ici : il ne se lit pas sans la clé de son fournisseur.',
  },
  en: {
    title: 'Cirta report',
    generated: (version: string, at: string) => `Produced by Cirta ${version} on ${at}, locally: no file left the machine.`,
    columns: ['Level', 'Kind', 'Field', 'Value', 'Location'],
    nothing: 'No identifying metadata found.',
    format: 'Format:',
    summary: (files: number, flagged: number) => `${files} file${files > 1 ? 's' : ''}, ${flagged} carrying confirmed identifying data.`,
    confidence: { confirmed: 'confirmed', probable: 'probable', informational: 'informational' },
    kinds: {
      identity: 'identity',
      provenance: 'provenance',
      timestamp: 'timestamp',
      environment: 'environment',
      'invisible-character': 'invisible',
      'deceptive-link': 'deceptive link',
      'deceptive-name': 'deceptive name',
      'active-content': 'active content',
    },
    caveat: 'A statistical watermark in the wording of generated text would not show up here: it cannot be read without its vendor’s key.',
  },
} satisfies Record<Lang, unknown>;

interface Meta {
  version: string;
  at?: Date;
}

const row = (finding: Finding, lang: Lang) => [
  TEXT[lang].confidence[finding.confidence],
  TEXT[lang].kinds[finding.kind],
  translateLabel(finding.label, lang),
  translateValue(finding, lang),
  translateLocation(finding.location, lang),
];

const flagged = (entries: ReportEntry[]) => entries.filter((e) => e.result?.findings.some((f) => f.confidence === 'confirmed')).length;
const stamp = (at: Date) => at.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

/* ------------------------------------------------------------- Markdown -- */

/** A value as inline code: a fence longer than any run of backticks inside, pipes escaped for the table. */
function code(value: string): string {
  const flat = value.replace(/\r?\n/g, ' ');
  if (!flat) return '';
  const longest = Math.max(0, ...[...flat.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${flat.replace(/\|/g, '\\|')}${pad}${fence}`;
}

/** Prose from the tool itself: escaped so that a file name or a note cannot become a link or a heading. */
const prose = (text: string) => text.replace(/\r?\n/g, ' ').replace(/([\\`*_{}[\]()#+!|<>])/g, '\\$1');

export function reportMarkdown(entries: ReportEntry[], lang: Lang, { version, at = new Date() }: Meta): string {
  const t = TEXT[lang];
  const out = [`# ${t.title}`, '', prose(t.generated(version, stamp(at))), '', prose(t.summary(entries.length, flagged(entries))), ''];
  for (const entry of entries) {
    out.push(`## ${prose(entry.file)}`, '');
    if (entry.error) {
      out.push(prose(entry.error), '');
      continue;
    }
    const result = entry.result!;
    out.push(`${t.format} ${code(result.format)}`, '');
    if (!result.findings.length) out.push(prose(t.nothing), '');
    else {
      out.push(`| ${t.columns.join(' | ')} |`, `|${t.columns.map(() => '---').join('|')}|`);
      for (const finding of result.findings) {
        const [level, kind, label, value, location] = row(finding, lang);
        out.push(`| ${prose(level!)} | ${prose(kind!)} | ${prose(label!)} | ${code(value!)} | ${code(location!)} |`);
      }
      out.push('');
    }
    for (const note of result.notes) out.push(`> ${prose(noteText(note, lang))}`, '');
  }
  out.push('---', '', prose(t.caveat), '');
  return out.join('\n');
}

/* ----------------------------------------------------------------- HTML -- */

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const STYLE = `
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 72rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.1rem; margin-top: 2rem; word-break: break-all; }
  table { border-collapse: collapse; width: 100%; font-size: 0.875rem; }
  th, td { border: 1px solid #ccc; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
  th { background: #f3f3f3; } td.value, td.location { font-family: ui-monospace, monospace; word-break: break-word; }
  .confirmed { color: #a40000; font-weight: 600; } .note { color: #444; border-left: 3px solid #ccc; padding-left: 0.75rem; }
  .error { color: #a40000; } footer { margin-top: 2rem; color: #555; font-size: 0.85rem; }
  @media (prefers-color-scheme: dark) { body { color: #eee; background: #161616; } th { background: #262626; } th, td { border-color: #444; } .note { color: #bbb; } .confirmed, .error { color: #ff8a80; } }
`;

export function reportHtml(entries: ReportEntry[], lang: Lang, { version, at = new Date() }: Meta): string {
  const t = TEXT[lang];
  const body: string[] = [`<h1>${escape(t.title)}</h1>`, `<p>${escape(t.generated(version, stamp(at)))}</p>`, `<p>${escape(t.summary(entries.length, flagged(entries)))}</p>`];
  for (const entry of entries) {
    body.push(`<section><h2>${escape(entry.file)}</h2>`);
    if (entry.error) {
      body.push(`<p class="error">${escape(entry.error)}</p></section>`);
      continue;
    }
    const result = entry.result!;
    body.push(`<p>${escape(t.format)} <code>${escape(result.format)}</code></p>`);
    if (!result.findings.length) body.push(`<p>${escape(t.nothing)}</p>`);
    else {
      body.push(`<table><thead><tr>${t.columns.map((c) => `<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>`);
      for (const finding of result.findings) {
        const [level, kind, label, value, location] = row(finding, lang).map((cell) => escape(cell));
        body.push(`<tr><td class="${finding.confidence}">${level}</td><td>${kind}</td><td>${label}</td><td class="value">${value}</td><td class="location">${location}</td></tr>`);
      }
      body.push('</tbody></table>');
    }
    for (const note of result.notes) body.push(`<p class="note">${escape(noteText(note, lang))}</p>`);
    body.push('</section>');
  }
  body.push(`<footer>${escape(t.caveat)}</footer>`);
  return [
    '<!doctype html>',
    `<html lang="${lang}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escape(t.title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    ...body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}


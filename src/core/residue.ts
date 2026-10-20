/**
 * What a chat answer leaves behind when it is pasted into an email.
 *
 * Everything else this tool reads is invisible: a zero-width space, a Cyrillic
 * letter, a field in a file's metadata. What actually gives away an email that
 * was drafted with an assistant is usually in plain sight, and it is of two
 * kinds.
 *
 *   The assistant talking to you. "Sure! Here's a draft:" above the greeting,
 *   "Let me know if you'd like me to adjust the tone" below the signature.
 *   Those lines are addressed to whoever asked for the draft, not to whoever
 *   receives it, and pasted along with it they say exactly where it came from.
 *
 *   Formatting that only a chat window renders. `**Subject**`, `## Title`,
 *   `[link](https://…)` display as bold, a heading and a link in the chat, and
 *   as asterisks, hashes and brackets in most mail clients.
 *
 * The two are handled differently, on purpose. Markdown markers carry no
 * meaning in a plain-text email, so cleaning removes them. Lines addressed to
 * you are words someone wrote, and whether to keep them is yours to decide —
 * the rule every other part of this tool follows for content. They are found,
 * shown with their line number, and removed only when asked.
 *
 * Precision matters more than recall here. "Voici le rapport demandé." opens a
 * real email; "N'hésitez pas à me contacter." closes one. Neither may be
 * flagged, so a line is reported as addressed to you only when its position
 * and its wording agree: before the greeting or after the signature, and about
 * the draft itself.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';

const GREETING =
  /^\s*(?:bonjour|bonsoir|salut|madame|monsieur|mesdames|messieurs|ch[eè]re?s?|hello|hi|hey|dear|good (?:morning|afternoon|evening))\b/i;

const SIGNOFF =
  /^\s*(?:(?:bien )?cordialement|bien (?:à|a) (?:vous|toi)|(?:sinc[eè]res |meilleures )?salutations|amicalement|bonne (?:journée|soirée|fin de journée|semaine)|(?:best|kind|warm(?:est)?) regards|regards|sincerely|cheers|best wishes|merci(?: d'avance| par avance| encore)?|thanks(?: again| in advance)?|thank you|best)\s*(?:[,.!]\s*)?$/i;

/** Openings an assistant uses before handing over a draft. */
const OPENER =
  /^\s*(?:(?:bien s[uû]r|avec plaisir|absolument|certainement|tout (?:à|a) fait|parfait|d'accord|excellente (?:question|idée)|sure|certainly|of course|absolutely|great (?:question|idea)|happy to help)\b|voici\b|here(?:'s| is)\b|ci-dessous\b|below is\b|je vous propose\b|i(?:'ve| have) (?:drafted|written|prepared)\b)/i;

/** What the assistant's sentence is about, when it is about the draft. */
const DRAFT_NOUN =
  /\b(?:e-?mail|courriel|mail|message|réponse|proposition|version|brouillon|ébauche|modèle|exemple|draft|reply|response|template)s?\b/i;

/** An offer to keep going — the shape of an assistant's last line. */
const CLOSER_OFFER =
  /\b(?:n'h[eé]sitez pas|souhaitez-vous|voulez-vous|dites-moi|faites-moi savoir|je peux (?:aussi|également|volontiers)|si vous (?:le )?souhaitez|let me know|would you like|do you want|want me to|i can also|i'?d be happy|feel free|hope (?:this|that) helps|if you'?d like)\b/i;

/** …about editing the text, which a real email never offers its reader. */
const CLOSER_EDIT =
  /\b(?:ajust|modifi|adapt|reformul|raccourc|allong|réécri|retouch|le ton|ce ton|plus (?:formel|court|long|direct|concis)|une autre version|cette version|variante|adjust|tweak|revis|rewrit|rephras|shorten|lengthen|the tone|another version|more (?:formal|casual|concise|direct)|make it)/i;

const SUBJECT = /^\s*(?:\*\*\s*)?(?:objet|subject)\s*:/i;

/*
 * A placeholder the template expected someone to fill in. The vocabulary is
 * closed on purpose: `[1]`, `[PDF]` and `[sic]` are ordinary text, and a
 * Markdown link's label is followed by its URL, which the lookahead excludes.
 */
const PLACEHOLDER =
  /\[(?:votre|vos|your|nom|name|prénom|first name|last name|full name|date|entreprise|société|company|poste|title|position|signature|téléphone|phone|e-?mail|adresse|address|insérer|insert|destinataire|recipient|montant|amount|numéro|number|lien|link)\b[^\]\n]{0,40}\](?!\()/gi;

const SEPARATOR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function lines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

/** The line indexes an assistant addressed to you rather than to the recipient. */
function scaffolding(all: string[]): number[] {
  const nonEmpty = all.map((line, i) => [line, i] as const).filter(([line]) => line.trim());
  if (nonEmpty.length === 0) return [];

  const greeting = nonEmpty.find(([line]) => GREETING.test(line))?.[1];
  const signoff = [...nonEmpty].reverse().find(([line]) => SIGNOFF.test(line))?.[1];
  const flagged = new Set<number>();

  // Before the greeting, any opener is addressed to someone else. With no
  // greeting to anchor on, only an opener that announces the draft counts.
  const head = nonEmpty.slice(0, 3);
  for (const [line, i] of head) {
    if (greeting !== undefined && i >= greeting) break;
    if (!OPENER.test(line)) continue;
    if (greeting !== undefined || /:\s*$/.test(line) || DRAFT_NOUN.test(line)) flagged.add(i);
  }

  // After the signature, an offer is addressed to whoever asked for the text.
  // Anywhere near the end, an offer to edit the text is too.
  const tail = nonEmpty.slice(-3);
  for (const [line, i] of tail) {
    const afterSignoff = signoff !== undefined && i > signoff;
    if (!CLOSER_OFFER.test(line)) continue;
    if (afterSignoff || CLOSER_EDIT.test(line)) flagged.add(i);
  }

  return [...flagged].sort((a, b) => a - b);
}

/* ------------------------------------------------------------- Markdown -- */

interface MarkdownRule {
  key: string;
  pattern: RegExp;
  replace: (match: string, ...groups: string[]) => string;
}

/*
 * Each pattern stays inside one line and has no nested quantifier, so cost is
 * linear in the text. `snake_case`, `2*3*4` and a `* bullet` are left alone:
 * the italic rule needs a non-word character before the opening asterisk and
 * text directly after it, and underscores are never read as emphasis.
 */
const MARKDOWN: MarkdownRule[] = [
  { key: '```', pattern: /^[ \t]*```[^\n]*$\n?/gm, replace: () => '' },
  { key: '**…**', pattern: /\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*|__(?=\S)([^_\n]+?)(?<=\S)__/g, replace: (_m, a, b) => a ?? b ?? '' },
  { key: '*…*', pattern: /(?<![*\w])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![*\w])/g, replace: (_m, a) => a ?? '' },
  { key: '#', pattern: /^[ \t]*#{1,6}[ \t]+(?=\S)/gm, replace: () => '' },
  {
    key: '[…](…)',
    // The label stops at a bracket: a run of a hundred thousand "[" made every
    // one of them scan to the end of the line, quadratic (F-2.8).
    pattern: /\[([^[\]\n]+)\]\((https?:\/\/(?:(?!\]\()[^)\s])+)\)/g,
    replace: (_m, label, url) => (label === url ? url : `${label} (${url})`),
  },
  { key: '`…`', pattern: /`([^`\n]+)`/g, replace: (_m, code) => code ?? '' },
];

/*
 * A text that is itself a Markdown document — a README piped into the CLI —
 * would be wrecked by having its markup removed. A table, front matter or
 * three headings or more say "document", not "email with a stray asterisk",
 * and then the markers are reported and left alone.
 */
function looksLikeMarkdownDocument(text: string): boolean {
  if (text.startsWith('---') && /^---\r?\n[\s\S]*?\r?\n---\s*$/m.test(text.slice(0, 4096))) return true;
  // [P0-1] A line at a time, each run of blanks as one: \s across lines, and blanks on either side of an optional bar, backtracked.
  if (text.split('\n').some((line) => /^ ?\|? ?:?-{3,}:? ?(?:\| ?:?-{3,}:? ?)+\|? ?$/.test(line.replace(/\s+/g, ' ')))) return true;
  return (text.match(/^[ \t]*#{1,6}[ \t]+\S/gm) ?? []).length >= 3;
}

function markdownCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const rule of MARKDOWN) {
    const n = (text.match(rule.pattern) ?? []).length;
    if (n) counts.set(rule.key, n);
  }
  return counts;
}

function describeCounts(counts: Map<string, number>): string {
  // Symbols rather than words, so the value reads the same in every language.
  return [...counts].map(([key, n]) => `${key} ×${n}`).join(' · ');
}

export interface MarkdownStrip {
  text: string;
  /** Marker kinds removed, as the symbols a reader would have seen. */
  removed: string;
  /** Set when the text reads as a Markdown document and was left alone. */
  keptAsDocument: boolean;
}

export function stripMarkdownResidue(text: string): MarkdownStrip {
  const counts = markdownCounts(text);
  if (counts.size === 0) return { text, removed: '', keptAsDocument: false };
  if (looksLikeMarkdownDocument(text)) return { text, removed: '', keptAsDocument: true };

  let out = text;
  for (const rule of MARKDOWN) out = out.replace(rule.pattern, rule.replace as never);
  return { text: out, removed: describeCounts(counts), keptAsDocument: false };
}

/* ------------------------------------------------------------- findings -- */

export function findResidue(text: string): Finding[] {
  const all = lines(text);
  const findings: Finding[] = [];

  for (const i of scaffolding(all)) {
    findings.push({
      kind: 'provenance',
      confidence: 'confirmed',
      location: `line ${i + 1}`,
      label: 'Written to you, not to the recipient',
      value: preview(all[i]!.trim(), 120),
    });
  }

  for (const [i, line] of all.entries()) {
    if (i > 6) break;
    if (SUBJECT.test(line)) {
      findings.push({
        kind: 'provenance',
        confidence: 'probable',
        location: `line ${i + 1}`,
        label: 'Subject line repeated in the body',
        value: preview(line.trim(), 120),
      });
      break;
    }
  }

  for (const [i, line] of all.entries()) {
    for (const match of line.matchAll(PLACEHOLDER)) {
      findings.push({
        kind: 'provenance',
        confidence: 'confirmed',
        location: `line ${i + 1}`,
        label: 'Template placeholder left unfilled',
        value: match[0],
      });
    }
  }

  const counts = markdownCounts(text);
  if (counts.size) {
    findings.push({
      kind: 'provenance',
      confidence: 'probable',
      location: 'text formatting',
      label: 'Markdown that will show as symbols',
      value: describeCounts(counts),
    });
  }

  return findings;
}

/**
 * Remove the lines an assistant addressed to you. Only ever on request: these
 * are words, and the caller decides. Separator lines the draft was framed with
 * go too when they end up at the very start or end.
 */
export function removeScaffolding(text: string): { text: string; removed: string[] } {
  const all = lines(text);
  const drop = new Set(scaffolding(all));
  if (drop.size === 0) return { text, removed: [] };

  const removed = [...drop].map((i) => all[i]!.trim());
  let kept = all.filter((_line, i) => !drop.has(i));

  const trim = () => {
    while (kept.length && (!kept[0]!.trim() || SEPARATOR.test(kept[0]!))) kept.shift();
    while (kept.length && (!kept.at(-1)!.trim() || SEPARATOR.test(kept.at(-1)!))) kept.pop();
  };
  trim();
  // Two blank lines where one line was taken out of the middle read as a gap.
  kept = kept.filter((line, i) => line.trim() || (kept[i - 1] ?? '').trim());

  const newline = /\r\n/.test(text) ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(text) ? newline : '';
  return { text: kept.join(newline) + trailing, removed };
}

/**
 * Generic ZIP archives, and the deep content scan shared by every container.
 *
 * Two things live here that the per-format modules cannot do on their own.
 *
 * First, a plain `.zip` is not a document format — it is a bag of files, and
 * what matters is what is inside. Members are walked recursively so that a
 * report on an archive is a report on everything it carries.
 *
 * Second, some traces sit in body content rather than in a metadata field: an
 * API key pasted into a generated script, a request id left in a log. Those are
 * scanned for directly, but only for patterns that can never be innocent prose.
 * Vendor names are deliberately excluded — a document that discusses Claude is
 * not a document produced by Claude, and conflating the two is how these tools
 * earn their reputation for false positives.
 */

import { strFromU8 } from 'fflate';
import { unzipGuarded } from './zip.js';
import type { Finding } from './types.js';

/**
 * Limits that keep a malicious archive from exhausting memory. A zip bomb
 * expands to gigabytes from a few kilobytes, and this runs in a browser tab.
 */
const LIMITS = {
  maxMembers: 2000,
  maxDepth: 3,
  maxTotalBytes: 256 * 1024 * 1024,
  maxScanBytes: 4 * 1024 * 1024,
} as const;

/**
 * Patterns scanned for inside body content.
 *
 * Every entry here has to be something that cannot plausibly appear in ordinary
 * writing. Credentials and provider-issued object ids qualify; product names do
 * not, which is why none appear.
 */
const CONTENT_PATTERNS: Array<{
  pattern: RegExp;
  label: string;
  kind: Finding['kind'];
  redactValue?: boolean;
}> = [
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, label: 'Anthropic API key', kind: 'identity', redactValue: true },
  { pattern: /\bsk-proj-[A-Za-z0-9_-]{20,}/g, label: 'OpenAI project key', kind: 'identity', redactValue: true },
  { pattern: /\bsk-[A-Za-z0-9]{32,}/g, label: 'OpenAI-style API key', kind: 'identity', redactValue: true },
  { pattern: /\bAIza[A-Za-z0-9_-]{30,}/g, label: 'Google API key', kind: 'identity', redactValue: true },
  { pattern: /\bhf_[A-Za-z0-9]{30,}/g, label: 'Hugging Face token', kind: 'identity', redactValue: true },
  { pattern: /\bghp_[A-Za-z0-9]{36}/g, label: 'GitHub token', kind: 'identity', redactValue: true },
  { pattern: /\bmsg_[A-Za-z0-9]{20,}/g, label: 'Anthropic message id', kind: 'provenance' },
  { pattern: /\bchatcmpl-[A-Za-z0-9]{20,}/g, label: 'OpenAI completion id', kind: 'provenance' },
  { pattern: /\b(?:thread|asst|run)_[A-Za-z0-9]{20,}/g, label: 'OpenAI assistant object id', kind: 'provenance' },
  {
    pattern: /\bapi\.(?:anthropic\.com|openai\.com|x\.ai|deepseek\.com)[^\s"'<]*/g,
    label: 'LLM provider endpoint',
    kind: 'provenance',
  },
  {
    pattern: /generativelanguage\.googleapis\.com[^\s"'<]*/g,
    label: 'LLM provider endpoint',
    kind: 'provenance',
  },
];

function maskSecret(secret: string): string {
  const cut = secret.indexOf('-', 3);
  const prefix = secret.slice(0, cut > 0 ? cut + 1 : 6);
  return `${prefix}… (${secret.length} characters) — rotate this key`;
}

/**
 * Scan text for traces that are unambiguous wherever they appear.
 * Used on document bodies and on plain files inside archives.
 */
export function scanContent(text: string, location: string): Finding[] {
  const body = text.length > LIMITS.maxScanBytes ? text.slice(0, LIMITS.maxScanBytes) : text;
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const entry of CONTENT_PATTERNS) {
    for (const match of body.matchAll(entry.pattern)) {
      const raw = match[0];
      const value = entry.redactValue ? maskSecret(raw) : raw;
      const key = `${entry.label}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        kind: entry.kind,
        confidence: 'confirmed',
        location,
        label: entry.redactValue ? `Credential left in file: ${entry.label}` : entry.label,
        value,
      });
    }
  }
  return findings;
}

/** True for members worth decoding as text rather than treating as binary. */
function looksTextual(name: string): boolean {
  return /\.(txt|md|markdown|json|ya?ml|toml|ini|cfg|conf|env|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|sh|bash|zsh|ps1|sql|csv|log|srt|vtt)$|(^|\/)\.env|(^|\/)dockerfile$/i.test(
    name,
  );
}

export interface ArchiveMember {
  path: string;
  data: Uint8Array;
}

/**
 * Flatten an archive into its members, following nested archives.
 *
 * Returns members rather than findings so the caller can dispatch each one
 * through the normal format detection, which keeps archive support from
 * needing its own parallel copy of every parser.
 */
export function walkArchive(data: Uint8Array, prefix = '', depth = 0): ArchiveMember[] {
  if (depth > LIMITS.maxDepth) return [];

  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipGuarded(data);
  } catch {
    return [];
  }

  const members: ArchiveMember[] = [];
  let total = 0;

  for (const [name, raw] of Object.entries(parts)) {
    if (members.length >= LIMITS.maxMembers) break;
    if (name.endsWith('/')) continue; // Directory entry.
    total += raw.length;
    if (total > LIMITS.maxTotalBytes) break;

    const path = prefix ? `${prefix} > ${name}` : name;
    members.push({ path, data: raw });

    // Nested archives are common in exports: a zip of zips of documents.
    if (/\.(zip|jar|epub)$/i.test(name) && depth < LIMITS.maxDepth) {
      members.push(...walkArchive(raw, path, depth + 1));
    }
  }

  return members;
}

/**
 * Report on a member that no document parser claims: read it as text if the
 * name suggests text, and scan it for credentials and provider identifiers.
 */
export function inspectPlainMember(member: ArchiveMember): Finding[] {
  if (!looksTextual(member.path)) return [];
  let text: string;
  try {
    text = strFromU8(member.data.subarray(0, LIMITS.maxScanBytes));
  } catch {
    return [];
  }
  return scanContent(text, member.path);
}

/** Archive member paths often embed the account name they were zipped from. */
export function pathFindings(paths: string[]): Finding[] {
  const interesting = paths.filter((p) => /Users[\\/]|\/home\/|AppData|\/var\/folders\//.test(p));
  if (interesting.length === 0) return [];
  return [
    {
      kind: 'environment',
      confidence: 'probable',
      location: 'archive member paths',
      label: 'Absolute paths preserved in the archive',
      value: interesting.slice(0, 3).join(', '),
    },
  ];
}

export const ARCHIVE_LIMITS = LIMITS;

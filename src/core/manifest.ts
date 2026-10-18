/**
 * [F-P2 2.4] A chain-of-custody manifest for a clean: for each file, the
 * SHA-256 and size before and after, what was found before and what is left
 * after, the options used, the tool's version and the time.
 *
 * Findings are listed by label, location, kind and level — never by value. A
 * manifest travels with the cleaned documents; carrying the author's name or
 * the local path the clean just removed would undo it.
 */

import type { Finding, Format, InspectOptions } from './types.js';

export const MANIFEST_SCHEMA = 'cirta.manifest/1';

export interface ManifestFinding {
  label: string;
  location: string;
  kind: Finding['kind'];
  confidence: Finding['confidence'];
}

export interface ManifestSide {
  sha256: string;
  size: number;
  findings: ManifestFinding[];
}

export interface ManifestEntry {
  file: string;
  output?: string;
  format: Format;
  before: ManifestSide;
  after: ManifestSide;
  notes: string[];
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  tool: { name: 'cirta'; version: string };
  createdAt: string;
  /** The cleaning options as given: booleans and the names of rules, no rule content. */
  options: Record<string, boolean | string | string[]>;
  files: ManifestEntry[];
}

export async function sha256(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data.slice()));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const strip = (findings: Finding[]): ManifestFinding[] =>
  findings.map(({ label, location, kind, confidence }) => ({ label, location, kind, confidence }));

export async function manifestEntry(input: {
  file: string;
  output?: string;
  format: Format;
  before: Uint8Array;
  after: Uint8Array;
  findingsBefore: Finding[];
  findingsAfter: Finding[];
  notes: string[];
}): Promise<ManifestEntry> {
  return {
    file: input.file,
    ...(input.output ? { output: input.output } : {}),
    format: input.format,
    before: { sha256: await sha256(input.before), size: input.before.length, findings: strip(input.findingsBefore) },
    after: { sha256: await sha256(input.after), size: input.after.length, findings: strip(input.findingsAfter) },
    notes: input.notes,
  };
}

/** The options worth recording: those set, rules by id only. */
export function manifestOptions(options: InspectOptions): Manifest['options'] {
  const out: Manifest['options'] = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === 'rules' && Array.isArray(value)) out.rules = value.map((rule: { id: string }) => rule.id);
    else if (typeof value === 'boolean' && value) out[key] = true;
  }
  return out;
}

export function manifest(version: string, options: InspectOptions, files: ManifestEntry[], at = new Date()): Manifest {
  return { schema: MANIFEST_SCHEMA, tool: { name: 'cirta', version }, createdAt: at.toISOString(), options: manifestOptions(options), files };
}

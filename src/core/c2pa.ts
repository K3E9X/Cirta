/**
 * Reading what a C2PA manifest says about itself.
 *
 * Detecting that a manifest exists is useful; naming the tool it credits and
 * listing what it asserts is more useful. Both come out of the manifest's own
 * structure — a JUMBF box tree whose claim is CBOR — rather than out of a
 * search for printable runs, which is what this replaced and which produced
 * "dnamepmake_test_imagesgversionf0.33.1" on a genuinely signed file.
 *
 * IMPORTANT — this reads, it does not verify.
 * The manifest is signed, and checking that signature means walking a
 * certificate chain to the C2PA trust list. None of that happens here, so
 * everything read out of a manifest is the producer's assertion rather than a
 * proven fact: anyone can write a manifest crediting anyone. Those findings are
 * reported as `probable` for that reason, while the presence of a manifest —
 * a fact about the bytes — stays `confirmed`.
 */

import type { Finding } from './types.js';
import { decodeCbor, asMap, type CborValue } from './cbor.js';
import { findManifest, findByLabel, collectLabels, contentOf, type JumbfBox } from './jumbf.js';

export interface ManifestSummary {
  /** Free-text generator string, e.g. "make_test_images/0.33.1 c2pa-rs/0.33.1". */
  generator?: string;
  /** Structured generator entries, which newer producers write instead. */
  generatorInfo?: Array<{ name: string; version?: string }>;
  /** Hashing algorithm the claim commits to. */
  algorithm?: string;
  /** Assertion labels, which describe what the manifest actually claims. */
  assertions: string[];
}

function readGeneratorInfo(value: CborValue | undefined): ManifestSummary['generatorInfo'] {
  if (!Array.isArray(value)) return undefined;
  const entries: Array<{ name: string; version?: string }> = [];
  for (const item of value) {
    const map = asMap(item);
    const name = map?.['name'];
    if (typeof name !== 'string') continue;
    const version = map?.['version'];
    entries.push(typeof version === 'string' ? { name, version } : { name });
  }
  return entries.length ? entries : undefined;
}

/** Parse a manifest out of the raw bytes of a JUMBF-bearing segment or chunk. */
export function readManifest(bytes: Uint8Array): ManifestSummary | undefined {
  const root = findManifest(bytes);
  if (!root) return undefined;

  const claimBox = findByLabel([root], (label) => label === 'c2pa.claim' || label.startsWith('c2pa.claim'));
  const claim = asMap(claimBox && decodeCbor(contentOf(claimBox, 'cbor') ?? new Uint8Array()));

  const generator = claim?.['claim_generator'];
  const algorithm = claim?.['alg'];

  return {
    ...(typeof generator === 'string' ? { generator } : {}),
    ...(readGeneratorInfo(claim?.['claim_generator_info'])
      ? { generatorInfo: readGeneratorInfo(claim?.['claim_generator_info'])! }
      : {}),
    ...(typeof algorithm === 'string' ? { algorithm } : {}),
    // Only the standard assertion labels are listed; the tree also carries
    // internal boxes whose names would be noise in a report.
    assertions: [...new Set(collectLabels([root]).filter((label) => label.startsWith('c2pa.')))]
      .filter((label) => label !== 'c2pa' && !label.startsWith('c2pa.claim') && label !== 'c2pa.signature')
      .sort(),
  };
}

/** Render the generator as one line, whichever form the producer used. */
function describeGenerator(summary: ManifestSummary): string | undefined {
  if (summary.generatorInfo?.length) {
    return summary.generatorInfo
      .map((entry) => (entry.version ? `${entry.name} ${entry.version}` : entry.name))
      .join(', ');
  }
  return summary.generator;
}

/**
 * Build the findings for a manifest found at `location`.
 *
 * `bytes` is the raw manifest when one is available — an APP11 segment, a caBX
 * chunk, a ZIP part. XMP-embedded credentials have no JUMBF tree, so the
 * attribute form is read instead.
 */
export function describeC2pa(manifest: string, location: string, bytes?: Uint8Array): Finding[] {
  const findings: Finding[] = [
    {
      kind: 'provenance',
      confidence: 'confirmed',
      location,
      label: 'C2PA content credentials',
      value: 'signed provenance manifest',
      affectsVerifiability: true,
    },
  ];

  const summary = bytes ? readManifest(bytes) : undefined;
  const generator = summary ? describeGenerator(summary) : readXmpClaimGenerator(manifest);

  if (generator) {
    findings.push({
      kind: 'provenance',
      // The manifest asserts this; nothing here checks the signature behind it.
      confidence: 'probable',
      location: `${location} (claim_generator)`,
      label: 'Tool credited by the C2PA manifest',
      value: `${generator} — asserted by the manifest, signature not verified`,
    });
  }

  if (summary?.assertions.length) {
    findings.push({
      kind: 'provenance',
      confidence: 'probable',
      location: `${location} (assertions)`,
      label: 'What the C2PA manifest asserts',
      value: summary.assertions.join(', '),
    });
  }

  return findings;
}

/** XMP-embedded credentials carry the generator as an ordinary attribute. */
export function readXmpClaimGenerator(manifest: string): string | undefined {
  for (const key of ['claim_generator_info', 'claim_generator', 'softwareAgent']) {
    const attribute = new RegExp(`${key}\\s*=\\s*["']([^"']{2,120})["']`, 'i').exec(manifest);
    if (attribute?.[1]) return attribute[1].trim();
    const element = new RegExp(`<[^<>]*${key}[^<>]*>([^<]{2,120})<`, 'i').exec(manifest);
    if (element?.[1]?.trim()) return element[1].trim();
  }
  return undefined;
}

export type { JumbfBox };

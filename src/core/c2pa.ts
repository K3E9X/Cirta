/**
 * Reading what a C2PA manifest says about itself.
 *
 * Detecting that a manifest exists is useful; naming the tool it credits is
 * more useful, and `claim_generator` is exactly that field — the producer's own
 * declaration of what made the file.
 *
 * IMPORTANT — this reads, it does not verify.
 * A C2PA manifest is cryptographically signed, and checking that signature
 * means walking a certificate chain against the C2PA trust list. None of that
 * happens here, so a claim generator read out of a manifest is the producer's
 * assertion rather than a proven fact: anyone can write a manifest that credits
 * anyone. It is reported as `probable` for that reason, while the mere presence
 * of a manifest — which is a fact about the bytes — stays `confirmed`.
 */

import type { Finding } from './types.js';

/** Printable text following a CBOR key, which is how JUMBF stores these fields. */
const CLAIM_KEYS = ['claim_generator_info', 'claim_generator', 'softwareAgent', 'alg'];

const PRINTABLE = /[\x20-\x7e]{3,120}/;

/**
 * Pull the claim generator out of a manifest.
 *
 * Two encodings are handled with one approach. In XMP the field appears as an
 * ordinary attribute or element; in a JUMBF box it is a CBOR key followed
 * directly by its text value. Searching for the key name and taking the
 * printable run after it covers both without a CBOR parser, which would be a
 * disproportionate dependency for a single field.
 */
export function readClaimGenerator(manifest: string): string | undefined {
  for (const key of CLAIM_KEYS) {
    if (key === 'alg') continue;

    const attribute = new RegExp(`${key}\\s*=\\s*["\']([^"\']{2,120})["\']`, 'i').exec(manifest);
    if (attribute?.[1]) return attribute[1].trim();

    const element = new RegExp(`<[^<>]*${key}[^<>]*>([^<]{2,120})<`, 'i').exec(manifest);
    if (element?.[1]?.trim()) return element[1].trim();

    const index = manifest.indexOf(key);
    if (index === -1) continue;
    const after = manifest.slice(index + key.length, index + key.length + 160);
    const run = PRINTABLE.exec(after);
    // The first printable run after the key is the value; leading CBOR length
    // bytes are non-printable and fall outside the match.
    if (run?.[0]) {
      const value = run[0].replace(/^[^A-Za-z0-9]+/, '').trim();
      if (value.length >= 2) return value.slice(0, 120);
    }
  }
  return undefined;
}

/** Build the findings for a manifest found at `location`. */
export function describeC2pa(manifest: string, location: string): Finding[] {
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

  const generator = readClaimGenerator(manifest);
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
  return findings;
}

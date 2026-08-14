/**
 * The field where a file declares how it was made.
 *
 * `digitalSourceType` is IPTC's vocabulary for exactly that, and it is what
 * C2PA carries in its actions assertion and what the EU AI Act's transparency
 * obligations are drafted around. When a generator is being honest about
 * producing AI content, this is where it says so — one URI, in the metadata,
 * meant to be read.
 *
 * It is worth reading precisely rather than pattern-matching, because the
 * vocabulary distinguishes things that a keyword search flattens.
 * `algorithmicMedia` is a gradient or a fractal: made by an algorithm, and not
 * by a model that was trained on anything. `trainedAlgorithmicMedia` is the
 * generative case. Reporting the first as "AI-generated" would be wrong in
 * exactly the direction this tool exists to avoid.
 */

import type { Finding } from './types.js';

interface SourceType {
  /** How to describe it to a reader. */
  summary: string;
  /** True only for the values that mean a trained model produced the content. */
  generative: boolean;
  confidence: Finding['confidence'];
}

/** https://cv.iptc.org/newscodes/digitalsourcetype/ */
const VOCABULARY: Record<string, SourceType> = {
  trainedAlgorithmicMedia: {
    summary: 'created by a generative model — the file says so itself',
    generative: true,
    confidence: 'confirmed',
  },
  compositeWithTrainedAlgorithmicMedia: {
    summary: 'a composite including generative-model content — the file says so itself',
    generative: true,
    confidence: 'confirmed',
  },
  algorithmicallyEnhanced: {
    summary: 'human-made, then altered by an algorithm',
    generative: false,
    confidence: 'probable',
  },
  algorithmicMedia: {
    // A gradient is algorithmic media. So is a fractal. Neither involved a
    // model, and the distinction is the whole reason to read the vocabulary
    // rather than grep for the field name.
    summary: 'produced by an algorithm, which does not by itself mean a trained model',
    generative: false,
    confidence: 'probable',
  },
  dataDrivenMedia: {
    summary: 'generated from data rather than captured',
    generative: false,
    confidence: 'probable',
  },
  digitalCapture: {
    summary: 'captured by a camera — an explicit statement that it is not generated',
    generative: false,
    confidence: 'informational',
  },
  digitalArt: { summary: 'digital art', generative: false, confidence: 'informational' },
  softwareImage: {
    summary: 'a screenshot or other software-rendered image',
    generative: false,
    confidence: 'informational',
  },
  composite: { summary: 'a composite of several sources', generative: false, confidence: 'informational' },
  humanEdits: { summary: 'edited by a human', generative: false, confidence: 'informational' },
  minorHumanEdits: { summary: 'minor human edits', generative: false, confidence: 'informational' },
  virtualRecording: {
    summary: 'a recording of a virtual scene',
    generative: false,
    confidence: 'informational',
  },
};

/** The term at the end of the IPTC URI, or the bare term if that is what is written. */
function term(value: string): string | undefined {
  const last = value.trim().split(/[/#]/).pop();
  return last && last in VOCABULARY ? last : undefined;
}

export interface SourceDeclaration {
  term: string;
  generative: boolean;
}

/** Build the finding for one declaration, or nothing if the term is unknown. */
export function describeSourceType(value: string, location: string): Finding[] {
  const name = term(value);
  if (!name) return [];
  const entry = VOCABULARY[name]!;
  return [
    {
      kind: 'provenance',
      confidence: entry.confidence,
      location,
      label: 'How the file says it was made',
      value: `${name} — ${entry.summary}`,
    },
  ];
}

/**
 * Find the declaration in any metadata blob: an XMP packet, an HTML head, a
 * JSON-LD block. Both the namespaced XMP spelling and the bare CBOR key are
 * matched, since the same vocabulary is written both ways.
 */
const IN_TEXT =
  /(?:Iptc4xmpExt:)?[Dd]igitalSourceType["'\s:=>]+(?:[^"'<>\s]*[/#])?([A-Za-z]+)/g;

export function findSourceTypes(text: string, location: string): Finding[] {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const match of text.matchAll(IN_TEXT)) {
    const name = match[1] && match[1] in VOCABULARY ? match[1] : undefined;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    findings.push(...describeSourceType(name, location));
  }
  return findings;
}

/** True when any finding is a declaration that a trained model made the content. */
export function declaresGenerative(findings: Finding[]): boolean {
  return findings.some(
    (finding) =>
      finding.label === 'How the file says it was made' &&
      VOCABULARY[finding.value.split(' — ')[0] ?? '']?.generative === true,
  );
}

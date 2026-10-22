/**
 * Findings as SARIF, the format static-analysis tools agree on.
 *
 * The point is not the format for its own sake. GitHub Code Scanning, GitLab,
 * Azure DevOps and most IDEs read SARIF directly, so emitting it is what turns
 * this from a tool somebody remembers to run into a check that appears on a
 * pull request next to the compiler warnings. A bidi override in source — the
 * Trojan Source case this tool already detects — belongs exactly there.
 *
 * Deliberately a plain object rather than a schema library: SARIF is large and
 * this uses a small, stable corner of it, and a dependency that parses the
 * whole specification would be more code than the tool it serves.
 */

import type { Finding, InspectResult, Confidence } from './types.js';

/**
 * Confidence maps onto SARIF's three levels in the order the rest of the tool
 * already uses. `confirmed` is an error because it is verbatim identifying
 * data; `informational` is a note because naming the software that wrote a file
 * is not a problem, it is context.
 */
const LEVEL: Record<Confidence, 'error' | 'warning' | 'note'> = {
  confirmed: 'error',
  probable: 'warning',
  informational: 'note',
};

/** A stable rule id from a human label, so results group across runs. */
export function ruleId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `ciirta/${slug || 'finding'}`;
}

export interface SarifInput {
  file: string;
  result?: InspectResult;
  error?: string;
}

interface Rule {
  id: string;
  name: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: 'error' | 'warning' | 'note' };
}

/**
 * A SARIF 2.1.0 log for one run over any number of files.
 *
 * Files that could not be read become results too, rather than vanishing: a
 * report that silently drops what it failed to open is how a scan passes by
 * doing nothing.
 */
export function toSarif(entries: SarifInput[], version?: string): object {
  const rules = new Map<string, Rule>();
  const results: object[] = [];

  const add = (file: string, finding: Finding) => {
    const id = ruleId(finding.label);
    if (!rules.has(id)) {
      rules.set(id, {
        id,
        name: finding.label,
        shortDescription: { text: finding.label },
        defaultConfiguration: { level: LEVEL[finding.confidence] },
      });
    }
    results.push({
      ruleId: id,
      level: LEVEL[finding.confidence],
      message: { text: `${finding.label}: ${finding.value} (${finding.location})` },
      locations: [
        {
          physicalLocation: {
            // SARIF wants a URI reference; a relative path is one, and keeping
            // it relative is what lets a CI server resolve it in the checkout.
            artifactLocation: { uri: file.replace(/\\/g, '/') },
          },
        },
      ],
    });
  };

  for (const entry of entries) {
    if (entry.error) {
      const id = 'ciirta/unreadable';
      if (!rules.has(id)) {
        rules.set(id, {
          id,
          name: 'File could not be read',
          shortDescription: { text: 'File could not be read' },
          defaultConfiguration: { level: 'warning' },
        });
      }
      results.push({
        ruleId: id,
        level: 'warning',
        message: { text: entry.error },
        locations: [
          { physicalLocation: { artifactLocation: { uri: entry.file.replace(/\\/g, '/') } } },
        ],
      });
      continue;
    }
    for (const finding of entry.result?.findings ?? []) add(entry.file, finding);
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Ciirta',
            informationUri: 'https://github.com/k3e9x/Cirta',
            // The caller's version: the library cannot know which Ciirta embeds it.
            ...(version ? { version } : {}),
            rules: [...rules.values()],
          },
        },
        results,
      },
    ],
  };
}

export type Severity = Confidence;

const ORDER: Confidence[] = ['informational', 'probable', 'confirmed'];

/**
 * True when any finding is at least as serious as `threshold`.
 *
 * This is what a pipeline gates on. Separated from the reporting so the same
 * rule decides the exit code and the summary line, rather than two places
 * disagreeing about what counts as a failure.
 */
export function meetsThreshold(entries: SarifInput[], threshold: Confidence): boolean {
  const floor = ORDER.indexOf(threshold);
  return entries.some((entry) =>
    (entry.result?.findings ?? []).some((f) => ORDER.indexOf(f.confidence) >= floor),
  );
}

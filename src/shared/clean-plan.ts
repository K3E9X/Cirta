/**
 * [F-2.7] The cleaning options as the page offers them: which apply to a
 * file — its format takes them, and it holds something they would change —
 * and what a download will do with the reader's choices. Keys only: each
 * interface words them in its own language.
 */

import type { Finding, Format } from '../core/types.js';
import { HIDDEN_LABEL, removableFinding } from '../core/hidden-text.js';
import { TRACKED_LABELS } from '../core/tracked-changes.js';

export const CLEAN_KEYS = [
  'removeHidden',
  'acceptChanges',
  'removeComments',
  'removeNotes',
  'removeHiddenSlides',
  'removeHiddenSheets',
  'stripActive',
  'stripRemote',
  'stripTracking',
  'removeAttachments',
  'flattenAnnotations',
  'burnRedactions',
  'clearOutputs',
  'reencodeImages',
] as const;

export type CleanKey = (typeof CLEAN_KEYS)[number];
export type CleanChoices = Partial<Record<CleanKey, boolean>>;

const OFFICE: Format[] = ['docx', 'xlsx', 'pptx'];

/**
 * [R3] What --strip-active takes out: active content, but not what is loaded
 * from the network, which --strip-remote-resources is for. The command line's
 * « Run again with --strip-active » counts the same findings, so it is never
 * offered for something the option would leave.
 */
export const strippedByActive = (f: Finding): boolean =>
  f.kind === 'active-content' &&
  f.confidence !== 'informational' &&
  f.label !== 'Tracking pixel' &&
  f.label !== 'Remote resource loaded on opening' &&
  // [R6] Named, not removed: a DTD is part of the XML it heads.
  f.label !== 'DTD with entities in an XML part (unresolved)' &&
  // A mail's attachments are read, not rewritten — except an HTML or SVG one.
  !/^attachment (?!\S*\.(?:html?|xhtml|svg) →)/i.test(f.location);
const labelled = (...labels: string[]) => (findings: Finding[]) => findings.filter((f) => labels.includes(f.label)).length;

/** For each option: the formats the cleaner applies it to, and how many findings it would act on. */
const OPTIONS: Record<CleanKey, { formats: Format[]; count: (findings: Finding[]) => number }> = {
  removeHidden: { formats: ['docx', 'pptx', 'html', 'markdown', 'epub'], count: (fs) => fs.filter(removableFinding).length },
  acceptChanges: { formats: ['docx'], count: (fs) => fs.filter((f) => TRACKED_LABELS.has(f.label)).length },
  removeComments: { formats: OFFICE, count: labelled('Comment text') },
  removeNotes: { formats: ['pptx'], count: (fs) => labelled('Speaker notes text')(fs) || labelled('Speaker notes')(fs) },
  removeHiddenSlides: { formats: ['pptx'], count: (fs) => labelled('Text of a hidden slide')(fs) || labelled('Hidden slides')(fs) },
  removeHiddenSheets: { formats: ['xlsx'], count: labelled('Hidden worksheets') },
  stripActive: { formats: ['pdf', 'rtf', 'vsdx', 'html', 'svg', 'markdown', 'eml', ...OFFICE], count: (fs) => fs.filter(strippedByActive).length },
  stripRemote: { formats: ['html', 'markdown'], count: labelled('Tracking pixel', 'Remote resource loaded on opening') },
  stripTracking: { formats: ['html', 'markdown', 'pdf', 'epub', ...OFFICE], count: labelled('Tracking parameters in a link') },
  removeAttachments: { formats: ['pdf'], count: labelled('Embedded file') },
  flattenAnnotations: { formats: ['pdf'], count: labelled('Annotation authors') },
  burnRedactions: { formats: ['pdf'], count: labelled(HIDDEN_LABEL.covered) },
  // A picture can always be rebuilt: offered on every JPEG and PNG.
  reencodeImages: { formats: ['jpeg', 'png'], count: () => 1 },
  clearOutputs: { formats: ['ipynb'], count: (fs) => new Set(fs.filter((f) => /^cells\[\d+\]\.outputs\[\d+\]/.test(f.location)).map((f) => f.location.split(' ')[0])).size },
};

/** [R3] The formats --strip-active rewrites; elsewhere the command line does not offer it. */
export const STRIP_ACTIVE_FORMATS: ReadonlySet<Format> = new Set(OPTIONS.stripActive.formats);

export interface Offer {
  key: CleanKey;
  /** How many findings it would act on: what the option's label counts. */
  count: number;
}

export function offered(format: Format, findings: Finding[]): Offer[] {
  return CLEAN_KEYS.filter((key) => OPTIONS[key].formats.includes(format))
    .map((key) => ({ key, count: OPTIONS[key].count(findings) }))
    .filter((offer) => offer.count > 0);
}

/** What a download will do beyond the metadata: the chosen options among those offered. */
export function plan(format: Format, findings: Finding[], choices: CleanChoices): Offer[] {
  return offered(format, findings).filter((offer) => choices[offer.key] === true);
}

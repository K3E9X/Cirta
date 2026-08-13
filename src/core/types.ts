/**
 * Shared types for inspection and redaction results.
 *
 * Two operations exist across every supported format:
 *   - inspect: report what provenance/identifying data a file or string carries
 *   - redact:  return a copy with that data removed
 *
 * Both are purely local; nothing in this package performs network I/O.
 */

export type Format = 'pdf' | 'pptx' | 'docx' | 'xlsx' | 'text';

/** Why a piece of embedded data is worth surfacing to the user. */
export type FindingKind =
  /** Names a person or account: author, last-modified-by, company. */
  | 'identity'
  /** Names the producing software or model, including C2PA provenance manifests. */
  | 'provenance'
  /** Creation/modification timestamps and editing-time counters. */
  | 'timestamp'
  /** Local filesystem paths, template locations, printer names. */
  | 'environment'
  /** Characters with no visual rendering that survive copy/paste. */
  | 'invisible-character';

/**
 * How much a finding actually tells someone who receives the file.
 *
 * Reporting every field at equal weight buries the two lines that matter under
 * a dozen that do not, so each finding carries its own weight:
 *
 *   confirmed      Verbatim identifying data — a person, an organisation, a
 *                  local path, a signed manifest. Read directly from a known
 *                  field, no inference involved.
 *   probable       Real information about you or your workflow, but not
 *                  necessarily sensitive: titles, timestamps, revision counts.
 *   informational  Names the software rather than the author. Worth showing,
 *                  rarely worth worrying about.
 */
export type Confidence = 'confirmed' | 'probable' | 'informational';

export interface Finding {
  kind: FindingKind;
  confidence: Confidence;
  /** Where the value lives, e.g. `docProps/core.xml:dc:creator` or `/Info /Author`. */
  location: string;
  /** Human-readable field name. */
  label: string;
  /** The value found, truncated for display by the caller. */
  value: string;
  /**
   * True when removing this changes how the file is verified by third parties
   * rather than merely removing personal data — currently only C2PA manifests.
   */
  affectsVerifiability?: boolean;
}

/** Order used when sorting a report so the most telling findings come first. */
export const CONFIDENCE_ORDER: Record<Confidence, number> = {
  confirmed: 0,
  probable: 1,
  informational: 2,
};

export function byConfidence(a: Finding, b: Finding): number {
  return CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
}

/**
 * Caveats attached to a result. These are codes rather than sentences so that
 * each front-end supplies its own wording; the CLI reports in English and the
 * web interface in French from the same core.
 */
export type NoteCode =
  /** Only PDF metadata was examined; page text was not. */
  | 'scope:pdf-metadata-only'
  /** Only Office document properties were examined; document body was not. */
  | 'scope:ooxml-metadata-only'
  /** Only invisible characters were examined. */
  | 'scope:invisible-characters-only'
  /** A C2PA manifest was removed, so the file is no longer verifiable. */
  | 'removed:c2pa';

export interface Note {
  code: NoteCode;
  /** Optional specifics, such as the part path a manifest was removed from. */
  detail?: string;
}

export interface InspectResult {
  format: Format;
  findings: Finding[];
  /**
   * Caveats about what was *not* determined. Kept separate from findings so the
   * report never implies a clean bill of health it cannot give.
   */
  notes: Note[];
}

export interface RedactResult {
  format: Format;
  /** The rewritten document. For `text`, the caller uses `text` instead. */
  data?: Uint8Array;
  /** The rewritten string, for text input. */
  text?: string;
  /** Findings that were removed. */
  removed: Finding[];
  notes: Note[];
}

/** Truncate a value for terminal/DOM display without breaking surrogate pairs. */
export function preview(value: string, max = 72): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return [...flat].slice(0, max).join('') + '…';
}

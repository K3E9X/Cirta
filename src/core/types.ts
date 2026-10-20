/**
 * Shared types for inspection and redaction results.
 *
 * Two operations exist across every supported format:
 *   - inspect: report what provenance/identifying data a file or string carries
 *   - redact:  return a copy with that data removed
 *
 * Both are purely local; nothing in this package performs network I/O.
 */

import type { XrayEngine, XrayRegion } from './xray.js';

export type Format =
  | 'pdf'
  | 'pptx'
  | 'docx'
  | 'xlsx'
  /** [F-P2 2.2] A Visio drawing. */
  | 'vsdx'
  | 'odt'
  | 'ods'
  | 'odp'
  | 'svg'
  | 'html'
  | 'markdown'
  | 'jpeg'
  | 'png'
  /** [F-P2 2.2] More pictures: WebP and GIF cleaned, TIFF, HEIC and AVIF inspected only. */
  | 'webp'
  | 'gif'
  | 'tiff'
  | 'heic'
  | 'avif'
  | 'zip'
  | 'eml'
  /** [F-2.2] Legacy Office (OLE2 compound files) and Outlook messages: inspected, not rewritten. */
  | 'doc'
  | 'xls'
  | 'ppt'
  | 'msg'
  /** [F-2.2] A Jupyter notebook. */
  | 'ipynb'
  /** [F-P2 2.2] Rich Text Format. */
  | 'rtf'
  /** [F-P2 2.2] An EPUB book. */
  | 'epub'
  /** [F-P2 2.2] A LaTeX source. */
  | 'latex'
  /** [F-P2 2.2] An iCalendar file and a vCard. */
  | 'ics'
  | 'vcf'
  /** [F-P3 2.2] Video and audio: MP4, QuickTime and M4A cleaned in place. */
  | 'mp4'
  | 'mov'
  | 'm4a'
  /** [F-P3 2.2] MPEG audio with its ID3, ID3v1 and APEv2 tags. */
  | 'mp3'
  /** [F-P3 2.2] RIFF/WAVE, and RF64 inspected only. */
  | 'wav'
  /** [F-P3 2.2] Archives inspected only: TAR, gzip, 7z. */
  | 'tar'
  | 'gz'
  | '7z'
  | 'text';

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
  | 'invisible-character'
  /**
   * An address that reads as one destination and resolves to another: a
   * lookalike alphabet, a mixed-script hostname, credentials before an "@".
   *
   * Separate from `invisible-character` because these characters render
   * perfectly well — that is the whole attack. Filing a Cyrillic "а" under
   * "invisible" contradicted this union's own definition and showed up in the
   * report as a row labelled "invisible" next to a domain a reader can see.
   */
  | 'deceptive-link'
  /**
   * [F-2.1] Something the file does rather than says: a script, an action
   * run on opening, a macro, a remote template, a file carried inside.
   */
  | 'active-content'
  /**
   * [F-P2 2.1] A file name built to be misread: a direction control that
   * reverses its end, a double extension hiding a program, a path that climbs
   * out of the folder it is extracted to.
   */
  | 'deceptive-name';

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
 * Findings that describe the file's construction rather than something written
 * into it — how a PDF's trailer is built, which parts an ODF package carries,
 * whether a .docx has revision identifiers.
 *
 * The distinction matters because redaction cannot touch them. Removing a
 * `/Producer` string makes it gone; the absence of a `/StructTreeRoot` is the
 * document's shape, and the only way to change it is to rebuild the document in
 * the application whose shape you want. A cleaned file still reports these, and
 * that is not a failure of the cleaning — it is the honest state of the file.
 * Callers separate the two so a report can say which is which.
 */
export function isStructuralFinding(finding: Finding): boolean {
  return /\bstructure$/.test(finding.location);
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
  /** A mail: its header block, each MIME part by its type, attachments like archive members. */
  | 'scope:email'
  /** [F-2.2] A legacy .doc/.xls/.ppt: properties, macros and objects; not the text, and never rewritten. */
  | 'scope:legacy-office'
  /** [F-2.2] An Outlook .msg: properties, headers, body and attachments; never rewritten. */
  | 'scope:outlook'
  /** [F-2.2] A Jupyter notebook: metadata, outputs and the pictures in them. */
  | 'scope:notebook'
  | 'scope:rtf'
  | 'scope:epub'
  | 'scope:latex'
  | 'scope:ics'
  | 'scope:vcf'
  | 'removed:latex-comments'
  /** [F-P2 2.4] The picture was rebuilt from its pixels, on request. */
  | 'reencoded:image'
  /** [F-2.2] A notebook's outputs were removed, on request. */
  | 'removed:outputs'
  /** Only invisible characters were examined. */
  | 'scope:invisible-characters-only'
  /** Only markup metadata was examined; the body text was not. */
  | 'scope:markup-metadata-only'
  /** Only image container metadata was examined; the pixels were not. */
  | 'scope:image-metadata-only'
  /** [F-P3 2.2] Video and audio: the container's metadata, not the picture or the sound. */
  | 'scope:media'
  /** [F-P3 2.2] A TAR, gzip or 7z archive: read, never rewritten. */
  | 'scope:archive-inspect-only'
  /** An archive was walked; the report aggregates its members. */
  | 'scope:archive'
  /** Archive traversal stopped at a built-in limit. */
  | 'limit:archive-truncated'
  /** [F-P3 2.2] Members of a 7z behind a coder not decoded here, or encrypted. Detail: "<coder>: <names>", several joined by "; ". */
  | 'limit:archive-unread'
  /** [F-P3 2.2] A 7z whose header is encrypted: not even the names can be read. */
  | 'limit:archive-encrypted'
  /** A C2PA manifest was removed, so the file is no longer verifiable. */
  | 'removed:c2pa'
  /** Reported items that are document content, not metadata, and were left alone. */
  | 'kept:content'
  /** Findings that survive redaction because they sit in the content itself. */
  | 'kept:in-content'
  /** PDF page text was not rendered to look for text a reader cannot see. */
  | 'limit:hidden-text-unchecked'
  /** Hidden-text rendering stopped at a page or time limit. */
  | 'limit:hidden-text-truncated'
  /** Most of a page's text drew no ink: hidden on purpose, or not drawable here. */
  | 'limit:hidden-text-doubtful'
  /** Text a reader could not see was taken out, on request. */
  | 'removed:hidden-text'
  /** Tracked changes were accepted, on request. */
  | 'removed:tracked-changes'
  /** Comments were removed, on request. */
  | 'removed:comments'
  /** [F-2.1] Scripts, actions, macros or embedded files were removed, on request. */
  | 'removed:active-content'
  /** [F-2.1] Resources loaded from the network were removed, on request. */
  | 'removed:remote-resources'
  /** [F-2.4] Speaker notes were removed, on request. */
  | 'removed:notes'
  /** [F-2.4] Hidden slides were removed, on request. */
  | 'removed:hidden-slides'
  /** [F-2.4] Hidden sheets were removed, on request. */
  | 'removed:hidden-sheets'
  /** [F-2.4] Hidden sheets were asked to go and stayed: something reads them. */
  | 'kept:hidden-sheets'
  /** [F-2.4] Embedded files were removed, on request. */
  | 'removed:attachments'
  /** [F-2.4] Annotations were drawn into the page and removed; detail "drawn/removed". */
  | 'flattened:annotations'
  /** [F-2.4] Tracking parameters were removed from links, on request. */
  | 'removed:tracking-params'
  /** [F-2.4] Pages turned into pictures to burn covered text; detail lists them. */
  | 'rasterized:pages'
  /** [C8] Accented letters were recomposed (NFC) because the two forms were mixed. */
  | 'changed:nfc'
  /** [C8] Typographic spaces were left as written. */
  | 'kept:typographic-spaces';

export interface Note {
  code: NoteCode;
  /** Optional specifics, such as the part path a manifest was removed from. */
  detail?: string;
}

/**
 * What an inspection can be handed beyond the bytes. The hidden-text check
 * renders pages, and rendering needs a canvas the core cannot import for
 * itself: the command line brings a native one, the page its worker's.
 */
export interface InspectOptions {
  xray?: XrayEngine;
  /** Pictures of what was found hidden, for an interface to show. Never in the report itself. */
  onHidden?: (regions: XrayRegion[]) => void;
  /**
   * Cleaning only: also take out text a reader cannot see, in the formats that
   * mark it (Word, PowerPoint, HTML, Markdown). Off by default — it changes what the
   * document contains, which the rest of the cleaning never does.
   */
  removeHidden?: boolean;
  /** Cleaning only: accept every tracked change in a Word document. Off by default, for the same reason. */
  acceptChanges?: boolean;
  /** Cleaning only: remove every comment from Word, Excel and PowerPoint documents. Off by default. */
  removeComments?: boolean;
  /** [F-2.1] Cleaning only: remove scripts, actions, macros and embedded files. Off by default. */
  stripActive?: boolean;
  /** [F-2.4] Cleaning only: remove every slide's speaker notes. */
  removeNotes?: boolean;
  /** [F-2.4] Cleaning only: remove slides marked hidden, with their notes. */
  removeHiddenSlides?: boolean;
  /** [F-2.4] Cleaning only: remove hidden sheets nothing else refers to. */
  removeHiddenSheets?: boolean;
  /** [F-2.4] Cleaning only: remove the files a PDF carries. */
  removeAttachments?: boolean;
  /** [F-2.4] Cleaning only: draw PDF annotations into their pages and remove them. */
  flattenAnnotations?: boolean;
  /** [F-2.4] Cleaning only: remove tracking parameters (utm_*, fbclid, gclid…) from links. */
  stripTracking?: boolean;
  /** [F-2.4] Cleaning only: remove PDF text covered by a shape for good. Needs `xray`. */
  burnRedactions?: boolean;
  /** [F-2.1] Cleaning only: remove pictures, styles, scripts and frames loaded from the network (HTML, Markdown). Off by default. */
  stripRemote?: boolean;
  /** [F-P2 2.4] Cleaning only: rebuild JPEG and PNG pictures from their pixels. Needs `imageCodec`. */
  reencodeImages?: boolean;
  /** [F-P2 2.4] Decodes and encodes pictures for `reencodeImages`: a native canvas, the browser's. */
  imageCodec?: import('./reencode.js').ImageCodec;
  /** [F-2.2] Cleaning only: empty a notebook's outputs and execution counts. Off by default. */
  clearOutputs?: boolean;
  /** [F-2.3] Also look for personal data in the document's text: emails, phones, IBANs, cards… Off by default. */
  pii?: boolean;
  /** [F-2.3] An organisation's own rules, parsed by parseRules(). */
  rules?: import('./rules.js').Rule[];
  /** [R1] Where the rules run. The interfaces pass one that stops a rule over its time budget; by default, this thread. */
  rulesRunner?: import('./rules.js').RulesRunner;
  /** [F-2.1] Inspect a file found inside this one, as the dispatcher would. Set by the dispatcher. */
  inspectMember?: (data: Uint8Array, name: string) => Promise<InspectResult>;
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
  /** Findings that were removed — checked by inspecting the output, not assumed. */
  removed: Finding[];
  /**
   * Findings the output still carries and that matter: re-inspection's
   * non-informational results. Informational survivors are absent on purpose —
   * they are what a clean keeps deliberately, the cleaner's own software name
   * among them. Undefined when the output was not re-inspected.
   */
  kept?: Finding[];
  notes: Note[];
}

/** Truncate a value for terminal/DOM display without breaking surrogate pairs. */
/** [R2] Between the places of one finding reported at several: a mail's text and HTML versions. */
export const PLACES = ' · ';

export function preview(value: string, max = 72): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return [...flat].slice(0, max).join('') + '…';
}

/**
 * Inspection and redaction of Office Open XML documents (.pptx, .docx, .xlsx).
 *
 * An OOXML file is a ZIP container. Identifying data lives in a handful of
 * well-known parts:
 *   docProps/core.xml    author, last editor, timestamps, revision counter
 *   docProps/app.xml     producing application, company, manager, template path
 *   docProps/custom.xml  arbitrary custom properties
 *   docProps/thumbnail.* rendered preview of the first page or slide
 *   word/settings.xml    rsid values, which correlate documents edited together
 *   comments / revisions author names attached to tracked changes
 */

import { zipSync, strToU8, strFromU8 } from 'fflate';
import { unzipGuarded } from './zip.js';
import { inspectImage, stripImageMetadata } from './image.js';
import { fingerprint } from './fingerprint.js';
import { describeC2pa } from './c2pa.js';
import { findSourceTypes } from './sourcetype.js';
import { scanContent } from './archive.js';
import { scanText, cleanText, isArrangementFinding } from './text.js';
import type { Finding, InspectResult, RedactResult, Format, Note, Confidence } from './types.js';
import { byConfidence, preview } from './types.js';
import { hiddenInDocx, stripHiddenDocx } from './hidden-text.js';
import { hiddenInPptx, stripHiddenPptx } from './hidden-pptx.js';
import { acceptChangesInParts, elements, trackedChangeFindings } from './tracked-changes.js';
import { anonymizeComments, commentFindings, commentParts, countComments } from './comments.js';
import { activeOfficeFindings, stripActiveOffice, stripTrackingOffice } from './ooxml-active.js';
import { workbookActiveFindings } from './xlsx-active.js';
import { removeHiddenSheets, removeHiddenSlides, removeNotes } from './content-options.js';
import {
  getElementText,
  setElementText,
  removeElement,
  collectAttribute,
  collectNamedProperties,
  collectTextContent,
  mapTextContent,
} from './xml.js';

type Parts = Record<string, Uint8Array>;

const CORE_FIELDS: Array<{ tag: string; label: string; kind: Finding['kind']; confidence: Confidence }> = [
  { tag: 'dc:creator', label: 'Author', kind: 'identity', confidence: 'confirmed' },
  { tag: 'cp:lastModifiedBy', label: 'Last modified by', kind: 'identity', confidence: 'confirmed' },
  { tag: 'dc:title', label: 'Title', kind: 'identity', confidence: 'probable' },
  { tag: 'dc:subject', label: 'Subject', kind: 'identity', confidence: 'probable' },
  { tag: 'dc:description', label: 'Description', kind: 'identity', confidence: 'probable' },
  { tag: 'cp:keywords', label: 'Keywords', kind: 'identity', confidence: 'probable' },
  { tag: 'cp:category', label: 'Category', kind: 'identity', confidence: 'probable' },
  { tag: 'cp:contentStatus', label: 'Content status', kind: 'identity', confidence: 'informational' },
  { tag: 'cp:revision', label: 'Revision number', kind: 'timestamp', confidence: 'probable' },
  { tag: 'cp:lastPrinted', label: 'Last printed', kind: 'timestamp', confidence: 'probable' },
  { tag: 'dcterms:created', label: 'Created', kind: 'timestamp', confidence: 'probable' },
  { tag: 'dcterms:modified', label: 'Modified', kind: 'timestamp', confidence: 'probable' },
];

const APP_FIELDS: Array<{ tag: string; label: string; kind: Finding['kind']; confidence: Confidence }> = [
  { tag: 'Application', label: 'Producing application', kind: 'provenance', confidence: 'informational' },
  { tag: 'AppVersion', label: 'Application version', kind: 'provenance', confidence: 'informational' },
  { tag: 'Company', label: 'Company', kind: 'identity', confidence: 'confirmed' },
  { tag: 'Manager', label: 'Manager', kind: 'identity', confidence: 'confirmed' },
  { tag: 'Template', label: 'Template', kind: 'environment', confidence: 'confirmed' },
  { tag: 'TotalTime', label: 'Total editing time', kind: 'timestamp', confidence: 'probable' },
];

/** Timestamp-typed elements are removed rather than blanked; an empty
 *  `dcterms:created` is not a valid W3CDTF value. */
const DATE_TAGS = new Set(['dcterms:created', 'dcterms:modified']);

/**
 * Replacement for comment and tracked-change author names. The attribute is
 * required by the schema, so the name is substituted rather than deleted; the
 * placeholder is then ignored on inspection so that a redacted document reports
 * as clean.
 */
const ANONYMOUS_AUTHOR = 'Author';

/**
 * Values that name a library's default rather than a person.
 *
 * `Un-named` is what the `docx` JavaScript library writes into `dc:creator`
 * and `cp:lastModifiedBy` when the caller supplies neither — verified in its
 * source, not inferred. Reporting it as confirmed identifying data is a false
 * positive: nobody is called that, and clearing a field that already holds a
 * placeholder achieves nothing.
 *
 * It is still worth knowing it is there, which is what the generator signature
 * below does with it.
 */
const PLACEHOLDER_VALUES = new Set(['Un-named', 'Unknown', 'unknown', 'Anonymous', ANONYMOUS_AUTHOR]);

function detectOoxmlFormat(parts: Parts): Format {
  if (parts['word/document.xml']) return 'docx';
  if (parts['ppt/presentation.xml']) return 'pptx';
  if (parts['xl/workbook.xml']) return 'xlsx';
  return 'docx';
}

function readText(parts: Parts, path: string): string | undefined {
  const raw = parts[path];
  return raw ? strFromU8(raw) : undefined;
}

/** Locate a C2PA provenance manifest if the producer embedded one. */
function findC2paParts(parts: Parts): string[] {
  return Object.keys(parts).filter((p) => /c2pa|contentcredentials|content_credentials/i.test(p));
}

/** Embedded pictures, which keep their own camera metadata. */
function findMediaParts(parts: Parts): string[] {
  return Object.keys(parts).filter((p) => /^(ppt|word|xl)\/media\//.test(p));
}

/**
 * A hyperlink pointing at the author's own disk or an internal share leaks the
 * username and the network topology. Web links are ignored.
 */
const LOCAL_TARGET = /^(file:|[a-z]:[\\/]|\\\\)/i;

function findLocalHyperlinks(parts: Parts): Array<{ part: string; target: string }> {
  const out: Array<{ part: string; target: string }> = [];
  for (const [path, raw] of Object.entries(parts)) {
    if (!path.endsWith('.rels')) continue;
    const xml = strFromU8(raw);
    for (const target of collectAttribute(xml, 'Target')) {
      const decoded = decodeURI(target.replace(/&amp;/g, '&'));
      if (LOCAL_TARGET.test(decoded)) out.push({ part: path, target: decoded });
    }
  }
  return out;
}

/** Slides marked `show="0"` stay in the file and travel with it. */
/** Slides and notes quoted one by one, at most; the counts cover the rest. */
const MAX_QUOTED = 30;

function findHiddenSlides(parts: Parts): string[] {
  return Object.keys(parts)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .filter((p) => /<p:sld[^>]*\sshow="(0|false)"/.test(strFromU8(parts[p]!)))
    .sort();
}

/**
 * Spreadsheet-specific carriers.
 *
 * A workbook keeps its comment authors in their own part rather than as an
 * attribute, threaded comments name people through a person registry, and a
 * defined name can hold a path to another workbook on the author's disk.
 * None of those live anywhere the Word or PowerPoint paths look.
 */
function findWorkbookIdentities(parts: Parts): Finding[] {
  const findings: Finding[] = [];
  // Comment authors, persons and comment text: commentFindings(), for every format.

  const workbook = parts['xl/workbook.xml'];
  if (workbook) {
    const names = [...strFromU8(workbook).matchAll(/<definedName[^>]*name="([^"]+)"[^>]*>([^<]*)</g)];
    const external = names.filter(([, , value]) => LOCAL_TARGET.test((value ?? '').replace(/^'/, '')));
    if (external.length) {
      findings.push({
        kind: 'environment',
        confidence: 'confirmed',
        location: 'xl/workbook.xml:definedName',
        label: 'Defined name pointing outside the workbook',
        value: external.map(([, name, value]) => `${name} → ${value}`).join('; '),
      });
    }
  }

  const externalLinks = Object.keys(parts).filter((path) => path.startsWith('xl/externalLinks/'));
  if (externalLinks.length) {
    findings.push({
      kind: 'environment',
      confidence: 'probable',
      location: 'xl/externalLinks/',
      label: 'Links to other workbooks',
      value: `${externalLinks.filter((p) => p.endsWith('.xml')).length} external reference part(s)`,
    });
  }

  return findings;
}

/**
 * Traces of a program, in the shape of the container rather than in a name.
 *
 * Every generator check elsewhere reads a field that names a tool, which finds
 * nothing whenever the tool does not sign its work — and most do not. A real
 * document had `dc:creator` set to a department, `cp:lastModifiedBy` set to
 * "Un-named", and no tool named anywhere. It was also, unmistakably, assembled
 * by a library, and everything saying so was structural:
 *
 *   - `docProps/app.xml` present and empty. Word always fills it — Application,
 *     AppVersion, Words, Characters, DocSecurity. A part created to satisfy the
 *     OPC schema and never populated is not something an Office app produces.
 *   - Timestamps carrying milliseconds. `2026-07-29T15:22:28.698Z` is what
 *     JavaScript's `Date.toISOString()` emits; Word writes whole seconds.
 *   - Media named by content hash. Forty hex characters is a SHA-1, a library
 *     convention; Word writes image1.png.
 *   - A .docx with settings but no rsid at all. Word always records revision
 *     save identifiers.
 *
 * Each is weak alone — a converter might do any one of them — so two are
 * required before this says anything. What it concludes is narrow and
 * checkable: a program assembled this file rather than a person typing in a
 * word processor. It does not say which program, and it does not say AI.
 */
function structuralGenerator(parts: Parts, format: Format): Finding[] {
  const findings: Finding[] = [];
  const reasons: string[] = [];

  // A signature specific enough to name, and checked rather than guessed: a
  // document generated with the library reproduces this shape exactly —
  // "Un-named" in the two name fields, an empty extended-properties part,
  // revision 1, and created equal to modified down to the millisecond.
  const coreForLibrary = readText(parts, 'docProps/core.xml') ?? '';
  if (/<(?:cp:)?lastModifiedBy>Un-named<|<dc:creator>Un-named</.test(coreForLibrary)) {
    findings.push({
      kind: 'provenance',
      confidence: 'confirmed',
      location: 'docProps/core.xml',
      label: 'Written by the docx JavaScript library',
      // The name leads, so a one-line summary can take it verbatim; the
      // reasoning follows the dash, where every other tool value puts it.
      value:
        'docx (JavaScript library) — "Un-named" is that library\'s default for the author ' +
        'fields, verified in its source. Many products embed it, so this names what wrote the ' +
        'file and not who asked for it',
    });
  }

  const app = readText(parts, 'docProps/app.xml');
  if (app !== undefined && /<Properties[^>]*\/>|<Properties[^>]*>\s*<\/Properties>/.test(app)) {
    reasons.push('docProps/app.xml is present but empty');
  }

  findings.push(...retainedContent(parts, format));

  const core = readText(parts, 'docProps/core.xml');
  if (core) {
    const created = getElementText(core, 'dcterms:created');
    const modified = getElementText(core, 'dcterms:modified');
    if (created && /\.\d{3}Z$/.test(created)) {
      reasons.push('timestamps carry milliseconds, the shape JavaScript writes');
    }
    if (created && created === modified) {
      reasons.push('created and modified are the same instant');
    }
  }

  const settings = readText(parts, 'word/settings.xml');
  if (format === 'docx' && settings && !/rsid/i.test(settings)) {
    reasons.push('no revision save IDs, which Word always writes');
  }

  const hashed = findMediaParts(parts).filter((path) =>
    /\/[0-9a-f]{32,64}\.[a-z0-9]+$/i.test(path),
  );
  if (hashed.length) {
    reasons.push(`${hashed.length} media file(s) named by content hash rather than image1, image2`);
  }

  if (reasons.length >= 2) {
    findings.push({
      kind: 'provenance',
      confidence: reasons.length >= 3 ? 'confirmed' : 'probable',
      location: 'container structure',
      label: 'Assembled by a program, not typed in a word processor',
      value: reasons.join('; '),
    });
  }
  return findings;
}

/** Presenter notes are rarely written for the audience that receives the deck. */
/** Placeholders that are furniture, not words: slide number, date, footer, the slide's picture. */
const FURNITURE = /<p:ph\b[^>]*\stype="(?:sldNum|dt|ftr|hdr|sldImg)"/;

const unescapeXml = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => (Number(d) <= 0x10ffff ? String.fromCodePoint(Number(d)) : ''))
    .replace(/&amp;/g, '&');

/**
 * [C10.5] The words on a slide or in its notes, a paragraph at a time, with
 * the placeholders that only hold a number or a date left out.
 */
export function slideText(xml: string): string {
  const shapes = elements(xml, 'p:sp');
  const sources = shapes.length ? shapes.filter((shape) => !FURNITURE.test(shape.inner)).map((shape) => shape.inner) : [xml];
  const paragraphs: string[] = [];
  for (const source of sources) {
    const blocks = elements(source, 'a:p');
    for (const block of blocks.length ? blocks.map((b) => b.inner) : [source]) {
      const text = unescapeXml([...block.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(''))
        .replace(/\s+/g, ' ')
        .trim();
      if (text) paragraphs.push(text);
    }
  }
  return paragraphs.join(' / ');
}

/** Each slide's notes, quoted. */
function speakerNotesText(parts: Parts): Array<{ path: string; text: string }> {
  return Object.keys(parts)
    .filter((p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
    .map((path) => ({ path, text: slideText(strFromU8(parts[path]!)) }))
    .filter(({ text }) => text);
}

function findSpeakerNotes(parts: Parts): number {
  return Object.keys(parts).filter(
    (p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p) && /<a:t>[^<]+<\/a:t>/.test(strFromU8(parts[p]!)),
  ).length;
}


/**
 * Parts a reader actually sees. Invisible characters are only worth reporting
 * where they can travel with copied text; the same codepoints inside a theme or
 * a relationship file are structural noise.
 */
function isBodyPart(path: string): boolean {
  return /^word\/(document|footnotes|endnotes|comments|header\d*|footer\d*)\.xml$/.test(path) ||
    /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(path) ||
    path === 'xl/sharedStrings.xml';
}

/**
 * Report invisible characters carried by the document body.
 *
 * A zero-width space inside a paragraph survives copy/paste out of the document
 * exactly as it would in a plain text file, so leaving the body unscanned meant
 * the one class of marking this tool handles completely was invisible to it
 * precisely where documents are concerned.
 */
function inspectBodyText(parts: Parts): Finding[] {
  const findings: Finding[] = [];
  for (const [path, raw] of Object.entries(parts)) {
    if (!isBodyPart(path)) continue;
    const scan = scanText(collectTextContent(strFromU8(raw)));
    for (const finding of scan.findings) {
      // Line and sentence layout here belongs to the markup, not the author.
      if (isArrangementFinding(finding)) continue;
      findings.push({ ...finding, location: `${path} (${finding.location})` });
    }
    for (const payload of scan.decoded) {
      findings.push({
        kind: 'invisible-character',
        confidence: 'confirmed',
        location: path,
        label: 'Hidden payload in document text',
        value: payload,
      });
    }
  }
  return findings;
}

/**
 * Content the package still holds that the document no longer shows.
 *
 * Three shapes, and what they have in common is that the application presents
 * them as gone while the ZIP keeps them whole. A reader who unzips the file
 * gets everything back, which makes these worse than ordinary metadata: the
 * author believes the information was removed.
 */
function retainedContent(parts: Parts, format: Format): Finding[] {
  const findings: Finding[] = [];

  // Cropping a picture in Word or PowerPoint sets a:srcRect, which tells the
  // renderer which rectangle to display. The image part is untouched: the
  // cropped-away face, address or signature is still every pixel it was.
  const cropped = new Set<string>();
  for (const [path, raw] of Object.entries(parts)) {
    if (!/^(word|ppt|xl)\/.*\.xml$/.test(path)) continue;
    const text = strFromU8(raw);
    for (const match of text.matchAll(/<a:srcRect\b([^>]*)\/?>/g)) {
      // A srcRect with no edge attributes crops nothing.
      if (/[lrtb]=["'][1-9]/.test(match[1] ?? '')) cropped.add(path);
    }
  }
  if (cropped.size) {
    findings.push({
      kind: 'identity',
      confidence: 'confirmed',
      location: [...cropped].sort().join(', '),
      label: 'Cropped pictures keep their original image',
      value:
        `${cropped.size} part${cropped.size > 1 ? 's crop' : ' crops'} an image with a:srcRect. ` +
        'Cropping only changes which rectangle is displayed — the full picture is still in the ' +
        'package, so whatever was cropped out can be recovered by unzipping the file',
    });
  }

  // A pivot table caches its own copy of the source rows. Deleting the sheet
  // they came from does not delete the cache.
  const caches = Object.keys(parts).filter((p) => /^xl\/pivotCache\/pivotCacheRecords/.test(p));
  if (caches.length) {
    const bytes = caches.reduce((sum, p) => sum + (parts[p]?.length ?? 0), 0);
    findings.push({
      kind: 'identity',
      confidence: 'confirmed',
      location: caches.sort().join(', '),
      label: 'Pivot table cache holds a copy of the source rows',
      value:
        `${caches.length} cache part${caches.length > 1 ? 's' : ''}, ${bytes.toLocaleString('en-US')} bytes. ` +
        'A pivot table keeps its own copy of the data it was built from, so deleting or hiding the ' +
        'source sheet leaves the rows in the file',
    });
  }

  // A hidden sheet is one click from visible. veryHidden cannot be unhidden
  // from the interface at all, which is why it is used to park working data.
  if (format === 'xlsx') {
    const workbook = readText(parts, 'xl/workbook.xml');
    if (workbook) {
      const hidden: string[] = [];
      let veryHidden = 0;
      for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
        const tag = match[0];
        const state = /state=["'](\w+)["']/.exec(tag)?.[1];
        if (state !== 'hidden' && state !== 'veryHidden') continue;
        const name = /name=["']([^"']*)["']/.exec(tag)?.[1] ?? '(unnamed)';
        hidden.push(state === 'veryHidden' ? `${name} (veryHidden)` : name);
        if (state === 'veryHidden') veryHidden++;
      }
      if (hidden.length) {
        findings.push({
          kind: 'identity',
          confidence: 'confirmed',
          location: 'xl/workbook.xml:sheet',
          label: 'Hidden worksheets',
          value:
            `${hidden.join(', ')} — their cells travel with the workbook` +
            (veryHidden
              ? '. A veryHidden sheet cannot be unhidden from the Excel interface, so it is easy to forget one is there'
              : ''),
        });
      }
    }
  }

  return findings;
}

export function inspectOoxml(data: Uint8Array): InspectResult {
  const parts = unzipGuarded(data);
  const format = detectOoxmlFormat(parts);
  const findings: Finding[] = [];
  const notes: Note[] = [];

  const core = readText(parts, 'docProps/core.xml');
  if (core) {
    for (const field of CORE_FIELDS) {
      const value = getElementText(core, field.tag);
      if (value && !PLACEHOLDER_VALUES.has(value)) {
        findings.push({
          kind: field.kind,
          confidence: field.confidence,
          location: `docProps/core.xml:${field.tag}`,
          label: field.label,
          value,
        });
      }
    }
  }

  const app = readText(parts, 'docProps/app.xml');
  if (app) {
    for (const field of APP_FIELDS) {
      const value = getElementText(app, field.tag);
      if (value && value !== '0') {
        findings.push({
          kind: field.kind,
          confidence: field.confidence,
          location: `docProps/app.xml:${field.tag}`,
          label: field.label,
          value,
        });
      }
    }
  }

  const custom = readText(parts, 'docProps/custom.xml');
  if (custom) {
    // Each property is reported with its value, not merely its name: a key
    // called "Model" says nothing, "claude-opus-5" says everything, and only
    // the value can feed the fingerprint pass.
    const properties = collectNamedProperties(custom, 'property', 'name');
    for (const { name, value } of properties) {
      findings.push({
        kind: 'identity',
        confidence: 'confirmed',
        location: `docProps/custom.xml:${name}`,
        label: `Custom property: ${name}`,
        value,
      });
    }
    if (properties.length === 0) {
      const names = collectAttribute(custom, 'name');
      findings.push({
        kind: 'identity',
        // An empty container carries no identity. Several generators create
        // the part and never populate it, and calling that confirmed
        // identifying data overstates what is in the file — the part is worth
        // mentioning, and worth removing, but it is not evidence of anything.
        confidence: names.length ? 'confirmed' : 'informational',
        location: 'docProps/custom.xml',
        label: 'Custom properties',
        value: names.length ? names.join(', ') : 'the part exists but holds no properties',
      });
    }
  }

  // customXml is a second, less-known property store. Word puts content-control
  // data bindings there, SharePoint and DMS integrations put library columns and
  // classification labels, and it is where a tool that wants to stamp a document
  // without touching docProps writes instead. It is not the visible body, so
  // unlike hyperlinks or speaker notes it can be removed outright.
  const customXml = Object.keys(parts).filter((p) => p.startsWith('customXml/') && p.endsWith('.xml'));
  if (customXml.length) {
    const items = customXml.filter((p) => /\/item\d*\.xml$/.test(p));
    findings.push({
      kind: 'identity',
      confidence: 'probable',
      location: 'customXml/',
      label: 'Custom XML data store',
      value: `${items.length || customXml.length} part(s) — content-control bindings, library columns or classification labels`,
    });
  }

  const thumbnail = Object.keys(parts).find((p) => p.startsWith('docProps/thumbnail'));
  if (thumbnail) {
    findings.push({
      kind: 'identity',
      confidence: 'probable',
      location: thumbnail,
      label: 'Embedded thumbnail',
      value: 'rendered preview of document content',
    });
  }

  const settings = readText(parts, 'word/settings.xml');
  if (settings) {
    const rsids = collectAttribute(settings, 'w:val').filter((v) => /^[0-9A-F]{8}$/i.test(v));
    if (rsids.length) {
      findings.push({
        kind: 'environment',
        confidence: 'probable',
        location: 'word/settings.xml:w:rsid',
        label: 'Revision save IDs',
        value: `${rsids.length} value${rsids.length > 1 ? 's' : ''} (correlate documents edited in the same session)`,
      });
    }
  }

  const authors = new Set<string>();
  for (const [path, raw] of Object.entries(parts)) {
    if (!/\.xml$/.test(path)) continue;
    if (!/comments|people|document|slide/.test(path)) continue;
    for (const author of collectAttribute(strFromU8(raw), 'w:author')) {
      if (author !== ANONYMOUS_AUTHOR) authors.add(author);
    }
  }
  if (authors.size) {
    findings.push({
      kind: 'identity',
      confidence: 'confirmed',
      location: 'tracked changes / comments',
      label: 'Comment and revision authors',
      value: [...authors].join(', '),
    });
  }

  for (const { part, target } of findLocalHyperlinks(parts)) {
    findings.push({
      kind: 'environment',
      confidence: 'confirmed',
      location: part,
      label: 'Link to a local or network path',
      value: target,
    });
  }

  for (const path of findMediaParts(parts)) {
    findings.push(...inspectImage(parts[path]!, path));
  }

  // [F-2.1] Macros, remote templates, fields that run or fetch, objects, controls.
  findings.push(...activeOfficeFindings(parts));
  findings.push(...workbookActiveFindings(parts));

  const hidden = findHiddenSlides(parts);
  if (hidden.length) {
    findings.push({
      kind: 'identity',
      confidence: 'probable',
      location: hidden.join(', '),
      label: 'Hidden slides',
      value: `${hidden.length} hidden slide${hidden.length > 1 ? 's' : ''} still present in the file`,
    });
  }
  // [C10.5] What they say, not only how many there are.
  for (const path of hidden.slice(0, MAX_QUOTED)) {
    const text = slideText(strFromU8(parts[path]!));
    if (text) findings.push({ kind: 'identity', confidence: 'probable', location: path, label: 'Text of a hidden slide', value: preview(text, 200) });
  }

  const notesCount = findSpeakerNotes(parts);
  if (notesCount) {
    findings.push({
      kind: 'identity',
      confidence: 'probable',
      location: 'ppt/notesSlides/',
      label: 'Speaker notes',
      value: `${notesCount} slide${notesCount > 1 ? 's' : ''} with presenter notes`,
    });
  }
  for (const { path, text } of speakerNotesText(parts).slice(0, MAX_QUOTED)) {
    findings.push({ kind: 'identity', confidence: 'probable', location: path, label: 'Speaker notes text', value: preview(text, 200) });
  }

  for (const path of findC2paParts(parts)) {
    findings.push(...describeC2pa(strFromU8(parts[path]!), path, parts[path]!));
  }

  // Credentials and provider-issued ids are scanned for in the body too: they
  // cannot occur innocently, unlike a vendor name, which often just means the
  // document talks about the vendor.
  for (const [path, raw] of Object.entries(parts)) {
    if (!/\.(xml|rels|json|txt|bin)$/.test(path)) continue;
    findings.push(...scanContent(strFromU8(raw), path));
    findings.push(...findSourceTypes(strFromU8(raw), path));
  }

  findings.push(...structuralGenerator(parts, format));
  findings.push(...findWorkbookIdentities(parts));
  findings.push(...commentFindings(parts));
  findings.push(...inspectBodyText(parts));
  if (format === 'docx') findings.push(...hiddenInDocx(parts), ...trackedChangeFindings(parts));
  if (format === 'pptx') findings.push(...hiddenInPptx(parts));

  notes.push({ code: 'scope:ooxml-metadata-only' });

  // Derived last, so it can draw on every field the format modules surfaced.
  findings.push(...fingerprint(findings));

  return { format, findings: findings.sort(byConfidence), notes };
}

export interface RedactOoxmlOptions {
  /** Remove the embedded thumbnail preview. Default true. */
  removeThumbnail?: boolean;
  /** Remove rsid values from word/settings.xml. Default true. */
  removeRsids?: boolean;
  /** Remove comment and tracked-change author names. Default true. */
  anonymizeAuthors?: boolean;
  /** Strip Exif/XMP/IPTC from embedded pictures. Default true. */
  stripMedia?: boolean;
  /** Remove invisible characters from the document's visible text. Default true. */
  cleanBodyText?: boolean;
  /** Remove Word and PowerPoint runs a reader cannot see: hidden, background-coloured, under 2 pt, off the slide. Default false. */
  removeHidden?: boolean;
  /** Accept every tracked change in a Word document: deletions go, insertions stay as plain text. Default false. */
  acceptChanges?: boolean;
  /** Remove every comment — text, authors, threads — from Word, Excel and PowerPoint. Default false. */
  removeComments?: boolean;
  /** [F-2.1] Remove macros, remote templates and fields that run or fetch. Default false. */
  stripActive?: boolean;
  /** [F-2.4] Remove speaker notes, hidden slides, hidden sheets. Default false. */
  removeNotes?: boolean;
  removeHiddenSlides?: boolean;
  removeHiddenSheets?: boolean;
  /** [F-2.4] Remove tracking parameters from hyperlinks. Default false. */
  stripTracking?: boolean;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Resolve an OPC relationship target against the part that declares it.
 *
 * A `.rels` file at `word/_rels/document.xml.rels` describes `word/document.xml`,
 * so its targets resolve against `word/` — which is why the same part is reached
 * as `../customXml/item1.xml` from there and as `customXml/item1.xml` from the
 * package root. Comparing raw strings gets this wrong in both directions.
 */
function resolveTarget(relsPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const base = relsPath.replace(/_rels\/[^/]*\.rels$/, '');
  const segments: string[] = [];
  for (const segment of (base + target).split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

/**
 * Drop a part, its `[Content_Types].xml` override, and every relationship
 * pointing at it.
 *
 * The relationship sweep covers all `.rels` parts rather than just the package
 * root: a dangling relationship is not a cosmetic leftover — Word treats a
 * target it cannot resolve as a damaged file and offers to repair it.
 */
/**
 * [C6] Every comment out of the package, on request: the comment parts, their
 * author registries and the relationships and content types that name them —
 * and what points at them by id, which removePart() cannot see: Word's comment
 * ranges and references, a sheet's <legacyDrawing>, the VML notes. Returns how
 * many comments went.
 */
function removeAllComments(parts: Parts): number {
  const count = countComments(parts);
  const found = commentParts(parts);

  // A sheet's notes are drawn by a VML part its <legacyDrawing> points at. The
  // note shapes go; a VML part left with no shape goes with its reference.
  for (const relsPath of Object.keys(parts).filter((p) => /^xl\/worksheets\/_rels\/[^/]+\.rels$/.test(p))) {
    const sheetPath = relsPath.replace(/_rels\/([^/]+)\.rels$/, '$1');
    const rels = readText(parts, relsPath)!;
    for (const rel of rels.match(/<Relationship\b[^>]*\/>/g) ?? []) {
      if (!/\/vmlDrawing"/.test(rel)) continue;
      const id = /\sId="([^"]+)"/.exec(rel)?.[1];
      const target = /\sTarget="([^"]+)"/.exec(rel)?.[1];
      if (!id || !target) continue;
      const vmlPath = resolveTarget(relsPath, target);
      const vml = readText(parts, vmlPath);
      if (vml === undefined) continue;
      const notes = elements(vml, 'v:shape').filter((shape) => /ObjectType="Note"/.test(shape.inner));
      let kept = vml;
      for (const shape of notes.reverse()) kept = kept.slice(0, shape.start) + kept.slice(shape.end);
      if (/<v:shape\b/.test(kept)) {
        parts[vmlPath] = strToU8(kept);
      } else {
        removePart(parts, vmlPath);
        const sheet = readText(parts, sheetPath);
        if (sheet) parts[sheetPath] = strToU8(sheet.replace(new RegExp(`<legacyDrawing\\b[^<>]*\\br:id="${escapeRegExp(id)}"[^<>]*/>`), ''));
      }
    }
  }

  for (const path of [...found.sheet, ...found.threaded, ...found.persons, ...found.word, ...found.wordExtras, ...found.slide, ...found.slideAuthors]) {
    removePart(parts, path);
  }

  // Word anchors each comment in the text with ranges and a reference mark.
  for (const path of Object.keys(parts).filter((p) => /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(p))) {
    const xml = readText(parts, path)!;
    const cleaned = xml.replace(/<w:comment(?:RangeStart|RangeEnd|Reference)\b[^<>]*\/>/g, '');
    if (cleaned !== xml) parts[path] = strToU8(cleaned);
  }
  return count;
}

function removePart(parts: Parts, path: string): void {
  delete parts[path];

  const types = readText(parts, '[Content_Types].xml');
  if (types) {
    parts['[Content_Types].xml'] = strToU8(
      types.replace(new RegExp(`<Override[^>]*PartName="/${escapeRegExp(path)}"[^>]*/>`, 'g'), ''),
    );
  }

  for (const relsPath of Object.keys(parts)) {
    if (!relsPath.endsWith('.rels')) continue;
    const xml = readText(parts, relsPath)!;
    const cleaned = xml.replace(/<Relationship\b[^>]*\/>/g, (element) => {
      const target = /\sTarget="([^"]*)"/.exec(element)?.[1];
      if (target === undefined) return element;
      // An external target is a URL, not a part; leave it alone.
      if (/\sTargetMode="External"/.test(element)) return element;
      return resolveTarget(relsPath, target) === path ? '' : element;
    });
    if (cleaned !== xml) parts[relsPath] = strToU8(cleaned);
  }
}

/** Rebuild the container with `[Content_Types].xml` first, as OPC readers expect. */
function repack(parts: Parts): Uint8Array {
  const ordered: Parts = {};
  const contentTypes = parts['[Content_Types].xml'];
  if (contentTypes) ordered['[Content_Types].xml'] = contentTypes;
  for (const [path, raw] of Object.entries(parts)) {
    if (path !== '[Content_Types].xml') ordered[path] = raw;
  }
  return zipSync(ordered, { level: 6 });
}

export function redactOoxml(data: Uint8Array, options: RedactOoxmlOptions = {}): RedactResult {
  const {
    removeThumbnail = true,
    removeRsids = true,
    anonymizeAuthors = true,
    stripMedia = true,
    cleanBodyText = true,
    removeHidden = false,
    acceptChanges = false,
    removeComments = false,
    stripActive = false,
    removeNotes: dropNotes = false,
    removeHiddenSlides: dropHiddenSlides = false,
    removeHiddenSheets: dropHiddenSheets = false,
    stripTracking = false,
  } = options;

  const before = inspectOoxml(data);
  const parts = unzipGuarded(data);
  const format = detectOoxmlFormat(parts);
  const notes: Note[] = [];

  let core = readText(parts, 'docProps/core.xml');
  if (core) {
    for (const field of CORE_FIELDS) {
      core = DATE_TAGS.has(field.tag)
        ? removeElement(core, field.tag)
        : setElementText(core, field.tag, '');
    }
    parts['docProps/core.xml'] = strToU8(core);
  }

  let app = readText(parts, 'docProps/app.xml');
  if (app) {
    for (const field of APP_FIELDS) {
      app = field.tag === 'TotalTime' ? setElementText(app, field.tag, '0') : setElementText(app, field.tag, '');
    }
    parts['docProps/app.xml'] = strToU8(app);
  }

  if (parts['docProps/custom.xml']) removePart(parts, 'docProps/custom.xml');

  // The whole customXml tree goes, including the itemProps parts that name each
  // store's schema. Word regenerates the bindings it still needs; what stays
  // behind otherwise is a property store the author never sees in the UI.
  for (const path of Object.keys(parts).filter((p) => p.startsWith('customXml/'))) {
    removePart(parts, path);
  }

  if (removeThumbnail) {
    const thumbnail = Object.keys(parts).find((p) => p.startsWith('docProps/thumbnail'));
    if (thumbnail) removePart(parts, thumbnail);
  }

  if (removeRsids) {
    const settings = readText(parts, 'word/settings.xml');
    if (settings) parts['word/settings.xml'] = strToU8(removeElement(settings, 'w:rsids'));
    // [C5] Every part, not settings.xml alone: each paragraph, run, style and
    // list carries its own w:rsid… attributes, and together they record which
    // editing session touched what.
    for (const path of Object.keys(parts)) {
      if (!/^word\/.*\.xml$/.test(path)) continue;
      const xml = strFromU8(parts[path]!);
      if (!xml.includes('w:rsid')) continue;
      parts[path] = strToU8(xml.replace(/\sw:rsid\w*="[^"]*"/g, ''));
    }
  }

  // [C5] When each revision and comment was made, to the minute: timestamps,
  // and removed with the names beside them. Both attributes are optional.
  for (const path of Object.keys(parts)) {
    if (!/^word\/.*\.xml$/.test(path)) continue;
    const xml = strFromU8(parts[path]!);
    if (!/\s(?:w:date|w16du:dateUtc)="/.test(xml)) continue;
    parts[path] = strToU8(xml.replace(/\s(?:w:date|w16du:dateUtc)="[^"]*"/g, ''));
  }

  if (acceptChanges && format === 'docx') {
    const accepted = acceptChangesInParts(parts);
    if (accepted) notes.push({ code: 'removed:tracked-changes', detail: String(accepted) });
  }

  if (anonymizeAuthors) {
    for (const [path, raw] of Object.entries(parts)) {
      if (!/\.xml$/.test(path)) continue;
      let xml = strFromU8(raw);
      const before = xml;
      xml = xml.replace(/\sw:author="[^"]*"/g, ` w:author="${ANONYMOUS_AUTHOR}"`);
      if (xml !== before) parts[path] = strToU8(xml);
    }
    // [C6] Spreadsheets and decks name comment authors in elements and
    // registries of their own, wherever the producer put them.
    anonymizeComments(parts);
  }

  if (removeComments) {
    const removed = removeAllComments(parts);
    if (removed) notes.push({ code: 'removed:comments', detail: String(removed) });
  }

  // [F-2.4] Content that goes only when asked. Hidden slides first: their
  // notes leave with them, and are not counted twice.
  if (dropHiddenSlides && format === 'pptx') {
    const removed = removeHiddenSlides(parts, removePart);
    if (removed) notes.push({ code: 'removed:hidden-slides', detail: String(removed) });
  }
  if (dropNotes && format === 'pptx') {
    const removed = removeNotes(parts, removePart);
    if (removed) notes.push({ code: 'removed:notes', detail: String(removed) });
  }
  if (dropHiddenSheets && format === 'xlsx') {
    const { removed, refused } = removeHiddenSheets(parts, removePart);
    if (removed) notes.push({ code: 'removed:hidden-sheets', detail: String(removed) });
    if (refused.length) notes.push({ code: 'kept:hidden-sheets', detail: refused.join(', ') });
  }

  if (stripTracking) {
    const changed = stripTrackingOffice(parts);
    if (changed) notes.push({ code: 'removed:tracking-params', detail: String(changed) });
  }

  if (stripActive) {
    const removed = stripActiveOffice(parts, removePart);
    if (removed) notes.push({ code: 'removed:active-content', detail: String(removed) });
  }

  if (removeHidden && (format === 'docx' || format === 'pptx')) {
    const removed = format === 'docx' ? stripHiddenDocx(parts) : stripHiddenPptx(parts);
    if (removed) notes.push({ code: 'removed:hidden-text', detail: String(removed) });
  }

  if (cleanBodyText) {
    for (const path of Object.keys(parts)) {
      if (!isBodyPart(path)) continue;
      const cleaned = mapTextContent(strFromU8(parts[path]!), (text) => cleanText(text, { normalizeSpaces: false }).text);
      parts[path] = strToU8(cleaned);
    }
  }

  if (stripMedia) {
    for (const path of findMediaParts(parts)) {
      const stripped = stripImageMetadata(parts[path]!);
      if (stripped) parts[path] = stripped;
    }
  }

  for (const path of findC2paParts(parts)) {
    removePart(parts, path);
    notes.push({ code: 'removed:c2pa', detail: path });
  }

  // Hyperlinks, hidden slides, speaker notes and cross-workbook references are
  // document content rather than metadata. Deleting them would silently change
  // what the recipient reads — a defined name and an external link part are what
  // formulas resolve through, and dropping either turns live cells into #REF! —
  // so they are reported and left alone.
  const contentLeft = [
    findLocalHyperlinks(parts).length && 'local links',
    findHiddenSlides(parts).length && 'hidden slides',
    findSpeakerNotes(parts) && 'speaker notes',
    findWorkbookIdentities(parts).some((f) => f.kind === 'environment') && 'external workbook references',
  ].filter((v): v is string => typeof v === 'string');
  if (contentLeft.length) notes.push({ code: 'kept:content', detail: contentLeft.join(', ') });

  notes.push(...before.notes);

  return { format, data: repack(parts), removed: before.findings, notes };
}

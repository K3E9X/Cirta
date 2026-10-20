/**
 * XMP, the RDF packet Adobe tools and many others write into PDFs and images.
 *
 * The packet is read with indexOf rather than with a regular expression that
 * looks for a closing tag: an image's XMP chunk is whatever the file says it
 * is, and a pattern that rescans from every unclosed opening is quadratic.
 */

import type { Finding } from './types.js';
import { preview } from './types.js';

const MAX_VALUES = 10;

const decode = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => (Number(d) <= 0x10ffff ? String.fromCodePoint(Number(d)) : ''))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => (parseInt(h, 16) <= 0x10ffff ? String.fromCodePoint(parseInt(h, 16)) : ''))
    .replace(/&amp;/g, '&');

/** The text between `<name ...>` and `</name>`, for every such element. */
function elementTexts(xmp: string, name: string): string[] {
  const out: string[] = [];
  const opener = `<${name}`;
  const closer = `</${name}>`;
  let at = xmp.indexOf(opener);
  while (at >= 0 && out.length < MAX_VALUES) {
    const next = xmp.charAt(at + opener.length);
    const tagEnd = xmp.indexOf('>', at);
    if (tagEnd < 0) break;
    if ((next === '>' || /\s/.test(next)) && xmp[tagEnd - 1] !== '/') {
      const close = xmp.indexOf(closer, tagEnd);
      if (close < 0) break;
      out.push(xmp.slice(tagEnd + 1, close));
      at = xmp.indexOf(opener, close);
    } else {
      at = xmp.indexOf(opener, at + 1);
    }
  }
  return out;
}

/** Every value of an attribute, in order of appearance, without repeats. */
function attributeValues(xmp: string, name: string): string[] {
  const seen = new Set<string>();
  const needle = `${name}="`;
  let at = xmp.indexOf(needle);
  while (at >= 0 && seen.size < MAX_VALUES * 5) {
    const end = xmp.indexOf('"', at + needle.length);
    if (end < 0) break;
    if (/\s/.test(xmp.charAt(at - 1))) {
      const value = decode(xmp.slice(at + needle.length, end)).trim();
      if (value) seen.add(value);
    }
    at = xmp.indexOf(needle, end);
  }
  return [...seen];
}

/** The items of an rdf:Seq, rdf:Bag or rdf:Alt, or the element's own text. */
function listItems(inner: string): string[] {
  const items = elementTexts(inner, 'rdf:li').map((li) => decode(li.replace(/<[^<>]*>/g, '')).trim()).filter(Boolean);
  if (items.length) return items;
  const text = decode(inner.replace(/<[^<>]*>/g, '')).trim();
  return text ? [text] : [];
}

/** A single XMP property value, tolerating both element and attribute syntax. */
export function xmpValue(xmp: string, property: string): string | undefined {
  for (const inner of elementTexts(xmp, property)) {
    const items = listItems(inner);
    if (items.length) return items.join(', ');
  }
  return attributeValues(xmp, property)[0];
}

export const XMP_FIELDS = [
  { property: 'xmp:CreatorTool', label: 'XMP creator tool', kind: 'provenance' as const, confidence: 'informational' as const },
  { property: 'pdf:Producer', label: 'XMP producer', kind: 'provenance' as const, confidence: 'informational' as const },
  { property: 'dc:creator', label: 'XMP author', kind: 'identity' as const, confidence: 'confirmed' as const },
  { property: 'dc:title', label: 'XMP title', kind: 'identity' as const, confidence: 'probable' as const },
  { property: 'xmp:CreateDate', label: 'XMP created', kind: 'timestamp' as const, confidence: 'probable' as const },
  { property: 'xmp:ModifyDate', label: 'XMP modified', kind: 'timestamp' as const, confidence: 'probable' as const },
  { property: 'xmpMM:DocumentID', label: 'XMP document ID', kind: 'environment' as const, confidence: 'probable' as const },
  { property: 'xmpMM:InstanceID', label: 'XMP instance ID', kind: 'environment' as const, confidence: 'probable' as const },
];

/**
 * [C7] What an editor records of a picture's life: each program that saved
 * it, the file it was placed from, and the documents it descends from.
 * Photoshop writes all three, and a cropped export keeps them.
 */
function trailFindings(xmp: string, location: string): Finding[] {
  const findings: Finding[] = [];

  const agents = [
    ...attributeValues(xmp, 'stEvt:softwareAgent'),
    ...elementTexts(xmp, 'stEvt:softwareAgent').map((text) => decode(text).trim()),
  ].filter((agent, index, all) => agent && all.indexOf(agent) === index);
  if (agents.length) {
    findings.push({
      kind: 'provenance',
      confidence: 'probable',
      location: `${location} xmpMM:History`,
      label: 'Editing history',
      value: preview(agents.join(' → '), 300),
    });
  }

  const paths = [
    ...attributeValues(xmp, 'stRef:filePath'),
    ...elementTexts(xmp, 'stRef:filePath').map((text) => decode(text).trim()),
  ].filter((path, index, all) => path && all.indexOf(path) === index);
  for (const path of paths.slice(0, MAX_VALUES)) {
    findings.push({ kind: 'environment', confidence: 'confirmed', location: `${location} stRef:filePath`, label: 'Source file path', value: preview(path, 200) });
  }

  const [ancestors] = elementTexts(xmp, 'photoshop:DocumentAncestors');
  if (ancestors !== undefined) {
    // Photoshop is known to let this list grow to tens of thousands of
    // entries; counting is all that is needed, and indexOf counts cheaply.
    let count = 0;
    for (let at = ancestors.indexOf('<rdf:li'); at >= 0; at = ancestors.indexOf('<rdf:li', at + 1)) count++;
    const first = listItems(ancestors).slice(0, 3);
    if (count) {
      findings.push({
        kind: 'provenance',
        confidence: 'probable',
        location: `${location} photoshop:DocumentAncestors`,
        label: 'Document ancestors',
        value: `${count} — ${preview(first.join(', '), 160)}${count > first.length ? ', …' : ''}`,
      });
    }
  }
  return findings;
}

/** The fields of an XMP packet found in an image. */
export function imageXmpFindings(xmp: string, location: string): Finding[] {
  const findings: Finding[] = [];
  for (const field of XMP_FIELDS) {
    const value = xmpValue(xmp, field.property);
    if (value) findings.push({ kind: field.kind, confidence: field.confidence, location: `${location} ${field.property}`, label: field.label, value: preview(value, 200) });
  }
  return [...findings, ...trailFindings(xmp, location)];
}

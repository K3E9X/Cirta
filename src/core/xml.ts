/**
 * Minimal XML editing helpers.
 *
 * Office document properties are machine-generated, flat, and namespaced with a
 * fixed set of prefixes, so targeted string surgery is sufficient here and
 * avoids pulling in a DOM implementation that would also have to run in the
 * browser. These helpers are deliberately not a general-purpose XML editor.
 */

/** Escape a tag name for embedding in a regular expression. */
function tag(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match `<name ...>...</name>` and the self-closing `<name ... />` form. */
function elementPattern(name: string): RegExp {
  const t = tag(name);
  return new RegExp(`<${t}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${t}>)`, 'g');
}

/** Read the text content of the first matching element, or undefined. */
export function getElementText(xml: string, name: string): string | undefined {
  const match = elementPattern(name).exec(xml);
  if (!match) return undefined;
  const inner = match[2];
  if (inner === undefined) return '';
  return decodeEntities(inner.replace(/<[^>]*>/g, ''));
}

/** Replace the text content of every matching element with `value`. */
export function setElementText(xml: string, name: string, value: string): string {
  return xml.replace(elementPattern(name), (_full, attrs: string | undefined) => {
    const a = attrs ?? '';
    return `<${name}${a}>${escapeText(value)}</${name}>`;
  });
}

/** Delete every matching element, including its content. */
export function removeElement(xml: string, name: string): string {
  return xml.replace(elementPattern(name), '');
}

/** Remove an attribute from every element in the document. */
export function removeAttribute(xml: string, attribute: string): string {
  const a = tag(attribute);
  return xml.replace(new RegExp(`\\s${a}="[^"]*"`, 'g'), '');
}

/** Collect the values of one attribute across the document, de-duplicated. */
export function collectAttribute(xml: string, attribute: string): string[] {
  const a = tag(attribute);
  const re = new RegExp(`\\s${a}="([^"]*)"`, 'g');
  const seen = new Set<string>();
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[1]) seen.add(m[1]);
  }
  return [...seen];
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Element text content, i.e. everything between a `>` and the next `<`.
 *
 * This deliberately ignores attributes and tag names: only what a reader
 * actually sees is of interest, and touching structure would corrupt the file.
 * Numeric character references are decoded, because `&#x200B;` is a zero-width
 * space written the long way and hiding one that way is the obvious evasion.
 */
const TEXT_CONTENT = />([^<]+)</g;

/** Numeric references, decoded so an escaped invisible character is still seen. */
const NUMERIC_REFERENCE = /&#(?:x([0-9a-f]+)|(\d+));/gi;

function decodeNumericReferences(text: string): string {
  return text.replace(NUMERIC_REFERENCE, (full, hex: string | undefined, dec: string | undefined) => {
    const code = hex ? parseInt(hex, 16) : Number(dec);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full;
  });
}

/** Concatenate the visible text of a document part. */
/**
 * Elements that end a line of readable text.
 *
 * Runs inside one paragraph must be joined with nothing — a word split across
 * two runs is still one word, and inserting anything between them invents a
 * break. Across paragraphs the opposite is true: joining them with nothing
 * welds the last word of one to the first word of the next, which produced
 * "Fin de phrase.Les flux" and, from there, sentence counts that measured the
 * concatenation rather than the document.
 */
const LINE_BREAK = /^<\/(?:w:p|a:p|text:p|text:h)\b|^<(?:w:br|a:br|text:line-break)\b/;

const TOKEN = /<[^>]*>|[^<]+/g;

export function collectTextContent(xml: string): string {
  const pieces: string[] = [];
  for (const token of xml.match(TOKEN) ?? []) {
    if (token.startsWith('<')) {
      if (LINE_BREAK.test(token)) pieces.push('\n');
    } else {
      pieces.push(decodeEntities(decodeNumericReferences(token)));
    }
  }
  return pieces.join('');
}

/**
 * Rewrite the visible text of a document part, leaving markup untouched.
 *
 * Numeric references are resolved first so that a character escaped as
 * `&#x200B;` is removed rather than surviving as literal markup, then only the
 * three XML-significant characters are re-escaped — a full entity round-trip
 * would rewrite entities the producer chose deliberately.
 */
export function mapTextContent(xml: string, transform: (text: string) => string): string {
  return xml.replace(TEXT_CONTENT, (_full, text: string) => {
    const decoded = decodeNumericReferences(text);
    const result = transform(decodeEntities(decoded));
    return `>${escapeText(result)}<`;
  });
}

/**
 * Named property values, as Office and OpenDocument both store custom fields.
 *
 * Reporting only the property names loses the part that matters: a key called
 * "Model" says nothing, while its value "claude-opus-5" names the model and
 * feeds the fingerprint pass. This is the same lesson the PDF /Info dictionary
 * taught — the open-ended part of a format is where the telling data lands.
 */
export function collectNamedProperties(
  xml: string,
  element: string,
  nameAttribute: string,
): Array<{ name: string; value: string }> {
  const e = tag(element);
  const a = tag(nameAttribute);
  const pattern = new RegExp(
    `<${e}[^>]*\\s${a}="([^"]*)"[^>]*>([\\s\\S]*?)</${e}>`,
    'g',
  );
  const out: Array<{ name: string; value: string }> = [];
  for (const match of xml.matchAll(pattern)) {
    const name = decodeEntities(match[1] ?? '').trim();
    const value = decodeEntities((match[2] ?? '').replace(/<[^>]*>/g, '')).trim();
    if (name && value) out.push({ name, value });
  }
  return out;
}

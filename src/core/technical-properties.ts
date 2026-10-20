/**
 * [C9] [R6] User properties that are an Office application's own
 * bookkeeping, carried over when a document is converted or saved by another
 * program: the version that saved it, its security flag, layout switches,
 * statistics. They name no one, and reporting "AppVersion = 14.0000" as
 * confirmed identity buried what custom properties are read for — one called
 * "Model" or "Client". The same list for OpenDocument, OOXML, RTF and the
 * legacy .doc/.xls/.ppt property sets.
 */

export const TECHNICAL_PROPERTIES: ReadonlySet<string> = new Set([
  'AppVersion',
  'DocSecurity',
  'ScaleCrop',
  'LinksUpToDate',
  'SharedDoc',
  'HyperlinksChanged',
  'Pages',
  'Words',
  'Characters',
  'CharactersWithSpaces',
  'Lines',
  'Paragraphs',
]);

/** How a custom property is reported: a technical one as informational provenance. */
export const customPropertyLevel = (name: string) =>
  TECHNICAL_PROPERTIES.has(name) ? ({ kind: 'provenance', confidence: 'informational' } as const) : ({ kind: 'identity', confidence: 'confirmed' } as const);

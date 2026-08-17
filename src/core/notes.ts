/**
 * The caveat attached to each note code, in the library's own language.
 *
 * Notes are codes rather than sentences precisely so that each front-end can
 * word them for its own audience, and the French web interface does. English
 * still has to be written once, and it was being written twice — the command
 * line had these strings, and the page had no English at all. Shared from here
 * so the two cannot drift into saying different things about the same result.
 */

import type { Note } from './types.js';

export const NOTE_TEXT_EN: Record<Note['code'], (detail?: string) => string> = {
  'scope:pdf-metadata-only': () =>
    'Metadata, plus a scan of decompressed streams for credentials and provider identifiers, and of page text decoded through each font\'s ToUnicode map. That map is what turns a subset font\'s glyph codes back into characters; a page whose font carries none is still read as raw codes, where a hit is real but a miss proves nothing. A statistical model watermark would not show up either way.',
  'scope:ooxml-metadata-only': () =>
    'Document properties, a scan of the parts for credentials and provider identifiers, and a scan of the visible text for invisible characters. What is not analysed is the wording: a statistical model watermark lives there and is unaffected by redaction.',
  'scope:invisible-characters-only': () =>
    'Character-level only: invisible codepoints, lookalike letters, and the credentials and provider identifiers that cannot occur innocently. A statistical model watermark in this text, if present, is unaffected and cannot be detected locally.',
  'scope:markup-metadata-only': () =>
    'Markup metadata, plus a scan of the body for invisible characters. What is not analysed is the wording: a statistical model watermark lives there and would not show up here.',
  'scope:image-metadata-only': () =>
    'Image container metadata only. The pixels are not analysed: an invisible watermark encoded in the image data itself would not show up here, and is not removed.',
  'removed:c2pa': (detail) =>
    `Removed a C2PA manifest${detail ? ` (${detail})` : ''}. The file no longer carries verifiable provenance — third parties can no longer confirm its origin in either direction. Two things this does not mean. C2PA also supports soft binding, where a mark in the content itself lets a vendor re-attach the credential, so a removed manifest does not mean no provenance remains. And the reverse: a credential is metadata attached to the file rather than embedded in it, so re-saving, converting or resizing strips it without a trace — its absence from any file proves nothing about origin.`,
  'scope:archive': () =>
    'Archive report. Every member was dispatched through the normal detection path; members no parser recognises at all were scanned for credentials and provider identifiers only.',
  'limit:archive-truncated': (detail) =>
    `Archive traversal stopped at a built-in limit (${detail ?? 'member cap'}). Some members were not examined.`,
  'kept:in-content': (detail) =>
    `Not removed: ${detail ?? 'traces inside the content'}. These sit in the document's own content rather than in a metadata field, and rewriting it would change what the document says. Edit the source and regenerate — and if a credential is listed, rotate it.`,
  'kept:content': (detail) =>
    `Left in place: ${detail ?? 'document content'}. These are content rather than metadata — removing them would change what the recipient reads, so review them yourself.`,
};

/** The same caveats in French, for the surfaces that report in it. */
export const NOTE_TEXT_FR: Record<Note['code'], (detail?: string) => string> = {
  'scope:pdf-metadata-only': () =>
    "Métadonnées, plus un scan des flux décompressés (secrets, identifiants de fournisseur) et du texte des pages, décodé via la table ToUnicode de chaque police. C'est cette table qui retransforme les codes de glyphes d'une police sous-ensemble en caractères ; une page dont la police n'en porte pas est lue en codes bruts, où une détection reste fiable mais une absence ne prouve rien. Un filigrane statistique n'apparaîtrait dans aucun des deux cas.",
  'scope:ooxml-metadata-only': () =>
    "Propriétés du document, un scan des parties à la recherche de secrets et d'identifiants de fournisseur, et un scan du texte visible à la recherche de caractères invisibles. Ce qui n'est pas analysé, c'est la formulation : c'est là que réside un filigrane statistique, et le nettoyage ne l'affecte pas.",
  'scope:invisible-characters-only': () =>
    "Analyse au niveau des caractères : codepoints invisibles, lettres sosies, et les secrets et identifiants de fournisseur qui ne peuvent pas apparaître innocemment. Un filigrane statistique éventuellement présent dans ce texte n'est pas affecté et reste indétectable localement.",
  'scope:markup-metadata-only': () =>
    "Métadonnées du balisage, plus un scan du corps à la recherche de caractères invisibles. Ce qui n'est pas analysé, c'est la formulation : c'est là que réside un filigrane statistique, et il n'apparaîtrait pas ici.",
  'scope:image-metadata-only': () =>
    "Métadonnées du conteneur uniquement. Les pixels ne sont pas analysés : un filigrane invisible encodé dans l'image elle-même n'apparaîtrait pas ici et n'est pas retiré.",
  'removed:c2pa': (detail) =>
    `Manifeste C2PA retiré${detail ? ` (${detail})` : ''}. Le fichier ne porte plus de provenance vérifiable — un tiers ne peut plus confirmer son origine, dans un sens comme dans l'autre. Deux choses que cela ne signifie pas. Le C2PA prévoit le « soft binding », où une marque dans le contenu lui-même permet à l'éditeur de rattacher le manifeste à distance : un manifeste retiré ne veut pas dire qu'il ne reste aucune provenance. Et l'inverse : un « content credential » est une note attachée au fichier, pas incrustée dedans — un simple réenregistrement, une conversion ou un redimensionnement l'efface sans laisser de trace. Son absence, sur n'importe quel fichier, ne prouve donc rien sur l'origine.`,
  'scope:archive': () =>
    "Rapport d'archive. Chaque membre est passé par la détection normale ; ceux qu'aucun analyseur ne reconnaît du tout ont été scannés uniquement à la recherche de secrets et d'identifiants de fournisseur.",
  'limit:archive-truncated': (detail) =>
    `Le parcours de l'archive s'est arrêté à une limite interne (${detail ?? 'plafond de membres'}). Certains membres n'ont pas été examinés.`,
  'kept:in-content': (detail) =>
    `Non retiré : ${detail ?? 'traces dans le contenu'}. Ces éléments sont dans le contenu même du document, pas dans un champ de métadonnées, et les réécrire changerait ce que dit le document. Corrigez la source et régénérez — et si un secret figure dans la liste, révoquez-le.`,
  'kept:content': (detail) =>
    `Laissé en place : ${detail ?? 'contenu du document'}. Il s'agit de contenu et non de métadonnées — le retirer changerait ce que lit le destinataire, à vous de trancher.`,
};

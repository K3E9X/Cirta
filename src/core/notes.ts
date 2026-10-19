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
  'scope:email': () =>
    'Mail: the header block, then each MIME part read by its type — plain text and HTML bodies with their links and hidden text, attachments inspected like the members of an archive. Cleaning removes the header lines that name a tool and invisible characters; the encoded parts are left as written, and what survives is named.',
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
    // States only what re-inspection proved — these are still in the output —
    // and the cleaner's rule. It used to say every item sat in the document's
    // own content, which was false for PDF annotation authors, metadata that
    // the cleaner simply never visited.
    `Still in the cleaned copy: ${detail ?? 'traces inside the content'}. Cleaning removes what the file says about how and by whom it was made, and leaves what the document itself says — rewriting that would change what the recipient reads. Fix these in the source and regenerate — and if a credential is listed, rotate it.`,
  'kept:content': (detail) =>
    `Left in place: ${detail ?? 'document content'}. These are content rather than metadata — removing them would change what the recipient reads, so review them yourself.`,
  'limit:hidden-text-unchecked': (detail) =>
    `The pages were not rendered${detail ? ` (${detail})` : ''}, so text a reader cannot see — under a shape, in the page colour, too small, past the edge — was not looked for. Its absence from this report says nothing either way.`,
  'limit:hidden-text-truncated': (detail) =>
    `Hidden text was looked for on the first ${detail ? detail.replace('/', ' of ') : 'few'} pages only; the rest were not rendered.`,
  'rasterized:pages': (detail) =>
    `Text covered by a shape was burnt out: page${(detail ?? '').includes(',') ? 's' : ''} ${detail ?? '?'} ${(detail ?? '').includes(',') ? 'are' : 'is'} now a picture of ${(detail ?? '').includes(',') ? 'themselves' : 'itself'}, so the covered text is gone for good — and so is the selectable, searchable text of ${(detail ?? '').includes(',') ? 'those pages' : 'that page'}. Other pages are unchanged.`,
  'removed:tracking-params': (detail) =>
    `Removed the tracking parameters (utm_*, fbclid, gclid…) from ${detail ?? 'the'} link${detail === '1' ? '' : 's'}; the rest of each address is unchanged.`,
  'removed:attachments': (detail) =>
    `Removed ${detail ?? 'the'} embedded file${detail === '1' ? '' : 's'}, and the bytes ${detail === '1' ? 'it' : 'they'} held.`,
  'flattened:annotations': (detail) => {
    const [drawn, removed] = (detail ?? '0/0').split('/');
    return `Flattened ${removed} annotation${removed === '1' ? '' : 's'}: ${drawn} drawn into the page as ${drawn === '1' ? 'it' : 'they'} appeared, ${Number(removed) - Number(drawn)} with nothing to show removed — ${Number(removed) - Number(drawn) === 1 ? 'its' : 'their'} text is gone. Authors and comments go with them; links and form fields stay.`;
  },
  'removed:notes': (detail) =>
    `Removed the speaker notes of ${detail ?? 'the'} slide${detail === '1' ? '' : 's'}, with every reference to them.`,
  'removed:hidden-slides': (detail) =>
    `Removed ${detail ?? 'the'} hidden slide${detail === '1' ? '' : 's'}, with ${detail === '1' ? 'its' : 'their'} notes and ${detail === '1' ? 'its' : 'their'} place in the slide list, sections and custom shows.`,
  'removed:hidden-sheets': (detail) =>
    `Removed ${detail ?? 'the'} hidden sheet${detail === '1' ? '' : 's'}. Nothing else in the workbook referred to ${detail === '1' ? 'it' : 'them'}.`,
  'kept:hidden-sheets': (detail) =>
    `Hidden sheets kept: ${detail ?? 'they'} — a formula, a defined name or a chart reads them, and removing them would turn cells into #REF!. Delete them in Excel, where the references can be fixed, then clean again.`,
  'removed:remote-resources': (detail) =>
    `Removed ${detail ?? 'the'} remote resource${detail === '1' ? '' : 's'} — pictures, styles, scripts and frames fetched from a server when the document is opened, tracking pixels included. A Markdown image keeps its description as text.`,
  'removed:active-content': (detail) =>
    `Removed ${detail ?? 'the'} active element${detail === '1' ? '' : 's'}: scripts, actions run on opening or on an event, launches, form submissions, macros, remote templates and embedded files. Plain web links stay — where a link points is part of what the document says.`,
  'removed:comments': (detail) =>
    detail === '1'
      ? 'Removed the comment: its text, its author and its thread, with every reference to it in the document.'
      : `Removed ${detail ?? 'the'} comments: their text, their authors and the threads they belonged to, with every reference to them in the document.`,
  'removed:tracked-changes': (detail) =>
    `Accepted ${detail ?? 'the'} tracked change${detail === '1' ? '' : 's'}: deleted and moved-away text is gone from the file, inserted text stays as ordinary text, and the record of formatting changes is dropped. The document now reads as it did with every change accepted in Word.`,
  'removed:hidden-text': (detail) =>
    `Removed ${detail ?? 'the'} hidden passage${detail === '1' ? '' : 's'} a reader could not see — the text, not the formatting around it. Text that is only faint, and anything listed as probable, was left: it may be meant to be seen.`,
  'changed:nfc': (detail) =>
    `Recomposed ${detail ?? 'the'} accented letter${detail === '1' ? '' : 's'} (NFC): composed and decomposed forms were mixed, and the mix is itself a channel. The letters read the same; their bytes changed.`,
  'kept:typographic-spaces': (detail) =>
    `Left ${detail ?? 'the'} typographic space${detail === '1' ? '' : 's'} (no-break, narrow…) as written: that is typography — French puts one before ":", "!" and "?" — not a mark.`,
  'limit:hidden-text-doubtful': (detail) =>
    `Most of the text on page ${detail ?? '?'} drew no ink. Either the page is built to hide it, or it uses a font or an image this check cannot draw; the pixels cannot tell the two apart, so what is listed there is marked probable. Open the page and compare.`,
};

/** The same caveats in French, for the surfaces that report in it. */
export const NOTE_TEXT_FR: Record<Note['code'], (detail?: string) => string> = {
  'scope:pdf-metadata-only': () =>
    "Métadonnées, plus un scan des flux décompressés (secrets, identifiants de fournisseur) et du texte des pages, décodé via la table ToUnicode de chaque police. C'est cette table qui retransforme les codes de glyphes d'une police sous-ensemble en caractères ; une page dont la police n'en porte pas est lue en codes bruts, où une détection reste fiable mais une absence ne prouve rien. Un filigrane statistique n'apparaîtrait dans aucun des deux cas.",
  'scope:ooxml-metadata-only': () =>
    "Propriétés du document, un scan des parties à la recherche de secrets et d'identifiants de fournisseur, et un scan du texte visible à la recherche de caractères invisibles. Ce qui n'est pas analysé, c'est la formulation : c'est là que réside un filigrane statistique, et le nettoyage ne l'affecte pas.",
  'scope:email': () =>
    "Courrier : le bloc d'en-têtes, puis chaque partie MIME lue selon son type — corps texte et HTML avec leurs liens et leur texte caché, pièces jointes inspectées comme les membres d'une archive. Le nettoyage retire les lignes d'en-tête qui nomment un logiciel et les caractères invisibles ; les parties encodées restent telles qu'écrites, et ce qui survit est nommé.",
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
    `Toujours dans la copie nettoyée : ${detail ?? 'traces dans le contenu'}. Le nettoyage retire ce que le fichier dit de sa fabrication et de ses auteurs, et laisse ce que dit le document lui-même — le réécrire changerait ce que lit le destinataire. Corrigez-les dans la source et régénérez — et si un secret figure dans la liste, révoquez-le.`,
  'kept:content': (detail) =>
    `Laissé en place : ${detail ?? 'contenu du document'}. Il s'agit de contenu et non de métadonnées — le retirer changerait ce que lit le destinataire, à vous de trancher.`,
  'limit:hidden-text-unchecked': (detail) =>
    `Les pages n'ont pas été rendues${detail ? ` (${detail})` : ''} : le texte qu'un lecteur ne voit pas — sous une forme, couleur de la page, trop petit, hors de la page — n'a pas été cherché. Son absence de ce rapport ne prouve rien.`,
  'limit:hidden-text-truncated': (detail) =>
    `Le texte caché n'a été cherché que sur les ${detail ? detail.replace('/', ' premières pages sur ') : 'premières pages'} ; les suivantes n'ont pas été rendues.`,
  'rasterized:pages': (detail) =>
    `Le texte recouvert par une forme a été brûlé : ${(detail ?? '').includes(',') ? 'les pages' : 'la page'} ${detail ?? '?'} ${(detail ?? '').includes(',') ? 'sont' : 'est'} désormais une image d'elle${(detail ?? '').includes(',') ? 's' : ''}-même${(detail ?? '').includes(',') ? 's' : ''}, le texte recouvert a donc disparu pour de bon — et avec lui le texte sélectionnable et cherchable de ${(detail ?? '').includes(',') ? 'ces pages' : 'cette page'}. Les autres pages sont inchangées.`,
  'removed:tracking-params': (detail) =>
    `Paramètres de suivi (utm_*, fbclid, gclid…) retirés de ${detail ?? 'les'} lien${detail === '1' ? '' : 's'} ; le reste de chaque adresse est inchangé.`,
  'removed:attachments': (detail) =>
    `${detail === '1' ? 'Fichier intégré retiré' : `${detail ?? 'Les'} fichiers intégrés retirés`}, avec les octets qu'${detail === '1' ? 'il contenait' : 'ils contenaient'}.`,
  'flattened:annotations': (detail) => {
    const [drawn, removed] = (detail ?? '0/0').split('/');
    return `${removed} annotation(s) aplatie(s) : ${drawn} dessinée(s) dans la page telle(s) qu'elle(s) apparaissai(en)t, ${Number(removed) - Number(drawn)} sans apparence retirée(s) — leur texte a disparu. Auteurs et commentaires partent avec elles ; liens et champs de formulaire restent.`;
  },
  'removed:notes': (detail) =>
    `Notes du présentateur retirées sur ${detail ?? 'les'} diapositive${detail === '1' ? '' : 's'}, avec toutes les références vers elles.`,
  'removed:hidden-slides': (detail) =>
    `${detail === '1' ? 'Diapositive masquée retirée' : `${detail ?? 'Les'} diapositives masquées retirées`}, avec leurs notes et leur place dans la liste des diapositives, les sections et les diaporamas personnalisés.`,
  'removed:hidden-sheets': (detail) =>
    `${detail === '1' ? 'Feuille masquée retirée' : `${detail ?? 'Les'} feuilles masquées retirées`}. Rien d'autre dans le classeur n'y faisait référence.`,
  'kept:hidden-sheets': (detail) =>
    `Feuilles masquées conservées : ${detail ?? 'elles'} — une formule, un nom défini ou un graphique les lit, et les retirer changerait des cellules en #REF!. Supprimez-les dans Excel, où les références peuvent être corrigées, puis nettoyez à nouveau.`,
  'removed:remote-resources': (detail) =>
    `${detail === '1' ? 'Ressource distante retirée' : `${detail ?? 'Les'} ressources distantes retirées`} — images, styles, scripts et cadres chargés depuis un serveur à l'ouverture du document, pixels de suivi compris. Une image Markdown garde sa description en texte.`,
  'removed:active-content': (detail) =>
    `${detail === '1' ? 'Élément actif retiré' : `${detail ?? 'Les'} éléments actifs retirés`} : scripts, actions lancées à l'ouverture ou sur un événement, lancements de programme, envois de formulaire, macros, modèles distants et fichiers intégrés. Les simples liens web restent — là où pointe un lien fait partie de ce que dit le document.`,
  'removed:comments': (detail) =>
    detail === '1'
      ? 'Commentaire retiré : son texte, son auteur et son fil, avec toutes les références à lui dans le document.'
      : `${detail ?? 'Les'} commentaires retirés : leur texte, leurs auteurs et les fils dont ils faisaient partie, avec toutes les références à eux dans le document.`,
  'removed:tracked-changes': (detail) =>
    `${detail === '1' ? 'Modification suivie acceptée' : `${detail ?? 'Les'} modifications suivies acceptées`} : le texte supprimé ou déplacé a quitté le fichier, le texte inséré reste comme texte ordinaire, et l'historique des changements de mise en forme est retiré. Le document se lit désormais comme si toutes les modifications avaient été acceptées dans Word.`,
  'removed:hidden-text': (detail) =>
    `${detail === '1' ? 'Passage caché retiré' : `${detail ?? 'Les'} passages cachés retirés`} — le texte qu'un lecteur ne voyait pas, pas la mise en forme autour. Le texte seulement pâle, et ce qui est listé comme probable, a été laissé : il est peut-être fait pour être vu.`,
  'changed:nfc': (detail) =>
    `${detail === '1' ? 'Lettre accentuée recomposée' : `${detail ?? 'Les'} lettres accentuées recomposées`} (NFC) : formes composée et décomposée étaient mêlées, et ce mélange est à lui seul un canal. Les lettres se lisent pareil ; leurs octets ont changé.`,
  'kept:typographic-spaces': (detail) =>
    `${detail === '1' ? 'Espace typographique laissée' : `${detail ?? 'Les'} espaces typographiques laissées`} telles qu'écrites (insécable, fine…) : c'est la typographie — le français en met une avant « : », « ! » et « ? » —, pas une marque.`,
  'limit:hidden-text-doubtful': (detail) =>
    `La majeure partie du texte de la page ${detail ?? '?'} n'a laissé aucune encre. Soit la page est faite pour le cacher, soit elle utilise une police ou une image que ce contrôle ne sait pas dessiner ; les pixels ne permettent pas de trancher, donc ce qui y est listé est marqué probable. Ouvrez la page et comparez.`,
};

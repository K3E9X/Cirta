/**
 * Everything the interfaces say in French.
 *
 * The core library reports in English — field names, note codes, the values it
 * builds by interpolating a count — so that it reads consistently for anyone
 * using it as a library. Both front-ends then translate, and both were
 * translating separately: the page had these tables, the command line had none
 * and could only speak English. They live here so a field renamed in one is
 * renamed in the other, and so the command line can be French at all.
 *
 * English needs no table. It is the core's own wording, so every helper below
 * returns its input unchanged when the language is English.
 */

import type { Finding, Note } from '../core/types.js';
import { NOTE_TEXT_EN, NOTE_TEXT_FR } from '../core/notes.js';

export type Lang = 'fr' | 'en';

/**
 * The core reports field names in English so the library reads consistently;
 * this interface is French. Unicode character names are deliberately absent —
 * "ZERO WIDTH SPACE" is the standard's own identifier and stays untranslated.
 */
const FIELD_LABEL: Record<string, string> = {
  Author: 'Auteur',
  'Last modified by': 'Dernière modification par',
  Title: 'Titre',
  Subject: 'Objet',
  Description: 'Description',
  Keywords: 'Mots-clés',
  Category: 'Catégorie',
  'Content status': 'Statut du contenu',
  'Revision number': 'Numéro de révision',
  Created: 'Créé le',
  Modified: 'Modifié le',
  'Creating application': 'Application de création',
  'Producing application': 'Application productrice',
  'Application version': 'Version de l’application',
  Company: 'Société',
  Manager: 'Responsable',
  Template: 'Modèle',
  'Total editing time': 'Temps d’édition total',
  'Custom properties': 'Propriétés personnalisées',
  'Embedded thumbnail': 'Miniature intégrée',
  'Revision save IDs': 'Identifiants de révision',
  'Comment and revision authors': 'Auteurs des commentaires et révisions',
  'C2PA provenance manifest': 'Manifeste de provenance C2PA',
  'C2PA content credentials': 'Content Credentials C2PA',
  'Embedded file attachments': 'Pièces jointes intégrées',
  'XMP creator tool': 'Outil de création XMP',
  'XMP producer': 'Producteur XMP',
  'XMP author': 'Auteur XMP',
  'XMP title': 'Titre XMP',
  'XMP created': 'Création XMP',
  'XMP modified': 'Modification XMP',
  'XMP document ID': 'Identifiant de document XMP',
  'XMP instance ID': 'Identifiant d’instance XMP',
  'Last printed': 'Dernière impression',
  'Link to a local or network path': 'Lien vers un chemin local ou réseau',
  'Hidden slides': 'Diapositives masquées',
  'Speaker notes': 'Notes du présentateur',
  'Comment authors': 'Auteurs des commentaires',
  'Defined name pointing outside the workbook': 'Nom défini pointant hors du classeur',
  'Links to other workbooks': 'Liens vers d’autres classeurs',
  'Exif with GPS coordinates': 'Exif avec coordonnées GPS',
  'Exif camera data': 'Données Exif de l’appareil',
  'XMP metadata': 'Métadonnées XMP',
  'APP1 metadata': 'Métadonnées APP1',
  'IPTC/Photoshop metadata': 'Métadonnées IPTC/Photoshop',
  'Embedded comment': 'Commentaire intégré',
  'Application metadata': 'Métadonnées applicatives',
  'Document identifier (/ID)': 'Identifiant de document (/ID)',
  'Windows account': 'Compte Windows',
  'macOS account': 'Compte macOS',
  'Linux account': 'Compte Linux',
  'WSL mount': 'Montage WSL',
  'Windows temporary directory': 'Répertoire temporaire Windows',
  'macOS temporary directory': 'Répertoire temporaire macOS',
  'Temporary directory': 'Répertoire temporaire',
  'Session identifier': 'Identifiant de session',
  'Run or workspace identifier (UUID)': 'Identifiant d’exécution ou d’espace de travail (UUID)',
  'Assistant or agent named in metadata': 'Assistant ou agent nommé dans les métadonnées',
  'Document generated programmatically': 'Document généré par programme',
  'Text reordering controls': 'Contrôles de réordonnancement du texte',
  'Hidden payload in text': 'Charge cachée dans le texte',
  'Letters that look alike but are not': 'Lettres sosies venues d’un autre alphabet',
  'Fullwidth letters among ASCII ones': 'Lettres pleine chasse mêlées à des ASCII',
  'Same letters written two different ways': 'Mêmes lettres écrites de deux façons',
  'Text is in decomposed form (NFD)': 'Texte en forme décomposée (NFD)',
  'Dashes that are not the ASCII hyphen': 'Tirets qui ne sont pas le trait d’union ASCII',
  'Trailing whitespace': 'Espaces en fin de ligne',
  'Spacing after full stops is inconsistent': 'Espacement après les points, irrégulier',
  'Line endings are mixed': 'Fins de ligne mélangées',
  'Control characters in the text': 'Caractères de contrôle dans le texte',
  'Hangul filler': 'Remplisseur hangûl',
  'blank braille cell': 'Cellule braille vide',
  'Custom XML data store': 'Magasin de données XML personnalisé',
  'AI provenance data attributes': 'Attributs de données de provenance IA',
  'How the file says it was made': 'Ce que le fichier dit de sa fabrication',
  // En-têtes de courrier.
  'Mail client': 'Client de messagerie',
  'Composing agent': 'Agent de rédaction',
  'Originating client': 'Client d’origine',
  'Declared as AI-generated': 'Déclaré comme généré par IA',
  Sender: 'Expéditeur',
  'Reply-to address': 'Adresse de réponse',
  'Return path': 'Chemin de retour',
  'Envelope sender': 'Expéditeur d’enveloppe',
  'Originating IP address': 'Adresse IP d’origine',
  'Blind carbon copy': 'Copie cachée',
  'Message identifier': 'Identifiant du message',
  'In reply to': 'En réponse à',
  'Thread references': 'Références du fil',
  'Thread index': 'Index du fil',
  'Thread topic': 'Sujet du fil',
  'Relay hop': 'Relais traversé',
  'Forwarded for': 'Transféré pour',
  'Written by the docx JavaScript library': 'Écrit par la bibliothèque JavaScript docx',
  'Assembled by a program, not typed in a word processor':
    'Assemblé par un programme, pas tapé dans un traitement de texte',
  'Assembled by a program, not exported from an editor':
    'Assemblé par un programme, pas exporté depuis un éditeur',
  'Assembled by a program, not saved from an office suite':
    'Assemblé par un programme, pas enregistré depuis une suite bureautique',
  'Metadata has been stripped from this file': 'Les métadonnées de ce fichier ont été effacées',
  'Written in a single pass': 'Écrit en une seule passe',
  'Software credited by the action': 'Logiciel crédité par l’action',
  'SVG metadata block': 'Bloc de métadonnées SVG',
  'Editor namespace': 'Espace de noms de l’éditeur',
  'Generator comment': 'Commentaire de génération',
  'SVG title (accessibility)': 'Titre SVG (accessibilité)',
  'SVG description (accessibility)': 'Description SVG (accessibilité)',
  'Generator meta tag': 'Balise meta generator',
  'Author meta tag': 'Balise meta author',
  Creator: 'Créateur',
  'Attribution line': 'Ligne d’attribution',
  'Creator meta tag': 'Balise meta creator',
  'Copyright meta tag': 'Balise meta copyright',
  'Date meta tag': 'Balise meta date',
  'JSON-LD structured data': 'Données structurées JSON-LD',
  'Initial author': 'Auteur initial',
  'Printed by': 'Imprimé par',
  'Edit cycles': 'Cycles d’édition',
  'User-defined properties': 'Propriétés définies par l’utilisateur',
  Generator: 'Générateur',
  'Generated by': 'Généré par',
  'Created with': 'Créé avec',
  'AI-generated flag': 'Indicateur « généré par IA »',
  'AI flag': 'Indicateur IA',
  Model: 'Modèle',
  Tool: 'Outil',
  Session: 'Session',
  'Source path': 'Chemin source',
  Date: 'Date',
  Authors: 'Auteurs',
  'Model identifier': 'Identifiant de modèle',
  'Coding agent named in metadata': 'Agent de codage nommé dans les métadonnées',
  'LLM framework or runtime': 'Framework ou runtime LLM',
  'LLM provider endpoint': 'Point de terminaison de fournisseur LLM',
  'Anthropic message id': 'Identifiant de message Anthropic',
  'OpenAI completion id': 'Identifiant de complétion OpenAI',
  'OpenAI assistant object id': 'Identifiant d’objet Assistant OpenAI',
  'API request id': 'Identifiant de requête API',
  'Conversation id': 'Identifiant de conversation',
  'Absolute paths preserved in the archive': 'Chemins absolus conservés dans l’archive',
  'Hidden payload in document text': 'Charge cachée dans le texte du document',
  'Hidden payload in page text': 'Charge cachée dans le texte des pages',
  'Tool credited by the C2PA manifest': 'Outil crédité par le manifeste C2PA',
  'What the C2PA manifest asserts': 'Ce que le manifeste C2PA affirme',
};

/** Descriptive values the core writes in prose rather than reporting verbatim data. */
const VALUE_TEXT: Record<string, string> = {
  'rendered preview of document content': 'aperçu visuel du contenu du document',
  'signed provenance manifest': 'manifeste de provenance signé',
  'present — may carry provenance manifests or source data':
    'présentes — peuvent contenir des manifestes de provenance ou des données sources',
  present: 'présentes',
  'the part exists but holds no properties': 'la partie existe mais ne contient aucune propriété',
  'file was assembled in a scratch directory':
    'le fichier a été assemblé dans un répertoire de travail temporaire',
  'the /Info dictionary is present and empty, which no producer writes — every one of them records at least a /Producer. Cleaning a document leaves this shape behind':
    'le dictionnaire /Info est présent et vide, ce qu’aucun producteur n’écrit — tous inscrivent au moins un /Producer. Nettoyer un document laisse cette forme derrière soi',
  'the generator element is present and empty, which no application writes; the package still carries the parts an office suite adds, so the metadata was removed after the fact':
    'l’élément generator est présent et vide, ce qu’aucune application n’écrit ; le paquet porte encore les parties qu’ajoute une suite bureautique, donc les métadonnées ont été retirées après coup',
  'created and last modified at the same instant, so the file was never reopened':
    'créé et modifié au même instant : le fichier n’a jamais été rouvert',
};

/**
 * Note details are built by the core out of English fragments — a list of
 * content kinds, or a list of finding labels. Spliced raw into a French
 * sentence they read as a bug, so both shapes are translated here.
 */
const CONTENT_KIND: Record<string, string> = {
  'local links': 'liens locaux',
  'hidden slides': 'diapositives masquées',
  'speaker notes': 'notes du présentateur',
  'external workbook references': 'références vers d’autres classeurs',
};

/** Some labels carry the field name, so the prefix is translated rather than the whole. */
const LABEL_PREFIX: Array<[RegExp, string]> = [
  [/^Custom property: /, 'Propriété personnalisée : '],
  [/^User-defined property: /, 'Propriété utilisateur : '],
  [/^Custom info key: /, 'Clé /Info personnalisée : '],
  [/^Credential left in file: /, 'Secret laissé dans le fichier : '],
  [/^Non-standard header: /, 'En-tête non standard : '],
  [/^Relay hop /, 'Relais traversé '],
];

/** Locations the core states in prose rather than as a path or a field name. */
const LOCATION_TEXT: Record<string, string> = {
  'mixed-script words': 'mots à alphabets mêlés',
  'Unicode normalisation': 'normalisation Unicode',
  'hyphen lookalikes': 'sosies du trait d’union',
  'line endings': 'fins de ligne',
  'sentence spacing': 'espacement des phrases',
  'control characters': 'caractères de contrôle',
  'file contents': 'contenu du fichier',
  'mixed-width words': 'mots à chasses mêlées',
  'tracked changes / comments': 'suivi de modifications / commentaires',
  'bidirectional controls': 'contrôles bidirectionnels',
  'document body': 'corps du document',
  'container structure': 'structure du conteneur',
  'file structure': 'structure du fichier',
  'package structure': 'structure du paquet',
};

/** Alphabet names, which the core reports in English inside a sentence. */
const SCRIPT_TEXT: Record<string, string> = {
  Latin: 'latin',
  Cyrillic: 'cyrillique',
  Greek: 'grec',
};

/** Values the core builds by interpolating a count, matched by shape. */
const VALUE_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [
    /^(\d+) values? \(correlate documents edited in the same session\)$/,
    (m) => `${m[1]} valeur(s) — corrèlent les documents édités dans la même session`,
  ],
  [
    /^(\d+) hidden slides? still present in the file$/,
    (m) => `${m[1]} diapositive(s) masquée(s), toujours présentes dans le fichier`,
  ],
  [/^(\d+) slides? with presenter notes$/, (m) => `${m[1]} diapositive(s) avec des notes`],
  [/^(\d+) bytes$/, (m) => `${m[1]} octets`],
  [/^(\d+) external reference part\(s\)$/, (m) => `${m[1]} partie(s) de référence externe`],
  [
    // Any number of scripts, not just two: a document can mix Latin with both
    // Cyrillic and Greek, and the two-script pattern left that untranslated.
    /^(.+) — one word mixing (.+)$/,
    (m) => {
      const scripts = (m[2] ?? '').split(' and ').map((name) => SCRIPT_TEXT[name] ?? name);
      const last = scripts.pop();
      const list = scripts.length ? `${scripts.join(', ')} et ${last}` : last;
      return `${m[1]} — un seul mot mêlant ${list}`;
    },
  ],
  [
    /^(\d+) part\(s\) — content-control bindings, library columns or classification labels$/,
    (m) =>
      `${m[1]} partie(s) — liaisons de contrôles de contenu, colonnes de bibliothèque ou étiquettes de classification`,
  ],
  [/^(\d+) attributes? — (.+)$/, (m) => `${m[1]} attribut(s) — ${m[2]}`],
  // Vocabulaire IPTC digitalSourceType : le terme reste tel quel, c'est
  // l'identifiant de la norme ; seule la glose est traduite.
  [
    /^(\w+) — created by a generative model — the file says so itself$/,
    (m) => `${m[1]} — créé par un modèle génératif, le fichier l'affirme lui-même`,
  ],
  [
    /^(\w+) — a composite including generative-model content — the file says so itself$/,
    (m) => `${m[1]} — un composite incluant du contenu de modèle génératif, le fichier l'affirme`,
  ],
  [
    /^(\w+) — produced by an algorithm, which does not by itself mean a trained model$/,
    (m) => `${m[1]} — produit par un algorithme, ce qui n'implique pas en soi un modèle entraîné`,
  ],
  [
    /^(\w+) — human-made, then altered by an algorithm$/,
    (m) => `${m[1]} — fait par un humain, puis altéré par un algorithme`,
  ],
  [
    /^(\w+) — captured by a camera — an explicit statement that it is not generated$/,
    (m) => `${m[1]} — capturé par un appareil photo : une affirmation explicite que ce n'est pas généré`,
  ],
  [
    /^(\w+) — generated from data rather than captured$/,
    (m) => `${m[1]} — généré à partir de données plutôt que capturé`,
  ],
  [
    /^(\d+) decomposed and (\d+) composed accented letters in one document — the choice between them carries about (\d+) bits$/,
    (m) =>
      `${m[1]} lettres accentuées décomposées et ${m[2]} composées dans un même document — le choix entre les deux transporte environ ${m[3]} bits`,
  ],
  [
    /^(\d+) decomposed accented letters, none composed — usual for text that passed through macOS$/,
    (m) => `${m[1]} lettres accentuées décomposées, aucune composée — courant pour un texte passé par macOS`,
  ],
  [
    /^(.+) — indistinguishable from "-" on screen$/,
    (m) => `${m[1]} — indiscernables du « - » à l'écran`,
  ],
  [
    /^(\d+) of (\d+) lines end in spaces or tabs — invisible in an editor, and one bit per line$/,
    (m) =>
      `${m[1]} lignes sur ${m[2]} se terminent par des espaces ou des tabulations — invisible dans un éditeur, et un bit par ligne`,
  ],
  [
    /^(\d+) sentences followed by two or more spaces, (\d+) by one — one bit per sentence$/,
    (m) => `${m[1]} phrases suivies de deux espaces ou plus, ${m[2]} d'une seule — un bit par phrase`,
  ],
  [
    /^(\d+) CRLF and (\d+) LF in one file — one bit per line\. Note that pasting into a browser normalises these away, so this only shows on a file$/,
    (m) =>
      `${m[1]} CRLF et ${m[2]} LF dans un même fichier — un bit par ligne. À noter : un collage dans le navigateur les normalise, ce canal n'apparaît donc que sur un fichier`,
  ],
  [
    /^(\d+) controls? that can make text display differently from how it is stored \(CVE-2021-42574\)$/,
    (m) =>
      `${m[1]} contrôle(s) pouvant faire afficher le texte autrement qu'il n'est stocké (CVE-2021-42574)`,
  ],
  [/^(.+) — from "(.+)"$/, (m) => `${m[1]} — d'après « ${m[2]} »`],
  [
    /^(.+) — asserted by the manifest, signature not verified$/,
    (m) => `${m[1]} — déclaré par le manifeste, signature non vérifiée`,
  ],
  [/^(.+) \(drive ([A-Za-z]):\)$/, (m) => `${m[1]} (lecteur ${m[2]} :)`],
];

/**
 * Structural findings compose their value out of reason fragments joined by
 * "; ", one per signal observed, so the fragments are translated one by one.
 * A fragment this table does not know passes through in English — visibly
 * wrong, which is the correct failure mode for a missing translation.
 */
const REASON_TEXT: Record<string, string> = {
  // OOXML
  'docProps/app.xml is present but empty': 'docProps/app.xml est présent mais vide',
  'timestamps carry milliseconds, the shape JavaScript writes':
    'les horodatages portent des millisecondes, la forme qu’écrit JavaScript',
  'created and modified are the same instant': 'création et modification au même instant',
  'no revision save IDs, which Word always writes':
    'aucun identifiant de révision, que Word écrit toujours',
  // PDF
  'the trailer carries no /ID, which the format asks for':
    'le trailer ne porte pas d’/ID, que le format demande',
  'created and modified at the same instant': 'créé et modifié au même instant',
  'no XMP metadata packet': 'aucun paquet de métadonnées XMP',
  'not tagged for accessibility': 'non balisé pour l’accessibilité',
  // ODF
  'no settings.xml, which records the state of an open window':
    'pas de settings.xml, qui enregistre l’état d’une fenêtre ouverte',
  'no edit-cycle count, which an office suite writes on the first save':
    'aucun compteur de cycles d’édition, qu’une suite bureautique écrit dès le premier enregistrement',
  'no embedded thumbnail': 'aucune miniature intégrée',
  'no manifest.rdf': 'pas de manifest.rdf',
};

const REASON_SUFFIX: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [
    / — the last of these are also absent from a file printed to PDF$/,
    () => ' — ces derniers manquent aussi dans un fichier imprimé en PDF',
  ],
  [
    / — despite meta:generator naming (.+)$/,
    (m) => ` — alors même que meta:generator déclare ${m[1]}`,
  ],
];



export const translateDetail = (detail: string, lang: Lang): string =>
  lang === 'en'
    ? detail
    : detail
        .split(', ')
        .map((part) => CONTENT_KIND[part] ?? translateLabel(part, lang))
        .join(', ');

const NOTE_TEXT = NOTE_TEXT_FR;

/**
 * À quoi ressemble le texte, pas d'où il vient.
 *
 * Même forme que la carte du filigrane : des mesures, et un décompte. Pas de
 * score — un score serait lu comme une probabilité, et ces signaux n'ont jamais
 * été calibrés pour en produire une. Les détecteurs qui le font classent 61 %
 * des copies d'anglophones non natifs comme générées (Liang et al., 2023).
 */

export function translateLabel(label: string, lang: Lang): string {
  if (lang === 'en') return label;
  const mapped = FIELD_LABEL[label];
  if (mapped) return mapped;
  for (const [pattern, prefix] of LABEL_PREFIX) {
    if (pattern.test(label)) return label.replace(pattern, prefix);
  }
  return label;
}

/** The core marks derived findings with an English prefix naming their source. */
export const translateLocation = (location: string, lang: Lang): string => {
  if (lang === 'en') return location;

  // "derived from X" wraps another location, so the inner half is translated by
  // the same function rather than by a second copy of these rules. Without the
  // recursion a derived finding read "dérivé de mail header:message-id", half
  // translated, which looks like a bug because it is one.
  const derived = /^derived from (.+)$/.exec(location);
  if (derived?.[1]) return `dérivé de ${translateLocation(derived[1], lang)}`;

  const mapped = LOCATION_TEXT[location];
  if (mapped) return mapped;

  // Body findings arrive as "part (location)", so the inner half needs it too.
  const nested = /^(.+) \((.+)\)$/.exec(location);
  if (nested?.[2] && LOCATION_TEXT[nested[2]]) return `${nested[1]} (${LOCATION_TEXT[nested[2]]})`;

  // « mail header:x-mailer » : le nom du champ est celui de la norme, il reste
  // tel quel ; seul le mot qui l'introduit est traduit.
  const header = /^mail header:(.+)$/.exec(location);
  if (header) return `en-tête ${header[1]}`;
  return location;
};

function translateReasons(value: string): string {
  let suffix = '';
  for (const [pattern, render] of REASON_SUFFIX) {
    const match = pattern.exec(value);
    if (match) {
      suffix = render(match);
      value = value.slice(0, match.index);
      break;
    }
  }
  const parts = value.split('; ').map((part) => {
    const known = REASON_TEXT[part];
    if (known) return known;
    const media = /^(\d+) media file\(s\) named by content hash rather than image1, image2$/.exec(part);
    if (media) return `${media[1]} fichier(s) média nommés par empreinte de contenu plutôt que image1, image2`;
    return part;
  });
  return parts.join(' ; ') + suffix;
}

export function translateValue(finding: Finding, lang: Lang): string {
  if (lang === 'en') return finding.value;
  // Occurrence counts read identically in both languages.
  const mapped = VALUE_TEXT[finding.value];
  if (mapped) return mapped;
  if (/\bstructure$/.test(finding.location)) return translateReasons(finding.value);
  for (const [pattern, render] of VALUE_PATTERNS) {
    const match = pattern.exec(finding.value);
    if (match) return render(match);
  }
  return finding.value;
}

/** The note caveat for a code, in the requested language. */
export const noteText = (note: Note, lang: Lang): string =>
  (lang === 'en' ? NOTE_TEXT_EN : NOTE_TEXT_FR)[note.code](
    note.detail === undefined ? undefined : translateDetail(note.detail, lang),
  );

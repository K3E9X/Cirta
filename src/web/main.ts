/**
 * Browser front-end for Cirta.
 *
 * Every operation runs against the local File object — in a worker for
 * documents, on the main thread for pasted text. There is no fetch, XHR or
 * WebSocket anywhere in this bundle, and no file ever leaves the machine; a
 * worker is another thread in the same page, not another machine. The scope
 * statement in the page is kept honest by the core: statistical model
 * watermarks are neither detected nor claimed to be.
 */

import type { WorkerRequest, WorkerResponse } from './worker.js';
// Imported from the individual modules rather than the barrel: pulling in
// core/index.js would drag pdf-lib and fflate into the main bundle, when the
// only code that needs them now runs in the worker.
import { cleanText } from '../core/text.js';
import { inspectPlainText } from '../core/plaintext.js';
import { stripToolHeaders } from '../core/email.js';
import { provenance } from '../core/fingerprint.js';
import { exposure, type Exposure } from '../core/exposure.js';
import { stylometry, type StyleBand } from '../core/stylometry.js';
import {
  preview,
  type Confidence,
  type Finding,
  type Format,
  type Note,
  type InspectResult,
  type RedactResult,
} from '../core/types.js';

/**
 * Analysis runs in a worker so a large PDF or archive cannot freeze the tab.
 * The worker is created on first use rather than at load, so a visitor who only
 * uses the text panel never pays for it.
 */
let worker: Worker | undefined;
let nextRequestId = 0;
const pending = new Map<number, { resolve: (value: never) => void; reject: (error: Error) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.ok) entry.resolve(event.data as never);
    else entry.reject(new Error(event.data.error));
  });
  worker.addEventListener('error', (event) => {
    for (const [, entry] of pending) entry.reject(new Error(event.message || 'worker failed'));
    pending.clear();
  });
  return worker;
}

function ask<T>(op: WorkerRequest['op'], data: Uint8Array, hint?: string): Promise<T> {
  const id = nextRequestId++;
  // A copy is transferred so the caller keeps its own bytes for a later redact.
  const buffer = data.slice().buffer;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: never) => void, reject });
    ensureWorker().postMessage({ id, op, data: buffer, hint } satisfies WorkerRequest, [buffer]);
  });
}

const inspectFile = async (data: Uint8Array, hint?: string): Promise<InspectResult> =>
  (await ask<{ result: InspectResult }>('inspect', data, hint)).result;

const redactFile = async (data: Uint8Array, hint?: string): Promise<RedactResult> => {
  const reply = await ask<{ result: Omit<RedactResult, 'data'>; data?: ArrayBuffer }>(
    'redact',
    data,
    hint,
  );
  return { ...reply.result, ...(reply.data ? { data: new Uint8Array(reply.data) } : {}) };
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  confirmed: 'confirmé',
  probable: 'probable',
  informational: 'informatif',
};

const KIND_LABEL: Record<Finding['kind'], string> = {
  identity: 'identité',
  provenance: 'provenance',
  timestamp: 'horodatage',
  environment: 'environnement',
  'invisible-character': 'invisible',
};

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
  'Generated by': 'Généré par',
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

const translateDetail = (detail: string): string =>
  detail
    .split(', ')
    .map((part) => CONTENT_KIND[part] ?? translateLabel(part))
    .join(', ');

const NOTE_TEXT: Record<Note['code'], (detail?: string) => string> = {
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
    `Manifeste C2PA retiré${detail ? ` (${detail})` : ''}. Le fichier ne porte plus de provenance vérifiable — un tiers ne peut plus confirmer son origine, dans un sens comme dans l'autre. À noter : le C2PA prévoit aussi le « soft binding », où une marque dans le contenu lui-même permet à l'éditeur de rattacher le manifeste à distance. Un manifeste retiré ne signifie donc pas qu'il ne reste aucune provenance.`,
  'scope:archive': () =>
    "Rapport d'archive. Chaque membre est passé par la détection normale ; ceux qu'aucun analyseur ne reconnaît du tout ont été scannés uniquement à la recherche de secrets et d'identifiants de fournisseur.",
  'limit:archive-truncated': (detail) =>
    `Le parcours de l'archive s'est arrêté à une limite interne (${detail ?? 'plafond de membres'}). Certains membres n'ont pas été examinés.`,
  'kept:in-content': (detail) =>
    `Non retiré : ${detail ? translateDetail(detail) : 'traces dans le contenu'}. Ces éléments sont dans le contenu même du document, pas dans un champ de métadonnées, et les réécrire changerait ce que dit le document. Corrigez la source et régénérez — et si un secret figure dans la liste, révoquez-le.`,
  'kept:content': (detail) =>
    `Laissé en place : ${detail ? translateDetail(detail) : 'contenu du document'}. Il s'agit de contenu et non de métadonnées — le retirer changerait ce que lit le destinataire, à vous de trancher.`,
};

/**
 * State what a silent report is worth at this length.
 *
 * Deliberately not a verdict: reading a keyed watermark requires the vendor's
 * key. What can be reported is how much power a detector holding that key would
 * have on a passage this size, so that "nothing found" is not read as "clean".
 */
const EXPOSURE_TEXT: Record<Exposure['band'], string> = {
  'too-short':
    "À cette longueur, même l'éditeur du modèle peut ne pas obtenir de résultat fiable. Ne rien trouver ici ne signifierait presque rien.",
  uncertain:
    "Assez long pour qu'un détecteur détenant la clé ait une certaine puissance, assez court pour que l'issue dépende du schéma et du seuil retenu.",
  ample:
    'Assez long pour que la littérature (Kirchenbauer et al., ICLR 2024) ait observé un signal survivant à une reformulation humaine soutenue, à 1e-5 de faux positifs.',
};

const STYLE_TEXT: Record<Exclude<StyleBand, 'too-short'>, string> = {
  many: "Plusieurs de ces marqueurs sont présents en même temps. C'est à ça que ressemble de la prose générée — et aussi un brouillon d'entreprise écrit vite.",
  several: "Quelques-uns sont présents. Pris isolément, chacun a une explication parfaitement innocente.",
  few: 'Peu de ces marqueurs sont présents.',
};

/**
 * À quoi ressemble le texte, pas d'où il vient.
 *
 * Même forme que la carte du filigrane : des mesures, et un décompte. Pas de
 * score — un score serait lu comme une probabilité, et ces signaux n'ont jamais
 * été calibrés pour en produire une. Les détecteurs qui le font classent 61 %
 * des copies d'anglophones non natifs comme générées (Liang et al., 2023).
 */
function styleCard(text: string): HTMLElement | undefined {
  const report = stylometry(text);
  if (report.band === 'too-short') return undefined;

  const node = card('Style', undefined, 'des indices, pas un verdict');
  const scroll = el('div', 'table-scroll');
  const table = el('table');
  const body = el('tbody');
  const row = (label: string, value: string) => {
    const tr = el('tr');
    tr.append(el('td', 'kind', label));
    tr.append(el('td', 'value', value));
    body.append(tr);
  };

  row('forme', `${report.sentences} phrases, ${report.meanSentence.toFixed(1)} mots en moyenne`);
  row(
    'variation',
    `${report.burstiness.toFixed(2)} — de combien la longueur des phrases bouge. Les gens varient ` +
      "généralement plus qu'un modèle ; la documentation technique varie moins que les deux.",
  );
  row('tirets', `${report.dashRate.toFixed(1)} cadratins ou demi-cadratins pour 1000 mots`);
  if (report.boldLeadIns > 0) {
    row('amorces', `${Math.round(report.boldLeadIns * 100)}% des paragraphes ouvrent sur une phrase en gras`);
  }
  if (report.indicators.length) {
    row(
      'tournures',
      report.indicators.map((i) => `${i.label} ×${i.count}`).join(' · '),
    );
  }
  row('lecture', STYLE_TEXT[report.band]);

  table.append(body);
  scroll.append(table);
  node.append(scroll);
  node.append(
    el(
      'p',
      'note',
      "Ce sont des signaux de style, pas une preuve de paternité. Les gommer change la façon dont le texte se lit, pas son origine. Utile pour relire votre propre brouillon avant de l'envoyer.",
    ),
  );
  return node;
}

function exposureCard(text: string): HTMLElement {
  const report = exposure(text);
  const node = card('Filigrane statistique', undefined, 'aucun verdict local possible');

  const scroll = el('div', 'table-scroll');
  const table = el('table');
  const body = el('tbody');

  const row = (label: string, value: string) => {
    const tr = el('tr');
    tr.append(el('td', 'kind', label));
    tr.append(el('td', 'value', value));
    body.append(tr);
  };
  row(
    'longueur',
    `~${report.low}–${report.high} tokens (${report.characters} caractères, ${report.words} mots)`,
  );
  row('portée', EXPOSURE_TEXT[report.band]);

  table.append(body);
  scroll.append(table);
  node.append(scroll);
  node.append(
    el(
      'p',
      'note',
      "Cirta ne sait pas lire cette classe de marquage, et aucun outil local ne le peut : il faut la clé secrète de l'éditeur. Le nombre de tokens est estimé, pas tokenisé.",
    ),
  );
  return node;
}

/** Some labels carry the field name, so the prefix is translated rather than the whole. */
const LABEL_PREFIX: Array<[RegExp, string]> = [
  [/^Custom property: /, 'Propriété personnalisée : '],
  [/^User-defined property: /, 'Propriété utilisateur : '],
  [/^Custom info key: /, 'Clé /Info personnalisée : '],
  [/^Credential left in file: /, 'Secret laissé dans le fichier : '],
  [/^Non-standard header: /, 'En-tête non standard : '],
  [/^Relay hop /, 'Relais traversé '],
];

function translateLabel(label: string): string {
  const mapped = FIELD_LABEL[label];
  if (mapped) return mapped;
  for (const [pattern, prefix] of LABEL_PREFIX) {
    if (pattern.test(label)) return label.replace(pattern, prefix);
  }
  return label;
}

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

/** The core marks derived findings with an English prefix naming their source. */
const translateLocation = (location: string) => {
  const mapped = LOCATION_TEXT[location];
  if (mapped) return mapped;
  // Body findings arrive as "part (location)", so the inner half needs it too.
  const nested = /^(.+) \((.+)\)$/.exec(location);
  if (nested?.[2] && LOCATION_TEXT[nested[2]]) return `${nested[1]} (${LOCATION_TEXT[nested[2]]})`;
  // « mail header:x-mailer » : le nom du champ est celui de la norme, il reste
  // tel quel ; seul le mot qui l'introduit est traduit.
  const header = /^mail header:(.+)$/.exec(location);
  if (header) return `en-tête ${header[1]}`;
  return location.replace(/^derived from /, 'dérivé de ');
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

function translateValue(finding: Finding): string {
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

const MIME: Record<Format, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  svg: 'image/svg+xml',
  html: 'text/html',
  markdown: 'text/markdown',
  jpeg: 'image/jpeg',
  png: 'image/png',
  zip: 'application/zip',
  text: 'text/plain',
};

/** Extensions whose bytes alone do not identify the format. */
function formatHint(name: string): string | undefined {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown';
  if (ext === '.svg') return 'svg';
  if (ext === '.html' || ext === '.htm') return 'html';
  return undefined;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

/* ---------------------------------------------------------------- tabs --- */

/**
 * A tablist is one stop in the tab order, not one per tab.
 *
 * That is the roving tabindex the ARIA authoring practices describe: only the
 * selected tab is reachable with Tab, and the arrow keys move between them.
 * Without it, someone navigating by keyboard has to step through every tab to
 * reach the panel, and the arrow keys — which is what they will reach for — do
 * nothing at all.
 */
function setupTabs(): void {
  const tabs = [
    { button: must<HTMLButtonElement>('#tab-files'), panel: must<HTMLElement>('#panel-files') },
    { button: must<HTMLButtonElement>('#tab-text'), panel: must<HTMLElement>('#panel-text') },
  ];

  const select = (index: number, focus = false): void => {
    tabs.forEach((tab, at) => {
      const selected = at === index;
      tab.button.setAttribute('aria-selected', String(selected));
      tab.button.tabIndex = selected ? 0 : -1;
      tab.panel.hidden = !selected;
    });
    if (focus) tabs[index]?.button.focus();
  };

  tabs.forEach(({ button }, index) => {
    button.addEventListener('click', () => select(index));
    button.addEventListener('keydown', (event) => {
      const last = tabs.length - 1;
      const target =
        event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
        : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0
        : event.key === 'End' ? last
        : undefined;
      if (target === undefined) return;
      event.preventDefault();
      select(target, true);
    });
  });

  select(tabs.findIndex((tab) => tab.button.getAttribute('aria-selected') === 'true') || 0);
}

/* ------------------------------------------------------------- rendering -- */

function findingsTable(findings: Finding[]): HTMLElement {
  const scroll = el('div', 'table-scroll');
  const table = el('table');

  const head = el('thead');
  const headRow = el('tr');
  for (const label of ['Niveau', 'Type', 'Champ', 'Valeur', 'Emplacement']) {
    headRow.append(el('th', undefined, label));
  }
  head.append(headRow);

  const body = el('tbody');
  for (const finding of findings) {
    const row = el('tr');
    if (finding.affectsVerifiability) row.className = 'flagged';
    row.append(
      el('td', `confidence confidence-${finding.confidence}`, CONFIDENCE_LABEL[finding.confidence]),
    );
    row.append(el('td', 'kind', KIND_LABEL[finding.kind]));
    row.append(el('td', undefined, translateLabel(finding.label)));
    row.append(el('td', 'value', preview(translateValue(finding), 120)));
    row.append(el('td', 'location', translateLocation(finding.location)));
    body.append(row);
  }

  table.append(head, body);
  scroll.append(table);
  return scroll;
}

/**
 * « Ce fichier a-t-il été produit par une IA, et laquelle ? »
 *
 * Les lignes du tableau le disent déjà, réparties sur jusqu'à cinq d'entre
 * elles. Ce qu'elles ne savent pas faire, c'est répondre quand il n'y a rien :
 * un rapport silencieux se lit comme « pas d'IA », alors que la réponse
 * honnête est plus étroite que ça.
 */
function provenanceBanner(findings: Finding[]): HTMLElement {
  const { tools, attributed, declared, machineAssembled } = provenance(findings);
  const node = el('div', attributed ? 'provenance is-attributed' : 'provenance');

  if (declared) {
    // Une déclaration prime sur une déduction : le fichier l'affirme lui-même,
    // dans le vocabulaire IPTC sur lequel les règles de transparence reposent.
    node.classList.add('is-declared');
    node.append(el('strong', undefined, 'Produit par un modèle génératif — le fichier le déclare'));
    node.append(
      el(
        'span',
        'provenance-caveat',
        tools.length
          ? `Champ digitalSourceType (IPTC). Outils nommés : ${tools.join(' · ')}.`
          : 'Champ digitalSourceType (IPTC).',
      ),
    );
    return node;
  }
  if (attributed) {
    node.append(el('strong', undefined, `Produit par ${tools.join(' · ')}`));
    node.append(
      el(
        'span',
        'provenance-caveat',
        'd’après les métadonnées du fichier lui-même, qui peuvent être absentes, erronées ou falsifiées.',
      ),
    );
    return node;
  }
  if (tools.length) {
    node.append(el('strong', undefined, `Produit par ${tools.join(' · ')}`));
    node.append(
      el(
        'span',
        'provenance-caveat',
        'Le logiciel qui a écrit le fichier. Aucun assistant n’est nommé, ce qui ne veut pas dire qu’il n’y en a pas eu.' +
          (machineAssembled
            ? ' La forme du conteneur le confirme : un programme l’a fabriqué, pas un traitement de texte.'
            : ''),
      ),
    );
    return node;
  }
  if (machineAssembled) {
    node.classList.add('is-attributed');
    node.append(el('strong', undefined, 'Aucun outil nommé, mais un programme a fabriqué ce fichier.'));
    node.append(
      el(
        'span',
        'provenance-caveat',
        'Le conteneur a la forme que laisse une bibliothèque, pas celle d’un traitement de texte. Ce que cela ne dit pas : quel programme, ni si un modèle a écrit les mots.',
      ),
    );
    return node;
  }
  node.append(el('strong', undefined, 'Aucune métadonnée ne nomme d’outil.'));
  node.append(
    el(
      'span',
      'provenance-caveat',
      'Ce n’est pas la même chose que « pas d’IA » : les champs ont pu être vidés, jamais écrits, ou le texte collé à la main — et la formulation elle-même est illisible ici.',
    ),
  );
  return node;
}

function card(title: string, badge?: string, count?: string): HTMLElement {
  const node = el('article', 'card');
  const head = el('div', 'card-head');
  head.append(el('h3', 'card-title', title));
  if (badge) head.append(el('span', 'badge', badge));
  if (count) head.append(el('span', 'count', count));
  node.append(head);
  return node;
}

function appendNotes(node: HTMLElement, notes: Note[]): void {
  for (const note of notes) {
    const warn = note.code === 'removed:c2pa';
    node.append(el('p', warn ? 'note note-warn' : 'note', NOTE_TEXT[note.code](note.detail)));
  }
}

function download(data: Uint8Array, filename: string, mime: string): void {
  // Copy into a fresh ArrayBuffer so the Blob never aliases a detached buffer.
  const blob = new Blob([new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function cleanName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? `${name}.clean` : `${name.slice(0, dot)}.clean${name.slice(dot)}`;
}

/* ----------------------------------------------------------------- files -- */

/**
 * Every file analysed this session, in the order they were dropped.
 *
 * Kept in the same shape the CLI's `--json` emits, so a report exported from
 * the page and one produced by `cirta inspect --json` can be compared or fed to
 * the same script without a translation step.
 */
const session: Array<{ file: string; result?: InspectResult; error?: string }> = [];

/** Tally and export, refreshed after each file resolves. */
function renderSummary(anchor: HTMLElement): void {
  const done = session.filter((entry) => entry.result || entry.error);
  const existing = document.querySelector('#file-summary');
  if (done.length === 0) {
    existing?.remove();
    return;
  }

  const node = el('div', 'summary');
  node.id = 'file-summary';

  const flagged = done.filter((entry) =>
    entry.result?.findings.some((f) => f.confidence === 'confirmed'),
  ).length;
  const failures = done.filter((entry) => entry.error).length;

  const parts = [`${done.length} fichier${done.length > 1 ? 's' : ''}`];
  parts.push(
    flagged
      ? `${flagged} portant des données identifiantes confirmées`
      : 'aucun ne porte de données identifiantes confirmées',
  );
  if (failures) parts.push(`${failures} illisible${failures > 1 ? 's' : ''}`);

  const text = el('p', flagged || failures ? 'summary-text is-flagged' : 'summary-text', parts.join(' · '));
  const button = el('button', 'button button-small', 'Exporter le rapport (JSON)');
  button.addEventListener('click', () => {
    const json = JSON.stringify(done, null, 2);
    download(new TextEncoder().encode(json), 'cirta-rapport.json', 'application/json');
  });

  node.append(text, button);
  if (existing) existing.replaceWith(node);
  else anchor.before(node);
}

async function handleFile(file: File, container: HTMLElement): Promise<void> {
  const node = card(file.name, undefined, 'analyse…');
  node.classList.add('is-busy');
  container.prepend(node);

  // Claimed synchronously so the export keeps the order files were dropped in,
  // not the order the worker happened to finish them.
  const entry: { file: string; result?: InspectResult; error?: string } = { file: file.name };
  session.push(entry);
  const record = (patch: Partial<typeof entry>) => {
    Object.assign(entry, patch);
    renderSummary(container);
  };

  let data: Uint8Array;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch {
    node.append(el('p', 'error', 'Lecture du fichier impossible.'));
    record({ error: 'Lecture du fichier impossible.' });
    return;
  }

  try {
    const result = await inspectFile(data, formatHint(file.name));
    record({ result });
    node.classList.remove('is-busy');
    const count = node.querySelector('.count');
    const badge = el('span', 'badge', result.format);
    node.querySelector('.card-head')?.insertBefore(badge, count);
    if (count) {
      count.textContent = result.findings.length
        ? `${result.findings.length} élément${result.findings.length > 1 ? 's' : ''}`
        : 'aucune métadonnée';
    }

    // Les images et les archives n'ont pas de champ producteur à interroger.
    if (result.format !== 'zip') node.append(provenanceBanner(result.findings));

    if (result.findings.length === 0) {
      node.append(el('p', 'empty', 'Aucune métadonnée identifiante trouvée.'));
    } else {
      node.append(findingsTable(result.findings));

      // A plain archive is reported, never rewritten — redaction throws on it.
      // Offering the button and failing on the click is a promise the page
      // cannot keep, so it says so up front instead.
      if (result.format === 'zip') {
        node.append(
          el(
            'p',
            'note',
            'Archive analysée, pas réécrite. Extrayez-la, nettoyez les fichiers un par un, puis recompressez.',
          ),
        );
      } else {
        const foot = el('div', 'card-foot');
        const button = el('button', 'button button-primary', 'Télécharger la version nettoyée');
        button.addEventListener('click', async () => {
          button.disabled = true;
          button.textContent = 'Nettoyage…';
          try {
            const redacted = await redactFile(data, formatHint(file.name));
            download(redacted.data!, cleanName(file.name), MIME[redacted.format]);
            button.textContent = 'Téléchargé';
            // Redaction surfaces caveats inspection cannot: a dropped C2PA
            // manifest, and — more importantly — what was found and left in
            // place. Dropping those on the floor would make the browser claim
            // more than the CLI does for the same file.
            const fresh = redacted.notes.filter(
              (n) => n.code === 'removed:c2pa' || n.code.startsWith('kept:'),
            );
            if (fresh.length) appendNotes(node, fresh);
          } catch (error) {
            button.textContent = 'Échec du nettoyage';
            node.append(el('p', 'error', error instanceof Error ? error.message : String(error)));
          }
        });
        foot.append(button);
        node.append(foot);
      }
    }

    appendNotes(node, result.notes);
  } catch (error) {
    node.classList.remove('is-busy');
    node.querySelector('.count')?.remove();
    const message = error instanceof Error ? error.message : String(error);
    node.append(el('p', 'error', message));
    record({ error: message });
  }
}

function setupFiles(): void {
  const dropzone = must<HTMLElement>('#dropzone');
  const input = must<HTMLInputElement>('#file-input');
  const results = must<HTMLElement>('#file-results');

  const accept = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) void handleFile(file, results);
  };

  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    accept(input.files);
    input.value = '';
  });

  for (const type of ['dragenter', 'dragover'] as const) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-active');
    });
  }
  for (const type of ['dragleave', 'drop'] as const) {
    dropzone.addEventListener(type, () => dropzone.classList.remove('is-active'));
  }
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    accept(event.dataTransfer?.files ?? null);
  });
}

/* ------------------------------------------------------------------ text -- */

function setupText(): void {
  const input = must<HTMLTextAreaElement>('#text-input');
  const results = must<HTMLElement>('#text-results');
  const scanButton = must<HTMLButtonElement>('#text-scan');
  const cleanButton = must<HTMLButtonElement>('#text-clean');

  const render = (node: HTMLElement) => {
    results.replaceChildren(node);
  };

  const scopeNote: Note[] = [{ code: 'scope:invisible-characters-only' }];

  scanButton.addEventListener('click', () => {
    // La même lecture qu'un fichier reçoit. Le collage restait plus pauvre que
    // l'onglet Fichiers sur des octets identiques : un brouillon d'e-mail
    // enregistré nommait l'assistant, collé ici il ne montrait que ses
    // caractères bizarres.
    const findings = inspectPlainText(input.value);
    const node = card(
      'Analyse',
      undefined,
      findings.length ? `${findings.length} élément${findings.length > 1 ? 's' : ''}` : 'rien trouvé',
    );
    node.append(provenanceBanner(findings));
    if (findings.length === 0) {
      node.append(el('p', 'empty', 'Rien trouvé dans ce texte.'));
    } else {
      node.append(findingsTable(findings));
    }
    appendNotes(node, scopeNote);
    const style = styleCard(input.value);
    results.replaceChildren(node, exposureCard(input.value), ...(style ? [style] : []));
  });

  cleanButton.addEventListener('click', async () => {
    const result = cleanText(input.value);
    // Les en-têtes de courrier qui nomment un outil partent aussi : sur un
    // brouillon généré, X-Mailer est la marque la plus explicite du fichier.
    // Les en-têtes du message lui-même — From, Subject, Message-ID — restent :
    // c'est du contenu, et ils sont signalés comme laissés en place.
    const stripped = stripToolHeaders(result.text);
    input.value = stripped.text;

    const node = card(
      'Nettoyage',
      undefined,
      result.removed.length
        ? `${result.removed.length} type${result.removed.length > 1 ? 's' : ''} retiré${result.removed.length > 1 ? 's' : ''}`
        : 'rien à retirer',
    );
    if (result.removed.length === 0) {
      node.append(el('p', 'empty', 'Le texte ne contenait aucun caractère invisible.'));
    } else {
      node.append(findingsTable(result.removed));
    }
    for (const payload of result.decoded) {
      node.append(el('p', 'decoded', `Charge retirée — ${payload}`));
    }

    // Les lettres sosies font partie d'un mot : le nettoyage ne les touche pas.
    // Sans cette mention, le décompte ci-dessus se lirait comme « c'est propre ».
    if (stripped.removed.length) {
      node.append(
        el(
          'p',
          'note',
          `En-têtes de courrier retirés : ${stripped.removed.join(', ')}. Ils nomment le logiciel, ` +
            'pas le message.',
        ),
      );
    }

    if (result.kept.length) {
      node.append(el('p', 'note note-warn', 'Trouvé mais laissé en place — à vous de trancher :'));
      node.append(findingsTable(result.kept));
    }

    const foot = el('div', 'card-foot');
    const copy = el('button', 'button', 'Copier le texte nettoyé');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(stripped.text);
        copy.textContent = 'Copié';
      } catch {
        input.select();
        copy.textContent = 'Sélectionné — Ctrl+C';
      }
    });
    foot.append(copy);
    node.append(foot);

    appendNotes(node, scopeNote);
    render(node);
  });
}

setupTabs();
setupFiles();
setupText();

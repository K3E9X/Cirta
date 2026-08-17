/**
 * Interface strings in both languages the page offers.
 *
 * The shape of this file follows from where the strings come from. The core
 * library reports in English — field names, note codes, finding values — so
 * that the library reads consistently for anyone using it directly. The page
 * then translates. That means English is not a translation at all: it is the
 * core's own wording passed through untouched, and only French needs a table.
 * Every `translate*` helper in main.ts is written that way, and the lookup
 * tables it consults are French-only by design rather than by omission.
 *
 * What does need saying twice is the page's own chrome: card titles, row
 * labels, buttons, the sentences that explain a measurement. Those live below.
 *
 * `EN` is typed as `typeof FR`, so the compiler refuses a build where the two
 * have drifted — a missing key or a renamed one is an error, not a French
 * string appearing unannounced in an English page.
 */

export type Lang = 'fr' | 'en';

const FR = {
  /* --------------------------------------------------------------- chrome */
  langLabel: 'English',
  langTitle: 'Switch to English',
  placeholder: 'Collez ici le texte à analyser…',

  /* ---------------------------------------------------------------- files */
  analysing: 'analyse…',
  unreadable: 'Lecture du fichier impossible.',
  noMetadata: 'aucune métadonnée',
  nothingIdentifying: 'Aucune métadonnée identifiante trouvée.',
  itemCount: (n: number) => `${n} élément${n > 1 ? 's' : ''}`,
  download: 'Télécharger la version nettoyée',
  downloaded: 'Téléchargé',
  cleanFailed: 'Échec du nettoyage',
  archiveNote:
    'Une archive est signalée, jamais réécrite : la repacker changerait la compression, ' +
    'l’ordre et les dates de chaque membre. Nettoyez les fichiers un par un.',

  /* -------------------------------------------------------------- summary */
  fileCount: (n: number) => `${n} fichier${n > 1 ? 's' : ''}`,
  flaggedCount: (n: number) => `${n} portant des données identifiantes confirmées`,
  noneFlagged: 'aucun ne porte de données identifiantes confirmées',
  failureCount: (n: number) => `${n} illisible${n > 1 ? 's' : ''}`,
  exportReport: 'Exporter le rapport (JSON)',

  /* ---------------------------------------------------------------- table */
  columns: ['Niveau', 'Type', 'Champ', 'Valeur', 'Emplacement'],
  confidence: { confirmed: 'confirmé', probable: 'probable', informational: 'informatif' },
  kinds: {
    identity: 'identité',
    provenance: 'provenance',
    timestamp: 'horodatage',
    environment: 'environnement',
    'invisible-character': 'invisible',
  },

  /* ----------------------------------------------------------- provenance */
  provDeclared: 'Produit par un modèle génératif — le fichier le déclare',
  provDeclaredTools: (tools: string) => `Champ digitalSourceType (IPTC). Outils nommés : ${tools}.`,
  provDeclaredBare: 'Champ digitalSourceType (IPTC).',
  provBy: (tools: string) => `Produit par ${tools}`,
  provAttributedCaveat:
    'd’après les métadonnées du fichier lui-même, qui peuvent être absentes, erronées ou falsifiées.',
  provToolCaveat:
    'Le logiciel qui a écrit le fichier. Aucun assistant n’est nommé, ce qui ne veut pas dire ' +
    'qu’il n’y en a pas eu.',
  provToolShapeAgrees:
    ' La forme du conteneur le confirme : un programme l’a fabriqué, pas un traitement de texte.',
  provMachine: 'Aucun outil nommé, mais un programme a fabriqué ce fichier.',
  provMachineCaveat:
    'Le conteneur a la forme que laisse une bibliothèque, pas celle d’un traitement de texte. ' +
    'Ce que cela ne dit pas : quel programme, ni si un modèle a écrit les mots.',
  provNone: 'Aucune métadonnée ne nomme d’outil.',
  provNoneCaveat:
    'Ce n’est pas la même chose que « pas d’IA » : les champs ont pu être vidés, jamais écrits, ' +
    'ou le texte collé à la main — et la formulation elle-même est illisible ici.',

  /* ---------------------------------------------------------------- style */
  styleTitle: 'Style',
  styleBadge: 'des indices, pas un verdict',
  styleRowShape: 'forme',
  styleShape: (sentences: number, mean: string) => `${sentences} phrases, ${mean} mots en moyenne`,
  styleRowVariation: 'variation',
  styleVariation: (n: string) =>
    `${n} — de combien la longueur des phrases bouge. Les gens varient généralement plus qu’un ` +
    'modèle ; la documentation technique varie moins que les deux.',
  styleRowDashes: 'tirets',
  styleDashes: (n: string) => `${n} cadratins ou demi-cadratins pour 1000 mots`,
  styleRowLeadIns: 'amorces',
  styleLeadIns: (pct: number) => `${pct}% des paragraphes ouvrent sur une phrase en gras`,
  styleRowPhrases: 'tournures',
  styleRowReading: 'lecture',
  styleBands: {
    many:
      'Plusieurs de ces marqueurs sont présents en même temps. C’est à ça que ressemble de la ' +
      'prose générée — et aussi un brouillon d’entreprise écrit vite.',
    several:
      'Quelques-uns sont présents. Pris isolément, chacun a une explication parfaitement innocente.',
    few: 'Peu de ces marqueurs sont présents.',
  },
  styleNote:
    'Ce sont des signaux de style, pas une preuve de paternité. Les gommer change la façon dont ' +
    'le texte se lit, pas son origine. Utile pour relire votre propre brouillon avant de l’envoyer.',

  /* ------------------------------------------------------------- exposure */
  exposureTitle: 'Filigrane statistique',
  exposureBadge: 'aucun verdict local possible',
  exposureRowLength: 'longueur',
  exposureLength: (low: number, high: number, chars: number, words: number) =>
    `~${low}–${high} tokens (${chars} caractères, ${words} mots)`,
  exposureRowReach: 'portée',
  exposureBands: {
    'too-short':
      'À cette longueur, même l’éditeur du modèle n’obtiendrait pas de résultat fiable : ne rien ' +
      'trouver ici ne voudrait presque rien dire.',
    uncertain:
      'Assez long pour qu’un détecteur disposant de la clé ait une certaine puissance, assez ' +
      'court pour que l’issue dépende du schéma et du seuil retenus.',
    ample:
      'Assez long pour que les travaux publiés (Kirchenbauer et al., ICLR 2024) trouvent un signal ' +
      'de filigrane survivant même à une reformulation soutenue, à 1e-5 de faux positifs.',
  },
  exposureRowRoom: 'prise',
  exposureRoom: (lines: number, comments: number, share: number) =>
    `Lu comme du code source : ${lines} lignes non vides, dont ${comments} de commentaire ` +
    `(${share} %). Anthropic indique que le code porte moins de filigrane parce qu’il doit être ` +
    'exact ; la marque vit là où le choix est libre — ' +
    (comments > 0
      ? 'ici surtout dans ces lignes de commentaire.'
      : 'et ce fichier n’en laisse presque aucun.'),
  exposureRowStatus: 'où en est-on',
  exposureStatus:
    'Anthropic indique que les futurs modèles Claude portent un filigrane — une version de ' +
    'SynthID-Text (DeepMind) — au titre du code de transparence européen en vigueur depuis le ' +
    '2 août 2026 ; les modèles antérieurs suivront dans les mois à venir. Une API de détection ' +
    'est annoncée mais pas publiée, et lire la marque suppose leur clé. Les fichiers reçoivent ' +
    'à la place un « content credential » C2PA signé — celui-là, Cirta le lit et le signale.',
  exposureRowNotThis: 'ce n’est pas ça',
  exposureNotThis:
    '« Rien n’est ajouté au texte et il n’y a aucun caractère caché. » Le filigrane statistique ' +
    'n’est pas de l’Unicode invisible. Les codepoints invisibles trouvés ci-dessus relèvent d’un ' +
    'autre mécanisme, mis là par quelqu’un d’autre — et les retirer tous ne touche pas au ' +
    'filigrane. La marque ne contient par ailleurs aucune information identifiante : ni ' +
    'personne, ni organisation, ni conversation.',
  exposureRowCareful: 'attention',
  exposureCareful:
    'Au mieux, elle répond à « quelle est la probabilité que Claude soit intervenu ? ». Pas si un ' +
    'humain a écrit le texte, pas si un autre modèle l’a écrit — un autre éditeur aurait une ' +
    'autre clé. Et elle ne distingue pas « Claude a écrit ça » de « Claude a beaucoup remanié ' +
    'ça » : une simple relecture ne lui laisse presque aucune prise.',
  exposureNote:
    'Cirta ne sait pas lire cette classe de marquage, et aucun outil local ne le peut : il faut ' +
    'la clé secrète de l’éditeur. Le nombre de tokens est estimé, pas tokenisé.',

  /* ----------------------------------------------------------------- text */
  textNothing: 'Rien trouvé dans ce texte.',
  textNoInvisible: 'Le texte ne contenait aucun caractère invisible.',
  textFound: 'rien trouvé',
  cleanTitle: 'Nettoyage',
  scanTitle: 'Analyse',
  removedCount: (n: number) => `${n} type${n > 1 ? 's' : ''} retiré${n > 1 ? 's' : ''}`,
  nothingToRemove: 'rien à retirer',
  payloadRemoved: (payload: string) => `Charge retirée — ${payload}`,
  headersRemoved: (names: string) =>
    `En-têtes de courrier retirés : ${names}. Ils nomment le logiciel, pas le message.`,
  keptWarning: 'Trouvé mais laissé en place — à vous de trancher :',
  copyCleaned: 'Copier le texte nettoyé',
  copied: 'Copié',
  selected: 'Sélectionné — Ctrl+C',
} as const;

type Strings = {
  -readonly [K in keyof typeof FR]: (typeof FR)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : (typeof FR)[K] extends readonly string[]
      ? string[]
      : (typeof FR)[K] extends Record<string, string>
        ? Record<keyof (typeof FR)[K], string>
        : string;
};

const EN: Strings = {
  langLabel: 'Français',
  langTitle: 'Passer en français',
  placeholder: 'Paste the text to analyse here…',

  analysing: 'analysing…',
  unreadable: 'This file could not be read.',
  noMetadata: 'no metadata',
  nothingIdentifying: 'No identifying metadata found.',
  itemCount: (n) => `${n} item${n > 1 ? 's' : ''}`,
  download: 'Download the cleaned copy',
  downloaded: 'Downloaded',
  cleanFailed: 'Cleaning failed',
  archiveNote:
    'An archive is reported, never rewritten: repacking would change the compression, ordering ' +
    'and timestamps of every member. Clean the files individually.',

  fileCount: (n) => `${n} file${n > 1 ? 's' : ''}`,
  flaggedCount: (n) => `${n} carrying confirmed identifying data`,
  noneFlagged: 'none carries confirmed identifying data',
  failureCount: (n) => `${n} unreadable`,
  exportReport: 'Export the report (JSON)',

  columns: ['Level', 'Kind', 'Field', 'Value', 'Location'],
  confidence: { confirmed: 'confirmed', probable: 'probable', informational: 'informational' },
  kinds: {
    identity: 'identity',
    provenance: 'provenance',
    timestamp: 'timestamp',
    environment: 'environment',
    'invisible-character': 'invisible',
  },

  provDeclared: 'Made by a generative model — the file declares it',
  provDeclaredTools: (tools) => `digitalSourceType field (IPTC). Tools named: ${tools}.`,
  provDeclaredBare: 'digitalSourceType field (IPTC).',
  provBy: (tools) => `Produced by ${tools}`,
  provAttributedCaveat:
    'according to the file’s own metadata, which can be absent, wrong or forged.',
  provToolCaveat:
    'The software that wrote the file. Nothing names an assistant, which is not the same as ' +
    'there having been none.',
  provToolShapeAgrees:
    ' The container’s shape agrees: a program built it, not a word processor.',
  provMachine: 'No tool is named, but a program assembled this file.',
  provMachineCaveat:
    'The container has the shape a library leaves, not the one a word processor does. What it ' +
    'does not say is which program, or whether a model wrote the words.',
  provNone: 'Nothing in the metadata names a tool.',
  provNoneCaveat:
    'That is not the same as “not AI”: the fields may have been cleared, never written, or the ' +
    'text pasted in by hand — and the wording itself cannot be read here at all.',

  styleTitle: 'Style',
  styleBadge: 'indicators, not a verdict',
  styleRowShape: 'shape',
  styleShape: (sentences, mean) => `${sentences} sentences, ${mean} words on average`,
  styleRowVariation: 'variation',
  styleVariation: (n) =>
    `${n} — how much sentence length moves. People usually vary more than a model does; ` +
    'technical documentation varies less than either.',
  styleRowDashes: 'dashes',
  styleDashes: (n) => `${n} em or en dashes per 1000 words`,
  styleRowLeadIns: 'lead-ins',
  styleLeadIns: (pct) => `${pct}% of paragraphs open with a bolded lead-in`,
  styleRowPhrases: 'phrases',
  styleRowReading: 'reading',
  styleBands: {
    many:
      'Several of these are present at once. This is what generated prose looks like — and also ' +
      'a corporate draft written in a hurry.',
    several: 'A few are present. Individually every one of them has an innocent explanation.',
    few: 'Few of these markers are present.',
  },
  styleNote:
    'These are style signals, not evidence of authorship. Editing them away changes how the text ' +
    'reads, not where it came from. Useful for reading your own draft before you send it.',

  exposureTitle: 'Statistical watermark',
  exposureBadge: 'no local verdict is possible',
  exposureRowLength: 'length',
  exposureLength: (low, high, chars, words) =>
    `~${low}–${high} tokens (${chars} characters, ${words} words)`,
  exposureRowReach: 'reach',
  exposureBands: {
    'too-short':
      'At this length even the vendor may not get a reliable result; finding nothing here would ' +
      'mean almost nothing.',
    uncertain:
      'Long enough for a keyed detector to have some power, short enough that the outcome depends ' +
      'on the scheme and the threshold chosen.',
    ample:
      'Long enough that published work (Kirchenbauer et al., ICLR 2024) found watermark signal ' +
      'surviving even sustained paraphrasing at a 1e-5 false-positive rate.',
  },
  exposureRowRoom: 'room',
  exposureRoom: (lines, comments, share) =>
    `Reads as source: ${lines} non-blank lines, ${comments} of them comment (${share}%). ` +
    'Anthropic states code carries less watermarking because it has to be exact; the mark lives ' +
    'where a choice is free — ' +
    (comments > 0
      ? 'here mostly in those comment lines.'
      : 'and this file leaves almost none of that.'),
  exposureRowStatus: 'status',
  exposureStatus:
    'Anthropic states that future Claude models carry a watermark — a version of DeepMind’s ' +
    'SynthID-Text — under the EU transparency code in force since 2 August 2026; earlier models ' +
    'follow over the coming months. A detection API is announced but not published, and reading ' +
    'the mark needs their key. Files instead get a signed C2PA content credential, which Cirta ' +
    'does read and report.',
  exposureRowNotThis: 'not this',
  exposureNotThis:
    '“Nothing is added to the text and there are no hidden characters.” A statistical watermark ' +
    'is not invisible Unicode. The invisible codepoints found above are a different mechanism, ' +
    'put there by someone else — and removing all of them leaves the watermark untouched. The ' +
    'mark also carries no identifying information: not a person, an organisation or a chat.',
  exposureRowCareful: 'careful',
  exposureCareful:
    'At best it answers “how likely is it that Claude was involved?”. Not whether a person wrote ' +
    'the text, and not whether some other model did — another vendor would have another key. And ' +
    'it cannot separate “Claude wrote this” from “Claude heavily edited this”: a light proofread ' +
    'leaves it almost nothing to hold on to.',
  exposureNote:
    'Cirta cannot read this class of mark, and neither can any other local tool: it needs the ' +
    'vendor’s secret key. Token counts are estimated, not tokenized.',

  textNothing: 'Nothing found in this text.',
  textNoInvisible: 'The text contained no invisible characters.',
  textFound: 'nothing found',
  cleanTitle: 'Cleaning',
  scanTitle: 'Analysis',
  removedCount: (n) => `${n} kind${n > 1 ? 's' : ''} removed`,
  nothingToRemove: 'nothing to remove',
  payloadRemoved: (payload) => `Payload removed — ${payload}`,
  headersRemoved: (names) =>
    `Mail headers removed: ${names}. They name the software, not the message.`,
  keptWarning: 'Found but left in place — your call:',
  copyCleaned: 'Copy the cleaned text',
  copied: 'Copied',
  selected: 'Selected — Ctrl+C',
};

const STORAGE_KEY = 'cirta:lang';

/**
 * French unless the visitor's browser says otherwise, and their explicit choice
 * beats both. The page is authored in French and the tool was built for French
 * documents, so an unrecognised locale lands there rather than on English.
 */
function detect(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'fr' || stored === 'en') return stored;
  } catch {
    // Private mode, or storage disabled. The default is still correct.
  }
  return navigator.language?.toLowerCase().startsWith('fr') === false ? 'en' : 'fr';
}

let current: Lang = detect();

export const lang = (): Lang => current;

export function setLang(next: Lang): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not being able to remember the choice does not stop it applying now.
  }
  document.documentElement.lang = next;
  document.documentElement.dataset['uiLang'] = next;
}

/** The active string table. Called per use so a language switch takes effect. */
export const t = (): Strings => (current === 'fr' ? (FR as unknown as Strings) : EN);

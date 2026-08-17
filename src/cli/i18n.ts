/**
 * What the command line says, in both languages.
 *
 * Same arrangement as the web interface: the core reports in English, so
 * English is the core's own wording and only French needs writing out. The
 * shared tables in `src/shared/french.ts` translate the findings themselves;
 * what lives here is the command line's own prose — the headings, the sentences
 * that explain a measurement, the errors.
 *
 * `EN` is typed as the shape of `FR`, so the two cannot drift: a key added to
 * one and not the other fails the build.
 *
 * Language is taken from the environment the way every other Unix tool takes
 * it, `LC_ALL` then `LANG`, and `--lang` overrides. A French locale gets French
 * output; anything else, including an unset locale, gets English. That default
 * is the opposite of the web page's, and deliberately: a terminal on an
 * unconfigured server is not a person who chose a language.
 */

import type { Lang } from '../shared/french.js';

const FR = {
  usage: 'Utilisation',
  usageInspect: 'Signale les métadonnées portées par chaque fichier',
  usageRedact: 'Écrit une copie sans ces métadonnées',
  usageText: 'Lit du texte sur l’entrée standard ; le signale ou le nettoie',
  paths:
    'Les chemins peuvent être des fichiers ou des répertoires. Les répertoires sont parcourus\n' +
    'récursivement ; les répertoires de construction et de dépendances comme node_modules,\n' +
    '.git et dist sont ignorés.',
  options: 'Options',
  optOutput: 'Destination d’un fichier nettoyé unique',
  optInPlace: 'Remplace les fichiers d’entrée (conserve un .bak)',
  optSkip: 'Répertoires supplémentaires à ignorer, séparés par des virgules',
  optForceText: 'Traite l’entrée comme du texte même si elle semble binaire',
  optLang: 'Langue de sortie (défaut : la locale, sinon en)',
  optJson: 'Sortie exploitable par un programme',
  optHelp: 'Affiche ce message',
  confidenceTitle: 'Niveaux',
  confConfirmed: 'Donnée identifiante littérale — un nom, une société, un chemin local',
  confProbable: 'Information réelle sur vous ou votre travail, pas toujours sensible',
  confInformational: 'Nomme le logiciel plutôt que l’auteur',
  scopeTitle: 'Portée',
  scopeBody:
    'Traite les métadonnées de documents (PDF /Info et XMP, docProps Office) et l’Unicode\n' +
    '  invisible dans le texte. Ne détecte ni ne retire les filigranes statistiques : ceux-là\n' +
    '  vivent dans le choix des mots, pas dans un champ, et les lire exige la clé secrète de\n' +
    '  l’éditeur. Aucun outil local n’en est capable, celui-ci compris.',
  tagline: 'inspecte et retire les métadonnées de provenance des documents',
  taglineLocal: 'tout s’exécute localement ; aucun appel réseau n’est fait',

  confidence: { confirmed: 'confirmé', probable: 'probable', informational: 'informatif' },
  kinds: {
    identity: 'identité',
    provenance: 'provenance',
    timestamp: 'horodatage',
    environment: 'environnement',
    'invisible-character': 'invisible',
  },
  noMetadata: 'Aucune métadonnée trouvée.',
  noSupported: (path: string) => `${path} : aucun fichier pris en charge`,
  needFiles: (cmd: string) => `${cmd} exige au moins un fichier ou un répertoire.`,
  outputSingle: '--output n’accepte qu’un seul fichier d’entrée ; utilisez --in-place pour plusieurs.',
  unknownCommand: (cmd: string) => `Commande inconnue : ${cmd}`,
  unknownOption: (opt: string) => `Option inconnue : ${opt}`,
  binaryReasons: {
    signature: 'l’entrée ressemble à un fichier binaire, pas à du texte',
    'nul-bytes': 'l’entrée contient des octets NUL : ce n’est pas du texte',
    'control-dense': 'l’entrée est dense en octets de contrôle : ce n’est pas du texte',
    'not-utf8': 'l’entrée n’est pas de l’UTF-8 valide',
  },
  binaryRefused:
    'Nettoyer un document comme s’il s’agissait de texte le corrompt. Utilisez plutôt\n' +
    '`cirta redact <fichier>`, ou passez --force-text si vous êtes certain que ces octets\n' +
    'sont du texte.',
  removedTypes: (n: number) => `\ncirta : ${n} type(s) de caractère invisible retiré(s)`,
  nothingRemoved: '\ncirta : rien à retirer',
  leftInPlace: (label: string, value: string) => `cirta : laissé en place — ${label} : ${value}`,

  producedBy: 'Produit par',
  provDeclared: 'un modèle génératif — le fichier le déclare',
  provAttributedCaveat:
    'd’après les métadonnées du fichier lui-même, qui peuvent être absentes, erronées ou falsifiées',
  provToolCaveat: '— le logiciel qui a écrit le fichier ; rien ne nomme d’assistant',
  provShapeAgrees:
    'la forme du conteneur le confirme : un programme l’a fabriqué, pas un traitement de texte.',
  provMachine: 'aucun outil nommé, mais un programme a fabriqué ce fichier',
  provMachineCaveat:
    'Le conteneur a la forme que laisse une bibliothèque, pas celle d’un traitement de texte. ' +
    'Ce que cela ne dit pas : quel programme, ni si un modèle a écrit les mots.',
  provNone: 'aucune métadonnée ne nomme d’outil. Ce n’est pas la même chose que « pas d’IA » :',
  provNoneCaveat:
    'les champs ont pu être vidés, jamais écrits, ou le texte collé à la main — et la ' +
    'formulation elle-même est illisible ici.',

  styleTitle: 'Style',
  styleBadge: 'des indices, pas un verdict',
  styleRowShape: 'forme',
  styleShape: (s: number, m: string) => `${s} phrases, ${m} mots en moyenne`,
  styleRowVariation: 'variation',
  styleVariation: (n: string) =>
    `${n} — de combien la longueur des phrases bouge ; les gens varient généralement plus ` +
    'qu’un modèle, et la documentation moins que les deux',
  styleRowDashes: 'tirets',
  styleDashes: (n: string) => `${n} cadratins ou demi-cadratins pour 1000 mots`,
  styleRowLeadIns: 'amorces',
  styleLeadIns: (p: number) => `${p}% des paragraphes ouvrent sur une phrase en gras`,
  styleRowPhrases: 'tournures',
  stylePhrases: (n: number) => `${n} des tournures que les assistants surexploitent :`,
  styleMore: (n: number) => `et ${n} de plus`,
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
    'le texte se lit, pas son origine.',

  exposureTitle: 'Filigrane statistique',
  exposureBadge: 'aucun verdict local possible',
  exposureRowLength: 'longueur',
  exposureLength: (low: number, high: number, chars: number, words: number) =>
    `~${low}-${high} tokens (${chars} caractères, ${words} mots)`,
  exposureRowMeaning: 'portée',
  exposureBands: {
    'too-short':
      'À cette longueur, même l’éditeur du modèle n’obtiendrait pas de résultat fiable : ne rien ' +
      'trouver ici ne voudrait presque rien dire.',
    uncertain:
      'Assez long pour qu’un détecteur disposant de la clé ait une certaine puissance, assez ' +
      'court pour que l’issue dépende du schéma et du seuil retenus.',
    ample:
      'Assez long pour que les travaux publiés (Kirchenbauer et al., ICLR 2024) trouvent un ' +
      'signal survivant même à une reformulation soutenue, à 1e-5 de faux positifs.',
  },
  exposureRowRoom: 'prise',
  exposureRoom: (lines: number, comments: number, share: number) =>
    `Lu comme du code source : ${lines} lignes non vides, dont ${comments} de commentaire ` +
    `(${share} %). Anthropic indique que le code porte moins de filigrane parce qu’il doit ` +
    'être exact ; la marque vit là où le choix est libre — ' +
    (comments > 0
      ? 'ici surtout dans ces lignes de commentaire.'
      : 'et ce fichier n’en laisse presque aucun.'),
  exposureRowStatus: 'situation',
  exposureStatus:
    'Anthropic indique que les futurs modèles Claude portent un filigrane — une version de ' +
    'SynthID-Text (DeepMind) — au titre du code de transparence européen en vigueur depuis le ' +
    '2 août 2026 ; les modèles antérieurs suivront dans les mois à venir. Une API de détection ' +
    'est annoncée mais pas publiée, et lire la marque suppose leur clé. Les fichiers reçoivent ' +
    'à la place un « content credential » C2PA signé, que cet outil lit et signale.',
  exposureRowNotThis: 'pas ça',
  exposureNotThis:
    '« Rien n’est ajouté au texte et il n’y a aucun caractère caché. » Les codepoints ' +
    'invisibles trouvés ci-dessus relèvent d’un autre mécanisme, mis là par quelqu’un ' +
    'd’autre ; les retirer tous ne touche pas au filigrane. La marque ne contient par ' +
    'ailleurs aucune information identifiante.',
  exposureRowCareful: 'attention',
  exposureCareful:
    'Au mieux, elle répond à « quelle est la probabilité que Claude soit intervenu ? ». Pas si ' +
    'un humain a écrit le texte, pas si un autre modèle l’a écrit. Et elle ne distingue pas ' +
    '« Claude a écrit ça » de « Claude a beaucoup remanié ça » : une simple relecture ne lui ' +
    'laisse presque aucune prise.',
  exposureNote:
    'Cirta ne sait pas lire cette classe de marquage, et aucun outil local ne le peut. Le ' +
    'nombre de tokens est estimé, pas tokenisé.',
} as const;

type Strings = {
  -readonly [K in keyof typeof FR]: (typeof FR)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : (typeof FR)[K] extends Record<string, string>
      ? Record<keyof (typeof FR)[K], string>
      : string;
};

const EN: Strings = {
  usage: 'Usage',
  usageInspect: 'Report metadata carried by each file',
  usageRedact: 'Write a copy with that metadata removed',
  usageText: 'Read text on stdin; report or clean it',
  paths:
    'Paths may be files or directories. Directories are walked recursively for\n' +
    'documents, images and text files; build and dependency directories such as\n' +
    'node_modules, .git and dist are skipped.',
  options: 'Options',
  optOutput: 'Destination for a single redacted file',
  optInPlace: 'Overwrite the input files (keeps a .bak)',
  optSkip: 'Extra directory names to skip, comma-separated',
  optForceText: 'Treat the input as text even if it looks binary',
  optLang: 'Output language (default: the locale, else en)',
  optJson: 'Machine-readable output',
  optHelp: 'Show this message',
  confidenceTitle: 'Confidence',
  confConfirmed: 'Verbatim identifying data — a name, a company, a local path',
  confProbable: 'Real information about you or your workflow, not always sensitive',
  confInformational: 'Names the software rather than the author',
  scopeTitle: 'Scope',
  scopeBody:
    'Handles document metadata (PDF /Info and XMP, Office docProps) and invisible\n' +
    '  Unicode in text. It does not detect or remove statistical model watermarks:\n' +
    '  those live in word choice, not in a field, and reading one requires the\n' +
    "  vendor's secret key. No local tool can do it, including this one.",
  tagline: 'inspect and strip provenance metadata from documents',
  taglineLocal: 'everything runs locally; no network calls are made',

  confidence: { confirmed: 'confirmed', probable: 'probable', informational: 'informational' },
  kinds: {
    identity: 'identity',
    provenance: 'provenance',
    timestamp: 'timestamp',
    environment: 'environment',
    'invisible-character': 'invisible',
  },
  noMetadata: 'No metadata found.',
  noSupported: (path) => `${path}: no supported files found`,
  needFiles: (cmd) => `${cmd} needs at least one file or directory.`,
  outputSingle: '--output takes a single input file; use --in-place for several.',
  unknownCommand: (cmd) => `Unknown command: ${cmd}`,
  unknownOption: (opt) => `Unknown option: ${opt}`,
  binaryReasons: {
    signature: 'the input looks like a binary file, not text',
    'nul-bytes': 'the input contains NUL bytes, so it is not text',
    'control-dense': 'the input is dense in control bytes, so it is not text',
    'not-utf8': 'the input is not valid UTF-8',
  },
  binaryRefused:
    'Cleaning a document as if it were text corrupts it. Use `cirta redact <file>` instead,\n' +
    'or pass --force-text if you are certain these bytes are text.',
  removedTypes: (n) => `\ncirta: removed ${n} invisible character type(s)`,
  nothingRemoved: '\ncirta: nothing to remove',
  leftInPlace: (label, value) => `cirta: left in place — ${label}: ${value}`,

  producedBy: 'Produced by',
  provDeclared: 'a generative model — the file declares it',
  provAttributedCaveat:
    "according to the file's own metadata, which can be absent, wrong or forged",
  provToolCaveat: '— the software that wrote the file; nothing names an assistant',
  provShapeAgrees:
    "the container's shape agrees: a program built it, not a word processor.",
  provMachine: 'no tool is named, but a program assembled this file',
  provMachineCaveat:
    'The container has the shape a library leaves, not the one a word processor does. What it ' +
    'does not say is which program, or whether a model wrote the words.',
  provNone: 'nothing in the metadata names a tool. That is not the same as "not AI":',
  provNoneCaveat:
    'the fields may have been cleared, never written, or the text pasted in by hand, and the ' +
    'wording itself cannot be read here at all.',

  styleTitle: 'Style',
  styleBadge: 'indicators, not a verdict',
  styleRowShape: 'shape',
  styleShape: (s, m) => `${s} sentences, ${m} words on average`,
  styleRowVariation: 'variation',
  styleVariation: (n) =>
    `${n} — how much sentence length moves; people usually vary more than models, ` +
    'and documentation varies less than either',
  styleRowDashes: 'dashes',
  styleDashes: (n) => `${n} em/en dashes per 1000 words`,
  styleRowLeadIns: 'lead-ins',
  styleLeadIns: (p) => `${p}% of paragraphs open with a bold phrase`,
  styleRowPhrases: 'phrases',
  stylePhrases: (n) => `${n} of the turns of phrase assistants overuse:`,
  styleMore: (n) => `and ${n} more`,
  styleRowReading: 'reading',
  styleBands: {
    many:
      'Several of these are present at once. This is what generated prose looks like — and also ' +
      'a corporate draft written in a hurry.',
    several: 'A few are present. Individually every one of them has an innocent explanation.',
    few: 'Few of these markers are present.',
  },
  styleNote:
    'These are style signals, not evidence of authorship. Editing them away changes how the ' +
    'text reads, not where it came from.',

  exposureTitle: 'Statistical watermark',
  exposureBadge: 'no local verdict is possible',
  exposureRowLength: 'length',
  exposureLength: (low, high, chars, words) =>
    `~${low}-${high} tokens (${chars} characters, ${words} words)`,
  exposureRowMeaning: 'meaning',
  exposureBands: {
    'too-short':
      'At this length even the vendor may not get a reliable result; finding nothing here would ' +
      'mean almost nothing.',
    uncertain:
      'Long enough for a keyed detector to have some power, short enough that the outcome ' +
      'depends on the scheme and the threshold chosen.',
    ample:
      'Long enough that published work (Kirchenbauer et al., ICLR 2024) found watermark signal ' +
      'surviving even sustained paraphrasing at a 1e-5 false-positive rate.',
  },
  exposureRowRoom: 'room',
  exposureRoom: (lines, comments, share) =>
    `Reads as source: ${lines} non-blank lines, ${comments} of them comment (${share}%). ` +
    'Anthropic states code carries less watermarking because it has to be exact; the mark ' +
    'lives where a choice is free — ' +
    (comments > 0
      ? 'here mostly in those comment lines.'
      : 'and this file leaves almost none of that.'),
  exposureRowStatus: 'status',
  exposureStatus:
    'Anthropic states that future Claude models carry a watermark — a version of DeepMind’s ' +
    'SynthID-Text — under the EU transparency code in force since 2 August 2026; earlier ' +
    'models follow over the coming months. A detection API is announced but not published, and ' +
    'reading the mark needs their key. Files instead get a signed C2PA content credential, ' +
    'which this tool does read and report.',
  exposureRowNotThis: 'not this',
  exposureNotThis:
    '"Nothing is added to the text and there are no hidden characters." The invisible ' +
    'codepoints found above are a different mechanism, put there by someone else; removing ' +
    'them leaves the watermark untouched. The mark also carries no identifying information.',
  exposureRowCareful: 'careful',
  exposureCareful:
    'At best it answers how likely Claude was involved — not whether a person wrote it, and ' +
    'not whether some other model did. It cannot separate "Claude wrote this" from "Claude ' +
    'heavily edited this"; light proofreading leaves it almost nothing.',
  exposureNote:
    'Cirta cannot read this class of mark, and neither can any other local tool. Token counts ' +
    'are estimated, not tokenized.',
};

/**
 * English unless the locale says French. A terminal with no locale set is a
 * server or a CI runner, not somebody expressing a preference, and the library
 * this wraps speaks English.
 */
export function detectLang(env: NodeJS.ProcessEnv): Lang {
  const locale = env['LC_ALL'] ?? env['LC_MESSAGES'] ?? env['LANG'] ?? '';
  return /^fr/i.test(locale) ? 'fr' : 'en';
}

let current: Lang = 'en';

export const lang = (): Lang => current;
export const setLang = (next: Lang): void => {
  current = next;
};

export const t = (): Strings => (current === 'fr' ? (FR as unknown as Strings) : EN);

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
  usageVerify: 'Ré-inspecte ; sort en erreur s’il reste un constat à ce niveau (confirmed par défaut)',
  usageSanitize: 'Le texte tel qu’un lecteur le voit, pour un modèle ; les consignes cachées sur stderr',
  usageMcp: 'Serveur MCP local (stdio) : inspect_file, redact_file, sanitize_for_llm, scan_text',
  usageServe: 'Service ICAP (proxy, passerelle mail) et API HTTP ; inspection seule par défaut',
  optHost: 'serve : adresse d’écoute (127.0.0.1 par défaut ; 0.0.0.0 pour toutes)',
  optHttpPort: 'serve : port de l’API HTTP (8080 par défaut ; off pour aucune)',
  optIcapPort: 'serve : port ICAP (1344 par défaut ; off pour aucun)',
  optBlockOn: 'serve : remplace un fichier qui porte un constat à ce niveau par une page 403',
  optAllowClean: 'serve : ouvre POST /clean (fermé par défaut)',
  optMaxSize: 'serve : taille maximale inspectée, en Mo (50 par défaut)',
  serveListening: (what: string, where: string) => `${what} : ${where}`,
  serveModeInspect: 'Inspection seule : tout passe, les constats vont dans les en-têtes X-Cirta-* et le journal (stdout).',
  serveModeBlock: (level: string) => `Blocage : un fichier qui porte un constat ${level} ou plus est remplacé par une page 403.`,
  serveModeClean: 'POST /clean est ouvert.',
  serveStopped: 'Arrêté.',
  serveBadPort: (value: string) => `Port invalide : ${value} (un nombre de 0 à 65535, ou off)`,
  serveBadSize: (value: string) => `Taille invalide : ${value} (un nombre de mégaoctets)`,
  serveNothing: 'Ni HTTP ni ICAP : rien à servir.',
  serveUnnamed: '(sans nom)',
  serveBlocked: (level: string) => `Cirta a bloqué ce fichier : il porte au moins un constat de niveau ${level}. Ce qu’il porte, par fichier (les valeurs ne sont pas reproduites) :`,
  serveNotFound: 'Introuvable : /health, /inspect, /clean',
  serveMethod: 'Méthode non prise en charge ici',
  serveCleanDisabled: 'Le nettoyage n’est pas ouvert sur ce service : lancez-le avec --allow-clean.',
  serveTooLarge: (mb: number) => `Trop volumineux : au-delà de ${mb} Mo, rien n’est inspecté (--max-size).`,
  sanitizeHidden: (n: number) => `cirta : ${n} passage${n > 1 ? 's' : ''} caché${n > 1 ? 's' : ''} laissé${n > 1 ? 's' : ''} hors du texte`,
  sanitizeInstruction: (where: string, text: string) => `cirta : consigne cachée destinée à une IA (${where}) — ${text}`,
  verifyPass: 'CONFORME',
  verifyFail: 'ÉCHEC',
  verifyNothing: (level: string) => `aucun constat ${level} ou au-dessus`,
  verifyLeft: (n: number, level: string) => `${n} constat${n > 1 ? 's' : ''} ${level} ou au-dessus reste${n > 1 ? 'nt' : ''} :`,
  confidenceName: { confirmed: 'confirmé', probable: 'probable', informational: 'informatif' },
  paths:
    'Les chemins peuvent être des fichiers ou des répertoires. Les répertoires sont parcourus\n' +
    'récursivement ; les répertoires de construction et de dépendances comme node_modules,\n' +
    '.git et dist sont ignorés.',
  options: 'Options',
  optOutput: 'Destination d’un fichier nettoyé unique',
  optInPlace: 'Remplace les fichiers d’entrée (conserve un .bak)',
  optSkip: 'Répertoires supplémentaires à ignorer, séparés par des virgules',
  optForceText: 'Traite l’entrée comme du texte même si elle semble binaire',
  optRemoveHidden: 'redact : retire aussi le texte qu’un lecteur ne voit pas (Word, PowerPoint, HTML, Markdown)',
  removeHiddenHint: 'Le texte caché est resté. Relancez avec --remove-hidden pour le retirer de la copie.',
  optAcceptChanges: 'redact : accepte toutes les modifications suivies d’un DOCX (le texte supprimé quitte le fichier)',
  acceptChangesHint: 'Les modifications suivies sont restées, texte supprimé compris. Relancez avec --accept-changes pour les accepter.',
  optRemoveComments: 'redact : retire tous les commentaires (Word, Excel, PowerPoint) — texte, auteurs, fils',
  optNormalizeSpaces: 'text --clean : remplace aussi les espaces insécables et fines par des espaces ordinaires',
  optStripActive: 'redact : retire scripts, actions, macros, modèles distants et fichiers intégrés',
  optPii: 'cherche aussi les données personnelles dans le texte (e-mails, téléphones, IBAN, cartes, NIR…), valeurs masquées',
  optRules: 'règles de l’organisation (YAML ou JSON) : mots et motifs, chacun avec son libellé et son niveau',
  stripActiveHint: 'Des scripts, actions, macros ou fichiers intégrés sont restés. Relancez avec --strip-active pour les retirer.',
  optStripRemote: 'redact : retire images, styles, scripts et cadres chargés depuis le réseau, pixels de suivi compris (HTML, Markdown)',
  stripRemoteHint: 'Des ressources chargées depuis le réseau sont restées. Relancez avec --strip-remote-resources pour les retirer.',
  optRemoveNotes: 'redact : retire les notes du présentateur (PowerPoint)',
  optClearOutputs: 'redact : vide les sorties et les compteurs d’exécution (notebook Jupyter)',
  optReencodeImages: 'redact : reconstruit les JPEG et PNG à partir de leurs pixels (orientation appliquée, profil ICC gardé)',
  optManifest: 'redact : écrit un manifeste (SHA-256 et taille avant/après, constats par libellé, options, version)',
  manifestWritten: (path: string, n: number) => `Manifeste écrit : ${path} (${n} fichier${n > 1 ? 's' : ''})`,
  optReport: 'inspect : écrit le rapport en page HTML (.html) ou en Markdown (.md), valeurs comprises',
  reportWritten: (path: string, n: number) => `Rapport écrit : ${path} (${n} fichier${n > 1 ? 's' : ''})`,
  reportFormat: (path: string) => `--report attend un fichier .html ou .md : ${path}`,
  optRemoveHiddenSlides: 'redact : retire les diapositives masquées et leurs notes (PowerPoint)',
  optRemoveHiddenSheets: 'redact : retire les feuilles masquées que rien ne lit (Excel ; refusé sinon)',
  optRemoveAttachments: 'redact : retire les fichiers intégrés (PDF)',
  optFlattenAnnotations: 'redact : dessine les annotations dans la page puis les retire, auteurs compris (PDF)',
  optStripTracking: 'redact : retire utm_*, fbclid, gclid… des liens (HTML, Markdown, Office, PDF)',
  optBurnRedactions: 'redact : supprime pour de bon le texte recouvert par une forme ; la page concernée devient une image (PDF)',
  removeCommentsHint: 'Le texte des commentaires est resté (leurs auteurs sont anonymisés). Relancez avec --remove-comments pour les retirer.',
  aimedAlert: (n: number) =>
    n > 1
      ? `${n} consignes cachées destinées à une IA — invisibles pour un lecteur, lues comme des ordres par un assistant`
      : 'Consigne cachée destinée à une IA — invisible pour un lecteur, lue comme un ordre par un assistant',
  optLang: 'Langue de sortie (défaut : la locale, sinon en)',
  optJson: 'Sortie exploitable par un programme',
  optSarif: 'Sortie SARIF 2.1.0, lue par GitHub Code Scanning et les IDE',
  optFailOn: 'Sort en erreur si un constat atteint ce niveau (confirmed|probable|informational)',
  unknownLevel: (level: string) =>
    `Niveau inconnu : ${level}. Attendu : confirmed, probable ou informational.`,
  optHelp: 'Affiche ce message',
  optVersion: 'Affiche la version',
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
    'deceptive-link': 'lien trompeur',
    'deceptive-name': 'nom trompeur',
    'active-content': 'contenu actif',
  },
  noMetadata: 'Aucune métadonnée trouvée.',
  noSupported: (path: string) => `${path} : aucun fichier pris en charge`,
  optChangedOnly: 'inspect, verify : seulement les fichiers indexés (pre-commit), ou modifiés depuis --base <ref> (pull request)',
  optBase: 'avec --changed-only : la référence git de comparaison (origin/main…)',
  changedNotRepo: '--changed-only demande un dépôt git : ce dossier n’en fait pas partie',
  changedUnknownBase: (ref: string) => `--base : référence git inconnue : ${ref}`,
  changedNone: 'Aucun fichier pris en charge modifié',
  needFiles: (cmd: string) => `${cmd} exige au moins un fichier ou un répertoire.`,
  outputSingle: '--output n’accepte qu’un seul fichier d’entrée ; utilisez --in-place pour plusieurs.',
  unknownCommand: (cmd: string) => `Commande inconnue : ${cmd}`,
  unknownOption: (opt: string) => `Option inconnue : ${opt}`,
  unknownProfile: (name: string, known: string) => `Profil inconnu : ${name} (${known})`,
  optProfile: 'minimal, balanced ou strict : les options de nettoyage et le seuil --fail-on en un mot',
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
  fieldsRemoved: (n: number) => `${n} champ${n === 1 ? '' : 's'} retiré${n === 1 ? '' : 's'}`,
  originalKept: (path: string) => `original conservé sous ${path}`,
  nothingRemoved: '\ncirta : rien à retirer',
  spacesKept: (n: number) =>
    `cirta : ${n} espace${n > 1 ? 's' : ''} typographique${n > 1 ? 's' : ''} conservée${n > 1 ? 's' : ''} (insécable, fine…) — --normalize-spaces les remplace par des espaces ordinaires`,
  spacesReplaced: (n: number) => `cirta : ${n} espace${n > 1 ? 's' : ''} typographique${n > 1 ? 's' : ''} remplacée${n > 1 ? 's' : ''} par une espace ordinaire`,
  recomposed: (n: number) => `cirta : ${n} lettre${n > 1 ? 's' : ''} accentuée${n > 1 ? 's' : ''} recomposée${n > 1 ? 's' : ''} (NFC), les deux formes étant mêlées`,
  stillInCleaned: 'cirta : toujours dans le texte nettoyé —',
  summaryTitle: 'Bilan',
  summaryFiles: (n: number) => `${n} fichier${n > 1 ? 's' : ''}`,
  summaryFlagged: (n: number) => `${n} porte${n > 1 ? 'nt' : ''} des données d’identification confirmées`,
  summaryClean: 'aucun ne porte de données d’identification confirmées',
  summaryUnreadable: (n: number) => `${n} illisible${n > 1 ? 's' : ''}`,
  survivor: (label: string, where: string, value: string) => `  ${label} (${where}) : ${value}`,
  headersRemoved: (names: string) => `cirta : en-têtes d’outil retirés — ${names}`,
  markdownRemoved: (symbols: string) => `cirta : Markdown retiré — ${symbols}`,
  markdownKept: 'cirta : Markdown laissé en place — le texte se lit comme un document Markdown, pas comme un e-mail',

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
  provVoice: 'aucune métadonnée ne nomme d’outil, mais le texte contient des phrases qu’un assistant vous adressait',
  provVoiceCaveat: 'signalées ligne par ligne ci-dessous ; elles ne disent ni quel assistant, ni quelle part du reste il a écrite.',
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
  usageVerify: 'Inspect again; exit non-zero if a finding at this level is left (confirmed by default)',
  usageSanitize: 'The text as a reader sees it, for a model; hidden instructions on stderr',
  usageMcp: 'Local MCP server (stdio): inspect_file, redact_file, sanitize_for_llm, scan_text',
  usageServe: 'ICAP service (proxy, mail gateway) and HTTP API; inspection only by default',
  optHost: 'serve: address to listen on (127.0.0.1 by default; 0.0.0.0 for all)',
  optHttpPort: 'serve: HTTP API port (8080 by default; off for none)',
  optIcapPort: 'serve: ICAP port (1344 by default; off for none)',
  optBlockOn: 'serve: replace a file carrying a finding at this level with a 403 page',
  optAllowClean: 'serve: open POST /clean (closed by default)',
  optMaxSize: 'serve: largest body inspected, in MB (50 by default)',
  serveListening: (what: string, where: string) => `${what}: ${where}`,
  serveModeInspect: 'Inspection only: everything goes through; findings go to the X-Cirta-* headers and the log (stdout).',
  serveModeBlock: (level: string) => `Blocking: a file carrying a ${level} finding or above is replaced with a 403 page.`,
  serveModeClean: 'POST /clean is open.',
  serveStopped: 'Stopped.',
  serveBadPort: (value: string) => `Invalid port: ${value} (a number from 0 to 65535, or off)`,
  serveBadSize: (value: string) => `Invalid size: ${value} (a number of megabytes)`,
  serveNothing: 'Neither HTTP nor ICAP: nothing to serve.',
  serveUnnamed: '(unnamed)',
  serveBlocked: (level: string) => `Cirta blocked this file: it carries at least one ${level} finding. What it carries, file by file (the values are not repeated):`,
  serveNotFound: 'Not found: /health, /inspect, /clean',
  serveMethod: 'Method not supported here',
  serveCleanDisabled: 'Cleaning is not open on this service: start it with --allow-clean.',
  serveTooLarge: (mb: number) => `Too large: past ${mb} MB nothing is inspected (--max-size).`,
  sanitizeHidden: (n) => `cirta: ${n} hidden passage${n > 1 ? 's' : ''} left out of the text`,
  sanitizeInstruction: (where, text) => `cirta: hidden instruction aimed at an AI (${where}) — ${text}`,
  verifyPass: 'PASS',
  verifyFail: 'FAIL',
  verifyNothing: (level) => `no ${level} finding or above`,
  verifyLeft: (n, level) => `${n} ${level} finding${n > 1 ? 's' : ''} or above left:`,
  confidenceName: { confirmed: 'confirmed', probable: 'probable', informational: 'informational' },
  paths:
    'Paths may be files or directories. Directories are walked recursively for\n' +
    'documents, images and text files; build and dependency directories such as\n' +
    'node_modules, .git and dist are skipped.',
  options: 'Options',
  optOutput: 'Destination for a single redacted file',
  optInPlace: 'Overwrite the input files (keeps a .bak)',
  optSkip: 'Extra directory names to skip, comma-separated',
  optForceText: 'Treat the input as text even if it looks binary',
  optRemoveHidden: 'redact: also remove text a reader cannot see (Word, PowerPoint, HTML, Markdown)',
  removeHiddenHint: 'Hidden text was left in. Run again with --remove-hidden to take it out of the copy.',
  optAcceptChanges: 'redact: accept every tracked change in a DOCX (deleted text leaves the file)',
  acceptChangesHint: 'Tracked changes were left in, deleted text included. Run again with --accept-changes to accept them.',
  optRemoveComments: 'redact: remove every comment (Word, Excel, PowerPoint) — text, authors, threads',
  optNormalizeSpaces: 'text --clean: also replace no-break and narrow spaces with ordinary ones',
  optStripActive: 'redact: remove scripts, actions, macros, remote templates and embedded files',
  optPii: 'also look for personal data in the text (emails, phones, IBANs, cards, NIR…), values masked',
  optRules: 'the organisation’s rules (YAML or JSON): words and patterns, each with its label and level',
  stripActiveHint: 'Scripts, actions, macros or embedded files were left in. Run again with --strip-active to remove them.',
  optStripRemote: 'redact: remove pictures, styles, scripts and frames loaded from the network, tracking pixels included (HTML, Markdown)',
  stripRemoteHint: 'Resources loaded from the network were left in. Run again with --strip-remote-resources to remove them.',
  optRemoveNotes: 'redact: remove speaker notes (PowerPoint)',
  optClearOutputs: 'redact: empty the outputs and execution counts (Jupyter notebook)',
  optReencodeImages: 'redact: rebuild JPEG and PNG pictures from their pixels (orientation applied, ICC profile kept)',
  optManifest: 'redact: write a manifest (SHA-256 and size before/after, findings by label, options, version)',
  manifestWritten: (path, n) => `Manifest written: ${path} (${n} file${n > 1 ? 's' : ''})`,
  optReport: 'inspect: write the report as an HTML page (.html) or Markdown (.md), values included',
  reportWritten: (path, n) => `Report written: ${path} (${n} file${n > 1 ? 's' : ''})`,
  reportFormat: (path) => `--report takes an .html or .md file: ${path}`,
  optRemoveHiddenSlides: 'redact: remove hidden slides and their notes (PowerPoint)',
  optRemoveHiddenSheets: 'redact: remove hidden sheets nothing reads (Excel; refused otherwise)',
  optRemoveAttachments: 'redact: remove embedded files (PDF)',
  optFlattenAnnotations: 'redact: draw annotations into the page, then remove them, authors included (PDF)',
  optStripTracking: 'redact: remove utm_*, fbclid, gclid… from links (HTML, Markdown, Office, PDF)',
  optBurnRedactions: 'redact: remove text covered by a shape for good; the page it is on becomes a picture (PDF)',
  removeCommentsHint: 'Comment text was left in (its authors are anonymised). Run again with --remove-comments to remove them.',
  aimedAlert: (n: number) =>
    n > 1
      ? `${n} hidden instructions aimed at an AI — invisible to a reader, read as orders by an assistant`
      : 'Hidden instruction aimed at an AI — invisible to a reader, read as an order by an assistant',
  optLang: 'Output language (default: the locale, else en)',
  optJson: 'Machine-readable output',
  optSarif: 'SARIF 2.1.0 output, read by GitHub Code Scanning and IDEs',
  optFailOn: 'Exit non-zero if any finding reaches this level (confirmed|probable|informational)',
  unknownLevel: (level) =>
    `Unknown level: ${level}. Expected confirmed, probable or informational.`,
  optHelp: 'Show this message',
  optVersion: 'Show the version',
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
    'deceptive-link': 'deceptive link',
    'deceptive-name': 'deceptive name',
    'active-content': 'active content',
  },
  noMetadata: 'No metadata found.',
  noSupported: (path) => `${path}: no supported files found`,
  optChangedOnly: 'inspect, verify: only the staged files (pre-commit), or those changed since --base <ref> (pull request)',
  optBase: 'with --changed-only: the git ref to compare with (origin/main…)',
  changedNotRepo: '--changed-only needs a git repository: this folder is not in one',
  changedUnknownBase: (ref) => `--base: unknown git ref: ${ref}`,
  changedNone: 'No supported file changed',
  needFiles: (cmd) => `${cmd} needs at least one file or directory.`,
  outputSingle: '--output takes a single input file; use --in-place for several.',
  unknownCommand: (cmd) => `Unknown command: ${cmd}`,
  unknownOption: (opt) => `Unknown option: ${opt}`,
  unknownProfile: (name, known) => `Unknown profile: ${name} (${known})`,
  optProfile: 'minimal, balanced or strict: the cleaning options and the --fail-on threshold in one word',
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
  fieldsRemoved: (n) => `${n} field${n === 1 ? '' : 's'} removed`,
  originalKept: (path) => `original kept as ${path}`,
  nothingRemoved: '\ncirta: nothing to remove',
  spacesKept: (n) =>
    `cirta: ${n} typographic space${n > 1 ? 's' : ''} kept (no-break, narrow…) — --normalize-spaces replaces them with ordinary spaces`,
  spacesReplaced: (n) => `cirta: ${n} typographic space${n > 1 ? 's' : ''} replaced with an ordinary space`,
  recomposed: (n) => `cirta: ${n} accented letter${n > 1 ? 's' : ''} recomposed (NFC), both forms being mixed`,
  stillInCleaned: 'cirta: still in the cleaned text —',
  summaryTitle: 'Summary',
  summaryFiles: (n) => `${n} file${n > 1 ? 's' : ''}`,
  summaryFlagged: (n) => `${n} carrying confirmed identifying data`,
  summaryClean: 'none carrying confirmed identifying data',
  summaryUnreadable: (n) => `${n} unreadable`,
  survivor: (label, where, value) => `  ${label} (${where}): ${value}`,
  headersRemoved: (names) => `cirta: tool headers removed — ${names}`,
  markdownRemoved: (symbols) => `cirta: Markdown removed — ${symbols}`,
  markdownKept: 'cirta: Markdown left in place — the text reads as a Markdown document, not as an email',

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
  provVoice: 'nothing in the metadata names a tool, but the text contains lines an assistant addressed to you',
  provVoiceCaveat: 'listed line by line below; they do not say which assistant, or how much of the rest it wrote.',
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
/** [F-P3 2.5] One language's strings, for a service that answers in the language it was started with. */
export const stringsFor = (language: Lang): Strings => (language === 'fr' ? (FR as unknown as Strings) : EN);

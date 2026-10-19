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
import type { ErrorCode } from '../core/errors.js';
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
  Trapping: 'Recouvrement (trapping)',
  'Creating application': 'Application de création',
  'Producing application': 'Application productrice',
  'Application version': 'Version de l’application',
  Company: 'Société',
  Manager: 'Responsable',
  Template: 'Modèle',
  'Hyperlink base': 'Base des liens hypertexte',
  'Last backup': 'Dernière sauvegarde',
  'Private chunk': 'Bloc privé',
  // [F-P3 2.2] Vidéo et audio.
  'Encoded by': 'Encodé par',
  Composer: 'Compositeur',
  'Album artist': 'Artiste de l’album',
  Album: 'Album',
  'File owner': 'Propriétaire du fichier',
  'Store account': 'Compte de la boutique',
  'Place name': 'Nom du lieu',
  'Capture identifier': 'Identifiant de prise de vue',
  'Media metadata field': 'Champ de métadonnées du média',
  'Embedded picture': 'Image intégrée',
  Lyricist: 'Parolier',
  'Original artist': 'Artiste original',
  'Recording date': 'Date d’enregistrement',
  'Encoding time': 'Date d’encodage',
  'Tagging time': 'Date d’étiquetage',
  Lyrics: 'Paroles',
  'User-defined text': 'Texte personnalisé',
  'Listener’s e-mail address': 'Adresse e-mail de l’auditeur',
  'Private data': 'Données privées',
  'Unique file identifier': 'Identifiant unique du fichier',
  'Linked address': 'Adresse liée',
  'Audio tag field': 'Champ d’étiquette audio',
  'Recording code (ISRC)': 'Code d’enregistrement (ISRC)',
  Engineer: 'Ingénieur du son',
  Technician: 'Technicien',
  'Commissioned by': 'Commandé par',
  Source: 'Source',
  Originator: 'Origine de l’enregistrement',
  'Originator reference': 'Référence de l’enregistrement',
  'Coding history': 'Historique de codage',
  'Cue label': 'Libellé de repère',
  Project: 'Projet',
  Scene: 'Scène',
  Tape: 'Bande',
  Client: 'Client',
  'iXML metadata': 'Métadonnées iXML',
  'Owner account': 'Compte propriétaire',
  'Owner group': 'Groupe propriétaire',
  'Member dates': 'Dates des fichiers',
  'Download address': 'Adresse de téléchargement',
  'Quarantine attribute (macOS)': 'Attribut de quarantaine (macOS)',
  'Extended attributes': 'Attributs étendus',
  'Link to an absolute path': 'Lien vers un chemin absolu',
  'Link out of the archive': 'Lien qui sort de l’archive',
  'Original file name': 'Nom de fichier d’origine',
  'Operating system': 'Système d’exploitation',
  'LaTeX comment': 'Commentaire LaTeX',
  Organizer: 'Organisateur',
  Attendees: 'Participants',
  'Event identifier naming a host': 'Identifiant d’évènement nommant une machine',
  'Vendor property': 'Propriété propre à un logiciel',
  'Meeting link carrying its passcode': 'Lien de réunion portant son code',
  'Contact identifier': 'Identifiant du contact',
  Note: 'Note',
  'LaTeX comments': 'Commentaires LaTeX',
  'Text in a comment environment': 'Texte dans un environnement comment',
  'Acknowledgement note (\\thanks)': 'Note de remerciement (\\thanks)',
  'Author contact': 'Coordonnées de l’auteur',
  'PDF author set by the source': 'Auteur PDF fixé par la source',
  'Local path in the source': 'Chemin local dans la source',
  Contributor: 'Contributeur',
  Publisher: 'Éditeur',
  'Book identifier': 'Identifiant du livre',
  'Calibre metadata': 'Métadonnées calibre',
  'Reading position saved by calibre': 'Position de lecture enregistrée par calibre',
  'Purchase record (Apple Books)': 'Trace d’achat (Apple Books)',
  'Encrypted content (DRM)': 'Contenu chiffré (DRM)',
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
  'Path of the embedded file on the author’s machine': 'Chemin du fichier intégré sur la machine de l’auteur',
  'Speaker notes': 'Notes du présentateur',
  'Speaker notes text': 'Texte des notes du présentateur',
  'Text of a hidden slide': 'Texte d’une diapositive masquée',
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
  // [C11.1] Les noms des caractères, tels que le cœur les nomme.
  'zero-width space': 'espace sans chasse',
  'zero-width non-joiner': 'antiliant sans chasse',
  'zero-width joiner': 'liant sans chasse',
  'left-to-right mark': 'marque gauche-à-droite',
  'right-to-left mark': 'marque droite-à-gauche',
  'word joiner': 'gluon de mots',
  'zero-width no-break space (BOM)': 'espace insécable sans chasse (BOM)',
  'soft hyphen': 'trait d’union conditionnel',
  'combining grapheme joiner': 'gluon de graphèmes combinant',
  'Arabic letter mark': 'marque de lettre arabe',
  'Khmer inherent vowel': 'voyelle inhérente khmère',
  'Mongolian vowel separator': 'séparateur de voyelle mongol',
  'Mongolian free variation selector': 'sélecteur de variante libre mongol',
  'bidirectional override': 'forçage bidirectionnel',
  'bidirectional isolate': 'isolat bidirectionnel',
  'interlinear annotation anchor': 'ancre d’annotation interlinéaire',
  'format control': 'caractère de mise en forme',
  'tag character': 'caractère d’étiquette',
  'no-break space': 'espace insécable',
  'Ogham space mark': 'espace oghamique',
  'en quad': 'cadratin demi (quad)',
  'em quad': 'cadratin (quad)',
  'en space': 'espace demi-cadratin',
  'em space': 'espace cadratin',
  'three-per-em space': 'espace tiers de cadratin',
  'four-per-em space': 'espace quart de cadratin',
  'six-per-em space': 'espace sixième de cadratin',
  'figure space': 'espace numérique',
  'punctuation space': 'espace de ponctuation',
  'thin space': 'espace fine',
  'hair space': 'espace ultrafine',
  'narrow no-break space': 'espace fine insécable',
  'medium mathematical space': 'espace mathématique moyenne',
  'ideographic space': 'espace idéographique',
  'Hangul filler': 'Remplisseur hangûl',
  'blank braille cell': 'Cellule braille vide',
  'Custom XML data store': 'Magasin de données XML personnalisé',
  'AI provenance data attributes': 'Attributs de données de provenance IA',
  'How the file says it was made': 'Ce que le fichier dit de sa fabrication',
  // Contenu que le paquet conserve alors que le document ne le montre plus.
  'Written to you, not to the recipient': 'Adressé à vous, pas au destinataire',
  'Address of the page the text was copied from': 'Adresse de la page d’où le texte a été copié',
  'Software named in the copied HTML': 'Logiciel nommé dans le HTML copié',
  'Class names carried by the copied text': 'Noms de classes emportés avec le texte',
  'Page attributes carried by the copied text': 'Attributs de page emportés avec le texte',
  'Fonts carried by the copied text': 'Polices emportées avec le texte',
  'Inline styles carried by the copied text': 'Styles en ligne emportés avec le texte',
  'Template placeholder left unfilled': 'Champ de modèle laissé vide',
  'Subject line repeated in the body': 'Ligne d’objet répétée dans le corps',
  'Markdown that will show as symbols': 'Markdown qui s’affichera en symboles',
  'Embedded preview image': 'Aperçu intégré de l’image',
  'Embedded preview is a different shape from the picture':
    'L’aperçu intégré n’a pas la même forme que l’image',
  'Text an earlier revision still holds':
    'Du texte qu’une révision antérieure contient encore',
  'Earlier versions of this document are still in the file':
    'Des versions antérieures de ce document sont encore dans le fichier',
  'Annotation authors': 'Auteurs des annotations',
  // [C7] Champs Exif, PNG et XMP des images.
  'Camera make and model': 'Marque et modèle de l’appareil',
  Software: 'Logiciel',
  Artist: 'Artiste',
  Copyright: 'Droits d’auteur',
  'Date modified': 'Date de modification',
  'Computer name': 'Nom de l’ordinateur',
  'Image description': 'Description de l’image',
  'Date taken': 'Date de prise de vue',
  Lens: 'Objectif',
  'Camera serial number': 'Numéro de série de l’appareil',
  'Lens serial number': 'Numéro de série de l’objectif',
  'Camera owner': 'Propriétaire de l’appareil',
  'Time zone offset': 'Décalage horaire',
  'GPS position': 'Position GPS',
  'GPS altitude': 'Altitude GPS',
  'GPS date and time': 'Date et heure GPS',
  'Editing history': 'Historique d’édition',
  'Source file path': 'Chemin du fichier source',
  'Document ancestors': 'Documents d’origine',
  'Source device': 'Appareil source',
  Comment: 'Commentaire',
  'Creation time': 'Date de création',
  Disclaimer: 'Avertissement légal',
  Warning: 'Avertissement',
  'PNG text field': 'Champ texte PNG',
  // Texte qu'un lecteur ne voit pas et qu'une IA lit.
  'Text covered by a shape': 'Texte recouvert par une forme',
  'Text that does not show on the page': 'Texte qui n’apparaît pas sur la page',
  'Text too faint to read': 'Texte trop pâle pour être lu',
  'Text too small to read': 'Texte trop petit pour être lu',
  'Text placed outside the page': 'Texte placé hors de la page',
  'Text hidden by the page’s styles': 'Texte masqué par le style de la page',
  'Text formatted as hidden': 'Texte mis en forme « masqué »',
  'Text a browser does not render': 'Texte qu’un navigateur n’affiche pas',
  // [F-2.1] Contenu actif.
  'Action run when the document opens': 'Action lancée à l’ouverture du document',
  'JavaScript in the document': 'JavaScript dans le document',
  'Action triggered by an event': 'Action déclenchée par un événement',
  'Launches a program or a file': 'Lance un programme ou un fichier',
  'Sends form data to an address': 'Envoie les données du formulaire à une adresse',
  'Imports data from a file': 'Importe des données depuis un fichier',
  'Opens another document': 'Ouvre un autre document',
  'Web addresses linked': 'Adresses web liées',
  'Rich media (Flash, 3D, video)': 'Média enrichi (Flash, 3D, vidéo)',
  'XFA form': 'Formulaire XFA',
  'Embedded file': 'Fichier intégré',
  'Macros (VBA project)': 'Macros (projet VBA)',
  'Macro that runs on its own': 'Macro qui s’exécute d’elle-même',
  'Macro that reaches the system': 'Macro qui atteint le système',
  'Address in a macro': 'Adresse dans une macro',
  'Remote template loaded on opening': 'Modèle distant chargé à l’ouverture',
  'Remote resource loaded on opening': 'Ressource distante chargée à l’ouverture',
  'DDE field (runs a command)': 'Champ DDE (lance une commande)',
  'Field loading a remote resource': 'Champ qui charge une ressource distante',
  'Embedded object (OLE)': 'Objet intégré (OLE)',
  'ActiveX control': 'Contrôle ActiveX',
  'Data connection': 'Connexion de données',
  'Password stored in a connection': 'Mot de passe enregistré dans une connexion',
  'Query table': 'Table de requête',
  'Power Query source': 'Source Power Query',
  'Hidden rows and columns': 'Lignes et colonnes masquées',
  'Cells in white type': 'Cellules en blanc sur blanc',
  'Tracking pixel': 'Pixel de suivi',
  'Tracking parameters in a link': 'Paramètres de suivi dans un lien',
  // [F-2.3] Données personnelles.
  'Email address': 'Adresse e-mail',
  'Phone number': 'Numéro de téléphone',
  'Payment card number': 'Numéro de carte bancaire',
  'French social security number (NIR)': 'Numéro de sécurité sociale (NIR)',
  'SIREN/SIRET number': 'Numéro SIREN/SIRET',
  'IP address': 'Adresse IP',
  'Private IP address': 'Adresse IP privée',
  'MAC address': 'Adresse MAC',
  'Internal host name': 'Nom d’hôte interne',
  'French licence plate': 'Plaque d’immatriculation',
  'Passport or ID card number': 'Numéro de passeport ou de carte d’identité',
  'Tag characters': 'Caractères d’étiquette (tag)',
  'Variation selectors': 'Sélecteurs de variante',
  'Hidden instruction aimed at an AI': 'Consigne cachée destinée à une IA',
  'Encrypted document': 'Document chiffré',
  'Link text shows a different address': 'Le texte du lien affiche une autre adresse',
  'Link that runs a script': 'Lien qui exécute un script',
  'Data after the end of the image': 'Données après la fin de l’image',
  'Link to data carried in the address': 'Lien vers des données portées par l’adresse',
  'Link through an open redirector': 'Lien qui passe par un redirecteur ouvert',
  'File name with a direction control': 'Nom de fichier avec un contrôle de sens d’écriture',
  'Double extension hiding a program': 'Double extension qui cache un programme',
  'Invisible character in a file name': 'Caractère invisible dans un nom de fichier',
  'File name mixing two alphabets': 'Nom de fichier mêlant deux alphabets',
  'Archive member written outside its folder': 'Membre d’archive écrit hors de son dossier',
  'Deleted text still in the file (tracked changes)': 'Texte supprimé encore présent (suivi de modifications)',
  'Moved text still at its old place (tracked changes)': 'Texte déplacé encore à son ancienne place (suivi de modifications)',
  'Inserted text not yet accepted (tracked changes)': 'Texte inséré pas encore accepté (suivi de modifications)',
  'Comment text': 'Texte d’un commentaire',
  'Comment author account': 'Compte de l’auteur d’un commentaire',
  'Attachment not inspected': 'Pièce jointe non inspectée',
  Kernel: 'Noyau',
  Language: 'Langage',
  'Notebook metadata': 'Métadonnées du notebook',
  'Cell metadata': 'Métadonnées de cellule',
  'Execution time': 'Heure d’exécution',
  'Local path in an output': 'Chemin local dans une sortie',
  'Attached message beyond the nesting limit': 'Message joint au-delà de la limite d’imbrication',
  'Sent on behalf of': 'Envoyé au nom de',
  'Exchange account (X.500 address)': 'Compte Exchange (adresse X.500)',
  Sent: 'Envoyé le',
  Received: 'Reçu le',
  'Cropped pictures keep their original image':
    'Les images recadrées conservent leur original',
  'Pivot table cache holds a copy of the source rows':
    'Le cache du tableau croisé garde une copie des lignes sources',
  'Hidden worksheets': 'Feuilles masquées',
  'Image generation settings, including the prompt':
    'Réglages de génération d’image, prompt compris',
  'Image generator named in metadata': 'Générateur d’images nommé dans les métadonnées',
  'Letters styled with mathematical symbols': 'Lettres stylisées en symboles mathématiques',
  // Liens trompeurs.
  'Hostname written entirely in a lookalike alphabet':
    'Nom de domaine écrit entièrement dans un alphabet sosie',
  'Hostname mixing two alphabets': 'Nom de domaine mêlant deux alphabets',
  'Link that reads as one site and resolves to another':
    'Lien qui se lit comme un site et mène à un autre',
  'Invisible character inside a hostname': 'Caractère invisible dans un nom de domaine',
  'Internationalised hostname': 'Nom de domaine internationalisé',
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
  // [C1] Ce qu'un PDF chiffré laisse lire.
  'encrypted, with an empty user password: it opens without one, so its metadata was decrypted and is reported here':
    'chiffré avec un mot de passe utilisateur vide : il s’ouvre sans mot de passe, ses métadonnées ont donc été déchiffrées et sont listées ici',
  'opening it needs a password: nothing inside was read, so its metadata, text and hidden text are unknown':
    'il faut un mot de passe pour l’ouvrir : rien n’a été lu à l’intérieur, ses métadonnées, son texte et son texte caché sont donc inconnus',
  'it could not be decrypted here: nothing inside was read':
    'il n’a pas pu être déchiffré ici : rien n’a été lu à l’intérieur',
  'decrypting it needs the PDF renderer, which is not available here: nothing inside was read':
    'le déchiffrer demande le moteur de rendu PDF, absent ici : rien n’a été lu à l’intérieur',
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
  'a password is needed to open it': 'il faut un mot de passe pour l’ouvrir',
  'local links': 'liens locaux',
  'hidden slides': 'diapositives masquées',
  'speaker notes': 'notes du présentateur',
  'external workbook references': 'références vers d’autres classeurs',
};

/** Some labels carry the field name, so the prefix is translated rather than the whole. */
const LABEL_PREFIX: Array<[RegExp, string]> = [
  [/^variation selector (\d+)$/, 'sélecteur de variante $1'],
  [/^PNG (\w{4}) chunk$/, 'Bloc PNG $1'],
  [/^Custom property: /, 'Propriété personnalisée : '],
  [/^User-defined property: /, 'Propriété utilisateur : '],
  [/^Custom info key: /, 'Clé /Info personnalisée : '],
  [/^Credential left in file: /, 'Secret laissé dans le fichier : '],
  [/^Non-standard header: /, 'En-tête non standard : '],
  [/^Relay hop /, 'Relais traversé '],
];

/** Locations built from a number rather than drawn from the table below. */
const LOCATION_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^attachment (.+)$/, (m) => `pièce jointe ${m[1]}`],
  [/^part (\d+) \((.+)\)$/, (m) => `partie ${m[1]} (${m[2]})`],
  [/^revision (\d+)$/, (m) => `révision ${m[1]}`],
  [/^line (\d+)$/, (m) => `ligne ${m[1]}`],
  [/^stream (.+)$/, (m) => `flux ${m[1]}`],
  [/^document body \((.+)\)$/, (m) => `corps du document (${m[1]})`],
  [/^comment (\d+)$/, (m) => `commentaire ${m[1]}`],
];

/** [F-P2 2.2] Where the other picture formats keep their metadata. */
const PICTURE_LOCATION_FR: Record<string, string> = {
  'WebP chunks': 'blocs WebP',
  'GIF blocks': 'blocs GIF',
  'TIFF directory': 'répertoire TIFF',
  'HEIF items': 'éléments HEIF',
};

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
  links: 'liens',
  'file revisions': 'révisions du fichier',
  'text formatting': 'mise en forme du texte',
  'clipboard (HTML)': 'presse-papiers (HTML)',
  'page annotations (/T)': 'annotations de page (/T)',
  'mathematical alphanumerics': 'alphanumériques mathématiques',
  'xl/workbook.xml:sheet': 'xl/workbook.xml:sheet',
  'container structure': 'structure du conteneur',
  'file structure': 'structure du fichier',
  'package structure': 'structure du paquet',
  comments: 'commentaires',
  'archive member paths': 'chemins des membres de l’archive',
  'file references': 'références de fichiers',
};

/** Alphabet names, which the core reports in English inside a sentence. */
const SCRIPT_TEXT: Record<string, string> = {
  Latin: 'latin',
  Cyrillic: 'cyrillique',
  Greek: 'grec',
  Armenian: 'arménien',
  Cherokee: 'cherokee',
  Han: 'han',
};

/** "Cyrillic and Greek" as the URL module joins them, rendered in French. */
const scripts = (list: string) =>
  list
    .split(' and ')
    .map((name) => SCRIPT_TEXT[name] ?? name.toLowerCase())
    .join(' et ');

/**
 * Deceptive-link values, which the URL module builds by interpolating a
 * hostname into a sentence. Same arrangement as the structural reasons: the
 * shapes are few and fixed, so each is matched and rewritten whole rather than
 * stitched together from fragments that would read as translated machinery.
 */
const LINK_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [
    /^(.+) — the part before "@" is a username, not a destination: this goes to (\S+), while "(.*)" is what a reader sees first$/,
    (m) =>
      `${m[1]} — ce qui précède le « @ » est un nom d'utilisateur, pas une destination : ce lien ` +
      `mène à ${m[2]}, alors que « ${m[3]} » est ce qu'un lecteur voit d'abord`,
  ],
  [
    /^(.+) — a format or bidi control sits in the authority, where nothing renders it$/,
    (m) =>
      `${m[1]} — un caractère de format ou de sens d'écriture se trouve dans le nom de domaine, ` +
      `où rien ne l'affiche`,
  ],
  [
    /^(.+) — "(.*)" draws on Latin and (.+?) at once(, written in the address bar as (\S+?))?( — it renders as "(.*)")?$/,
    (m) =>
      `${m[1]} — « ${m[2]} » puise à la fois dans le latin et ${scripts(m[3]!)}` +
      (m[5] ? `, écrit dans la barre d'adresse ${m[5]}` : '') +
      (m[7] ? ` — il s'affiche comme « ${m[7]} »` : ''),
  ],
  [
    /^(.+) — "(.*)" is (.+?) throughout, so nothing about it is mixed — but it renders as "(.*)"(\. The address is really (\S+))?$/,
    (m) =>
      `${m[1]} — « ${m[2]} » est entièrement en ${scripts(m[3]!)}, donc rien n'y est mêlé — ` +
      `mais il s'affiche comme « ${m[4]} »` +
      (m[6] ? `. L'adresse réelle est ${m[6]}` : ''),
  ],
  [
    /^(.+) — (\S+) is displayed as "(.*)" — legitimate for a non-Latin name, and the shape a homograph also takes$/,
    (m) =>
      `${m[1]} — ${m[2]} s'affiche « ${m[3]} » — légitime pour un nom non latin, et c'est aussi ` +
      `la forme que prend un homographe`,
  ],
];

/** Values the core builds by interpolating a count, matched by shape. */
/** Sizes and weights as they appear inside a longer sentence. */
const measure = (text: string): string =>
  text.replace(/of unknown size/, 'de taille inconnue').replace(/ bytes/, ' octets');

const VALUE_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [
    /^(.+) — a second copy of the picture, which not every editor regenerates when the original is cropped or retouched$/,
    (m) =>
      `${measure(m[1] ?? '')} — une seconde copie de l’image, que tous les éditeurs ne régénèrent pas quand l’original est recadré ou retouché`,
  ],
  [
    /^preview (.+), picture (.+) — cropping changes the picture and not always the preview, so this one may still show what was cropped away$/,
    (m) =>
      `aperçu ${measure(m[1] ?? '')}, image ${m[2]} — un recadrage change l’image et pas toujours l’aperçu, celui-ci peut donc montrer encore ce qui a été rogné`,
  ],
  [
    /^"([\s\S]*)" — in an earlier revision, not in the current one; in context: "([\s\S]*)"$/,
    (m) =>
      `« ${m[1]} » — présent dans une révision antérieure, absent de la révision actuelle ; dans son contexte : « ${m[2]} »`,
  ],
  [
    /^"([\s\S]*)" — in an earlier revision, not in the current one$/,
    (m) => `« ${m[1]} » — présent dans une révision antérieure, absent de la révision actuelle`,
  ],
  [
    /^(\d+) values? \(correlate documents edited in the same session\)$/,
    (m) => `${m[1]} valeur(s) — corrèlent les documents édités dans la même session`,
  ],
  [
    /^(\d+) hidden slides? still present in the file$/,
    (m) => `${m[1]} diapositive(s) masquée(s), toujours présentes dans le fichier`,
  ],
  [/^(\d+) slides? with presenter notes$/, (m) => `${m[1]} diapositive(s) avec des notes`],
  [/^(.+) — (\d+) bytes(, .+)?$/, (m) => `${m[1]} — ${m[2]} octets${m[3] ?? ''}`],
  [/^(object|linked object)(, ProgID .+)?$/, (m) => `${m[1] === 'object' ? 'objet' : 'objet lié'}${m[2] ?? ''}`],
  [/^(\d+) bytes(, ProgID .+)$/, (m) => `${m[1]} octets${m[2]}`],
  [/^(\d+) modules?: (.+)$/, (m) => `${m[1]} module(s) : ${m[2]}`],
  [
    /^(.+?): (?:(\d+) rows? \(([^)]*)\))?(?:, )?(?:(\d+) columns? \(([^)]*)\))?$/,
    (m) =>
      `${m[1]} : ${[m[2] ? `${m[2]} ligne(s) (${m[3]})` : '', m[4] ? `${m[4]} colonne(s) (${m[5]})` : ''].filter(Boolean).join(', ')}`,
  ],
  [/^(.+) — (Password|Pwd)=•+ \(user (.+)\)$/, (m) => `${m[1]} — ${m[2]}=•••••••• (utilisateur ${m[3]})`],
  [/^(\d+) bytes — the project could not be read$/, (m) => `${m[1]} octets — le projet n’a pas pu être lu`],
  // [C11.2] One line per smuggling family.
  [
    /^(\d+) characters? \((\d+) distinct\)(?: — read ([\s\S]*))?$/,
    (m) => `${m[1]} caractère(s) (${m[2]} distinct(s))${m[3] ? ` — se lit ${m[3]}` : ''}`,
  ],
  [/^(\d+) bytes$/, (m) => `${m[1]} octets`],
  // [F-P3 2.2] Lyrics by their length; a private ID3 frame by its owner and size.
  [/^(\d+) characters$/, (m) => `${m[1]} caractères`],
  [/^(.+), (\d+) bytes$/, (m) => `${m[1]}, ${m[2]} octets`],
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

/**
 * A note's detail is a list of labels joined with ", " — and a label may hold
 * a comma itself ("Written to you, not to the recipient"). [C11.1] Pieces are
 * joined back whenever together they name something the tables know.
 */
const known = (part: string) => part in CONTENT_KIND || part in FIELD_LABEL;

const translateDetail = (detail: string, lang: Lang): string => {
  if (lang === 'en') return detail;
  const pieces = detail.split(', ');
  const parts: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    let part = pieces[i]!;
    for (let j = i + 1; j < pieces.length && !known(part); j++) {
      const joined = pieces.slice(i, j + 1).join(', ');
      if (known(joined)) {
        part = joined;
        i = j;
        break;
      }
    }
    parts.push(CONTENT_KIND[part] ?? translateLabel(part, lang));
  }
  return parts.join(', ');
};

/** [C11.1] What a leaked credential is, named in French after the prefix. */
const CREDENTIAL_NAME: Record<string, string> = {
  'Anthropic API key': 'clé d’API Anthropic',
  'OpenAI project key': 'clé de projet OpenAI',
  'OpenAI-style API key': 'clé d’API de type OpenAI',
  'OpenAI API key': 'clé d’API OpenAI',
  'Google API key': 'clé d’API Google',
  'Hugging Face token': 'jeton Hugging Face',
  'GitHub token': 'jeton GitHub',
  'AWS access key id': 'identifiant de clé d’accès AWS',
  'AWS temporary access key id': 'identifiant de clé d’accès AWS temporaire',
  'Slack token': 'jeton Slack',
  'Stripe live key': 'clé Stripe de production',
};

export function translateLabel(label: string, lang: Lang): string {
  if (lang === 'en') return label;
  const mapped = FIELD_LABEL[label];
  if (mapped) return mapped;
  const credential = /^Credential left in file: (.+)$/.exec(label);
  if (credential) return `Secret laissé dans le fichier : ${CREDENTIAL_NAME[credential[1]!] ?? credential[1]}`;
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

  // [C11.1] An archive member or a mail part leads, its own location follows:
  // each step is translated on its own, paths staying as they are.
  if (location.includes(' → ')) return location.split(' → ').map((step) => translateLocation(step, lang)).join(' → ');

  const mapped = LOCATION_TEXT[location];
  if (mapped) return mapped;

  const container = /^(JPEG segments|PNG chunks)(.*)$/.exec(location);
  if (container) return `${container[1] === 'JPEG segments' ? 'segments JPEG' : 'blocs PNG'}${container[2]}`;
  // [F-P3 2.2]
  const media = /^MP4 boxes(.*)$/.exec(location);
  if (media) return `boîtes MP4${media[1]}`;
  const tag = /^(ID3v2|ID3v1|APEv2) tag(.*)$/.exec(location);
  if (tag) return `étiquette ${tag[1]}${tag[2]}`;
  if (location === 'MPEG audio (encoder header)') return 'audio MPEG (en-tête de l’encodeur)';
  const riff = /^WAV chunks(.*)$/.exec(location);
  if (riff) return `blocs WAV${riff[1]}`;
  const tarHeaders = /^TAR headers(?: \((.+)\))?$/.exec(location);
  if (tarHeaders) {
    const field = tarHeaders[1] === 'link' ? 'lien' : tarHeaders[1] === 'pax comment' ? 'commentaire pax' : tarHeaders[1];
    return `en-têtes TAR${field ? ` (${field})` : ''}`;
  }
  if (location === 'gzip header') return 'en-tête gzip';
  const picture = /^(WebP chunks|GIF blocks|TIFF directory|HEIF items)(.*)$/.exec(location);
  if (picture) return `${PICTURE_LOCATION_FR[picture[1]!]}${picture[2]}`;

  for (const [pattern, render] of LOCATION_PATTERNS) {
    const match = pattern.exec(location);
    if (match) return render(match);
  }

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

/**
 * Values from the checks that report retained content and generated images.
 * Each module composes one sentence around a count or a name, so each shape is
 * matched whole — a half-translated line reads as a bug because it is one.
 */
const RETAINED_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^shows (.+) — goes to (.+)$/, (m) => `affiche ${m[1]} — mène à ${m[2]}`],
  // [F-P2 2.1] Liens et noms de fichiers piégés.
  [/^(\d+) bytes after the image ends$/, (m) => `${m[1]} octets après la fin de l’image`],
  [/^(\d+) comments, the first (\d+) quoted$/, (m) => `${m[1]} commentaires, les ${m[2]} premiers cités`],
  [/^data:(\S+) \(a page, opened as one\)$/, (m) => `data:${m[1]} (une page, ouverte comme telle)`],
  [/^shown as “([\s\S]*)”, really ends in (\S+) \((U\+[0-9A-F]+)\)$/, (m) => `affiché « ${m[1]} », se termine en réalité par ${m[2]} (${m[3]})`],
  [/^([\s\S]+) — opens as (\S+), not (\S+)$/, (m) => `${m[1]} — s’ouvre comme ${m[2]}, pas comme ${m[3]}`],
  [/^(U\+[0-9A-F]+) in “([\s\S]*)”$/, (m) => `${m[1]} dans « ${m[2]} »`],
  [/^“([\s\S]*)” mixes (\w+) and (\w+)$/, (m) => `« ${m[1]} » mêle ${SCRIPT_TEXT[m[2]!] ?? m[2]} et ${SCRIPT_TEXT[m[3]!] ?? m[3]}`],
  [
    /^(\d+) revisions are present(.*?)\. A reader shows only the newest; the previous ones were appended to, never removed, and the first ends ([\d,]+) bytes in — about (\d+)% of the file\. Text covered or deleted in a later revision is still readable in an earlier one$/,
    (m) =>
      `${m[1]} révisions sont présentes${m[2] ? ' (une section de références croisées décomptée comme linéarisation)' : ''}. ` +
      `Un lecteur n'affiche que la plus récente ; les précédentes ont été complétées, jamais retirées, ` +
      `et la première s'achève à ${m[3]} octets — environ ${m[4]} % du fichier. Un texte masqué ou ` +
      `supprimé dans une révision ultérieure reste lisible dans une révision antérieure`,
  ],
  [
    /^(.+) — named on (\d+) annotations? carried by the pages$/,
    (m) => `${m[1]} — nommés sur ${m[2]} annotation(s) portées par les pages`,
  ],
  [
    /^(\d+) parts? crops? an image with a:srcRect\. Cropping only changes which rectangle is displayed — the full picture is still in the package, so whatever was cropped out can be recovered by unzipping the file$/,
    (m) =>
      `${m[1]} partie(s) recadrent une image avec a:srcRect. Le recadrage ne change que le rectangle ` +
      `affiché — l'image entière est toujours dans le paquet, donc ce qui a été rogné se récupère en ` +
      `décompressant le fichier`,
  ],
  [
    /^(\d+) cache parts?, ([\d,]+) bytes\. A pivot table keeps its own copy of the data it was built from, so deleting or hiding the source sheet leaves the rows in the file$/,
    (m) =>
      `${m[1]} partie(s) de cache, ${m[2]} octets. Un tableau croisé garde sa propre copie des données ` +
      `dont il est issu : supprimer ou masquer la feuille source laisse les lignes dans le fichier`,
  ],
  [
    /^(.+) — their cells travel with the workbook(\. A veryHidden sheet cannot be unhidden from the Excel interface, so it is easy to forget one is there)?$/,
    (m) =>
      `${m[1]} — leurs cellules voyagent avec le classeur` +
      (m[2]
        ? `. Une feuille veryHidden ne peut pas être réaffichée depuis l'interface d'Excel, ` +
          `il est donc facile d'en oublier une`
        : ''),
  ],
  [
    /^written by (.+?)( — begins "(.*)")?\. The prompt, the model and the seed travel with the file$/,
    (m) =>
      `écrit par ${m[1]}` +
      (m[3] ? ` — commence par « ${m[3]} »` : '') +
      `. Le prompt, le modèle et la seed voyagent avec le fichier`,
  ],
  [
    /^(\d+) characters? from the Mathematical Alphanumeric Symbols block, reading as "(.*)"\. A filter or a search matching the ordinary letters does not match these, while a reader sees no difference\. Legitimate in a formula$/,
    (m) =>
      `${m[1]} caractère(s) du bloc Mathematical Alphanumeric Symbols, qui se lisent « ${m[2]} ». ` +
      `Un filtre ou une recherche portant sur les lettres ordinaires ne les trouve pas, alors qu'un ` +
      `lecteur ne voit aucune différence. Légitime dans une formule`,
  ],
];

/** [C11.1] How a passage is hidden, after its quoted text. */
const HIDDEN_WHY: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^placed outside the slide$/, () => 'placé hors de la diapositive'],
  [/^positioned off-screen$/, () => 'placé hors écran'],
  [/^hidden attribute$/, () => 'attribut « hidden »'],
  [/^HTML comment$/, () => 'commentaire HTML'],
  [/^(alt|title|aria-label) attribute$/, (m) => `attribut « ${m[1]} »`],
  [/^(w:color|colou?r) (\S+) on (\S+)$/, (m) => `${m[1] === 'w:color' ? 'w:color' : 'couleur'} ${m[2]} sur ${m[3]}`],
];

const HIDDEN_VALUE_LABELS = new Set([
  'Hidden instruction aimed at an AI',
  'Text covered by a shape',
  'Text that does not show on the page',
  'Text too faint to read',
  'Text too small to read',
  'Text placed outside the page',
  'Text hidden by the page’s styles',
  'Text formatted as hidden',
  'Text a browser does not render',
]);

/** Unicode's names for the hyphen lookalikes, as the French edition of ISO/IEC 10646 gives them. */
const HYPHEN_NAME: Record<string, string> = {
  'NON-BREAKING HYPHEN': 'TRAIT D’UNION INSÉCABLE',
  HYPHEN: 'TRAIT D’UNION',
  'FIGURE DASH': 'TIRET NUMÉRIQUE',
  'MODIFIER LETTER MINUS SIGN': 'LETTRE MODIFICATIVE SIGNE MOINS',
  'MINUS SIGN': 'SIGNE MOINS',
};

const TEXT_VALUE_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^(.+)… \((\d+) characters\) — rotate this key$/, (m) => `${m[1]}… (${m[2]} caractères) — révoquez cette clé`],
  [
    /^(tag characters|variation selectors|zero-width binary|zero-width base-4) → ([\s\S]*)$/,
    (m) =>
      `${{ 'tag characters': 'caractères d’étiquette', 'variation selectors': 'sélecteurs de variante', 'zero-width binary': 'binaire sans chasse', 'zero-width base-4': 'base 4 sans chasse' }[m[1]!]} → ${m[2]}`,
  ],
  [
    /^(.+) — invisible, and one bit per position(\. ESC is also how a coloured terminal log is written)?$/,
    (m) => `${m[1]} — invisibles, et un bit par position${m[2] ? '. ESC est aussi ce qui écrit un journal de terminal en couleur' : ''}`,
  ],
];

function translateHyphens(value: string): string | undefined {
  const match = /^((?:U\+[0-9A-F]{4} [A-Z -]+ ×\d+(?:, )?)+)( — [\s\S]*)$/.exec(value);
  if (!match) return undefined;
  const names = match[1]!.replace(/(U\+[0-9A-F]{4}) ([A-Z -]+?) ×/g, (_, cp: string, name: string) => `${cp} ${HYPHEN_NAME[name] ?? name} ×`);
  return names + match[2]!.replace(' — indistinguishable from "-" on screen', ' — indiscernables du « - » à l’écran');
}

export function translateValue(finding: Finding, lang: Lang): string {
  if (lang === 'en') return finding.value;
  if (HIDDEN_VALUE_LABELS.has(finding.label)) {
    const cut = finding.value.lastIndexOf(' — ');
    if (cut > 0) {
      const why = finding.value.slice(cut + 3);
      for (const [pattern, render] of HIDDEN_WHY) {
        const match = pattern.exec(why);
        if (match) return `${finding.value.slice(0, cut)} — ${render(match)}`;
      }
    }
  }
  if (finding.location === 'hyphen lookalikes') {
    const hyphens = translateHyphens(finding.value);
    if (hyphens) return hyphens;
  }
  for (const [pattern, render] of TEXT_VALUE_PATTERNS) {
    const match = pattern.exec(finding.value);
    if (match) return render(match);
  }
  // Occurrence counts read identically in both languages.
  const mapped = VALUE_TEXT[finding.value];
  if (mapped) return mapped;
  if (/\bstructure$/.test(finding.location)) return translateReasons(finding.value);
  for (const [pattern, render] of RETAINED_PATTERNS) {
    const match = pattern.exec(finding.value);
    if (match) return render(match);
  }
  if (finding.location === 'links') {
    for (const [pattern, render] of LINK_PATTERNS) {
      const match = pattern.exec(finding.value);
      if (match) return render(match);
    }
  }
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

/* ------------------------------------------------------------- refusals -- */

/**
 * A refusal in the reader's language. The core's errors carry a code; this is
 * where each front-end turns it into a sentence. An error without a code —
 * a file the system could not open, say — keeps its own message.
 */
/** [F-2.3] Why a rules file was refused, in French. */
const RULES_DETAIL: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^line (\d+): unterminated string$/, (m) => `ligne ${m[1]} : chaîne non terminée`],
  [/^line (\d+): expected "key: value"$/, (m) => `ligne ${m[1]} : « clé: valeur » attendu`],
  [/^line (\d+): unexpected indentation$/, (m) => `ligne ${m[1]} : indentation inattendue`],
  [/^line (\d+): tabs are not allowed in indentation$/, (m) => `ligne ${m[1]} : tabulations interdites dans l’indentation`],
  [/^not valid JSON: ([\s\S]*)$/, (m) => `JSON invalide (« ${m[1]} »)`],
  [/^expected a list of rules, under "rules:"$/, () => 'une liste de règles est attendue, sous « rules: »'],
  [/^at most (\d+) rules$/, (m) => `${m[1]} règles au plus`],
  [/^rule (.+?): expected a mapping$/, (m) => `règle ${m[1]} : un dictionnaire est attendu`],
  [/^rule (.+?): a label is required$/, (m) => `règle ${m[1]} : un libellé (label) est requis`],
  [/^rule (.+?): level must be confirmed, probable or informational$/, (m) => `règle ${m[1]} : level doit valoir confirmed, probable ou informational`],
  [/^rule (.+?): unknown kind (.+)$/, (m) => `règle ${m[1]} : type (kind) inconnu ${m[2]}`],
  [/^rule (.+?): give words or a pattern$/, (m) => `règle ${m[1]} : indiquez des mots (words) ou un motif (pattern)`],
  [/^rule (.+?): flags may only be i, m, s, u$/, (m) => `règle ${m[1]} : flags ne peut contenir que i, m, s, u`],
  [/^rule (.+?): ([\s\S]*)$/, (m) => `règle ${m[1]} : motif invalide (« ${m[2]} »)`],
];

const translateRulesDetail = (detail: string): string => {
  for (const [pattern, render] of RULES_DETAIL) {
    const m = pattern.exec(detail);
    if (m) return render(m);
  }
  return detail;
};

const ERROR_TEXT: Record<ErrorCode, (detail?: string) => { en: string; fr: string }> = {
  unsupported: () => ({
    en: 'Unrecognised file. Supported: PDF, Office Open XML (.pptx, .docx, .xlsx, .vsdx), OpenDocument (.odt, .ods, .odp), legacy Office (.doc, .xls, .ppt) and Outlook (.msg), inspection only, Jupyter notebooks, RTF, EPUB, SVG, HTML, Markdown, JPEG, PNG, WebP and GIF, and TIFF, HEIC and AVIF, inspection only; MP4, QuickTime, M4A, MP3 and WAV; TAR and gzip, inspection only.',
    fr: 'Fichier non reconnu. Formats pris en charge : PDF, Office Open XML (.pptx, .docx, .xlsx, .vsdx), OpenDocument (.odt, .ods, .odp), Office ancien (.doc, .xls, .ppt) et Outlook (.msg), en inspection seule, notebooks Jupyter, RTF, EPUB, SVG, HTML, Markdown, JPEG, PNG, WebP et GIF, ainsi que TIFF, HEIC et AVIF, en inspection seule ; MP4, QuickTime, M4A, MP3 et WAV ; TAR et gzip, en inspection seule.',
  }),
  unparseable: (detail) => ({
    en: `This file could not be parsed${detail ? `: ${detail}` : '.'}`,
    fr: `Ce fichier n’a pas pu être lu${detail ? ` : ${detail}` : '.'}`,
  }),
  'epub-encrypted': (detail) => ({
    en: `This book is encrypted (DRM)${detail ? `: ${detail}` : ''}. Its pages cannot be read without the key, so they cannot be cleaned, and it is not rewritten.`,
    fr: `Ce livre est chiffré (DRM)${detail ? ` : ${detail}` : ''}. Ses pages sont illisibles sans la clé, elles ne peuvent donc pas être nettoyées, et il n’est pas réécrit.`,
  }),
  'encrypted-pdf': () => ({
    en: 'This PDF is encrypted. Cleaning it would need its key; without one the copy would be unreadable, so it is not attempted. Remove the protection in the application that set it, then clean the result.',
    fr: 'Ce PDF est chiffré. Le nettoyer demanderait sa clé ; sans elle, la copie serait illisible, donc ce n’est pas tenté. Retirez la protection dans l’application qui l’a posée, puis nettoyez le résultat.',
  }),
  'output-unreadable': (detail) => ({
    en: `The cleaned copy did not parse again, so it was not delivered${detail ? ` (${detail})` : ''}. The original is untouched.`,
    fr: `La copie nettoyée n’a pas pu être relue, elle n’a donc pas été livrée${detail ? ` (${detail})` : ''}. L’original est intact.`,
  }),
  'archive-not-rewritable': (detail) =>
    detail
      ? {
          en: `This archive holds files Cirta cannot clean: ${detail}. It is not rewritten, rather than handed back with those files as they were. Extract it, deal with them separately, clean the rest, and repack.`,
          fr: `Cette archive contient des fichiers que Cirta ne sait pas nettoyer : ${detail}. Elle n’est pas réécrite, plutôt que rendue avec ces fichiers tels quels. Extrayez-la, traitez-les à part, nettoyez le reste, puis recompressez.`,
        }
      : {
          en: 'Plain archives are inspected but not rewritten. Extract it, clean the files individually, and repack.',
          fr: 'Les archives simples sont inspectées mais pas réécrites. Extrayez-la, nettoyez les fichiers un par un, puis recompressez.',
        },
  'legacy-not-rewritable': (detail) =>
    detail === 'msg'
      ? {
          en: 'Outlook messages are inspected but not rewritten: rebuilding a compound file without damaging it is not something this tool can verify. Save the message as .eml from your mail client, then clean that copy.',
          fr: 'Les messages Outlook sont inspectés mais pas réécrits : reconstruire un fichier composite sans l’abîmer n’est pas une chose que cet outil sait vérifier. Enregistrez le message en .eml depuis votre messagerie, puis nettoyez cette copie.',
        }
      : {
          en: `Legacy Office files (.doc, .xls, .ppt) are inspected but not rewritten: rebuilding a compound file without damaging it is not something this tool can verify. Save it as .${detail === 'xls' ? 'xlsx' : detail === 'ppt' ? 'pptx' : 'docx'} in Office or LibreOffice, then clean that copy.`,
          fr: `Les fichiers Office anciens (.doc, .xls, .ppt) sont inspectés mais pas réécrits : reconstruire un fichier composite sans l’abîmer n’est pas une chose que cet outil sait vérifier. Enregistrez-le en .${detail === 'xls' ? 'xlsx' : detail === 'ppt' ? 'pptx' : 'docx'} dans Office ou LibreOffice, puis nettoyez cette copie.`,
        },
  'empty-file': () => ({ en: 'Empty file.', fr: 'Fichier vide.' }),
  'reencode-unavailable': (detail) =>
    detail
      ? {
          en: `Re-encoding is offered for JPEG and PNG pictures, not ${detail.toUpperCase()}: nothing was cleaned, rather than a copy that was not re-encoded. Clean it without re-encoding.`,
          fr: `Le ré-encodage est proposé pour les images JPEG et PNG, pas ${detail.toUpperCase()} : rien n’a été nettoyé, plutôt qu’une copie qui ne l’aurait pas été. Nettoyez-la sans ré-encodage.`,
        }
      : {
          en: 'Re-encoding pictures needs an image codec, which is not available here: nothing was cleaned, rather than a copy that was not re-encoded.',
          fr: 'Ré-encoder les images demande un codec d’image, absent ici : rien n’a été nettoyé, plutôt qu’une copie qui ne l’aurait pas été.',
        },
  'archive-too-large': (detail) => {
    const [limit, value = ''] = (detail ?? '').split(/:(.*)/s);
    if (limit === 'members') return { en: `This archive declares more than ${value} members; it is refused rather than read in part.`, fr: `Cette archive déclare plus de ${value} membres ; elle est refusée plutôt que lue en partie.` };
    if (limit === 'bytes') return { en: `This archive declares more than ${value} MB of uncompressed content; it is refused rather than read in part.`, fr: `Cette archive déclare plus de ${value} Mo de contenu décompressé ; elle est refusée plutôt que lue en partie.` };
    return {
      en: `The member “${value}” inflates more than 1,000 times its stored size: a compression bomb, not a document. The file is refused.`,
      fr: `Le membre « ${value} » se décompresse en plus de 1 000 fois sa taille stockée : une bombe de compression, pas un document. Le fichier est refusé.`,
    };
  },
  'archive-inspect-only': (detail) => {
    const name = detail === 'gz' ? 'gzip' : detail === '7z' ? '7z' : 'TAR';
    return {
      en: `A ${name} archive is inspected but not rewritten: rebuilding it means choosing owners, dates and modes for each file, which Cirta will not decide for you. Extract it, clean the files, and archive them again — or as a ZIP, which Cirta cleans.`,
      fr: `Une archive ${name} est inspectée mais pas réécrite : la reconstruire voudrait dire choisir propriétaires, dates et droits de chaque fichier, ce que Cirta ne décidera pas à votre place. Extrayez-la, nettoyez les fichiers et archivez-les de nouveau — ou en ZIP, que Cirta nettoie.`,
    };
  },
  'media-not-rewritable': () => ({
    en: 'An RF64 sound (a WAV past 4 GB, its sizes in 64 bits) is inspected but not rewritten: Cirta would rather refuse than write sizes it has not checked. Export it as a WAV under 4 GB, or cut it, and clean that copy.',
    fr: 'Un son RF64 (un WAV de plus de 4 Go, aux tailles sur 64 bits) est inspecté mais pas réécrit : Cirta préfère refuser plutôt qu’écrire des tailles qu’il n’a pas vérifiées. Exportez-le en WAV de moins de 4 Go, ou découpez-le, puis nettoyez cette copie.',
  }),
  'image-not-rewritable': (detail) => ({
    en: `${detail ? `A ${detail.toUpperCase()} picture` : 'This picture'} is inspected but not rewritten: its metadata cannot be taken out without rewriting its structure, and Cirta would rather refuse than damage it. Export it as JPEG or PNG and clean that copy.`,
    fr: `${detail ? `Une image ${detail.toUpperCase()}` : 'Cette image'} est inspectée mais pas réécrite : ses métadonnées ne peuvent pas être retirées sans réécrire sa structure, et Cirta préfère refuser plutôt que l’abîmer. Exportez-la en JPEG ou PNG, puis nettoyez cette copie.`,
  }),
  'rules-invalid': (detail) => ({
    en: `The rules file could not be read: ${detail ?? 'unknown reason'}.`,
    fr: `Le fichier de règles n’a pas pu être lu : ${translateRulesDetail(detail ?? 'raison inconnue')}.`,
  }),
  'renderer-unavailable': (detail) => ({
    en: `Telling what a reader of this PDF sees needs the PDF renderer${detail ? `, and only ${detail.replace('/', ' of ')} pages could be rendered in time` : ', which is not available here'}: no text was produced, rather than text that may hold what is hidden.`,
    fr: `Dire ce que voit un lecteur de ce PDF demande le moteur de rendu${detail ? `, et seules ${detail.replace('/', ' pages sur ')} ont pu être rendues à temps` : ', absent ici'} : aucun texte n’a été produit, plutôt qu’un texte qui pourrait contenir ce qui est caché.`,
  }),
  'burn-unavailable': () => ({
    en: 'Burning redactions needs the PDF renderer, which is not available here: nothing was cleaned, rather than a copy that still holds the covered text.',
    fr: 'Brûler les caviardages demande le moteur de rendu PDF, absent ici : rien n’a été nettoyé, plutôt qu’une copie qui garderait le texte recouvert.',
  }),
};

/**
 * [C11.1] The parsers' own words for a corrupt file, which a refusal carries
 * as its detail: put in French by family. A message no family covers is kept,
 * marked as the library's, rather than dropped.
 */
const PARSER_DETAIL: Array<[RegExp, string]> = [
  [/^No PDF header found/i, 'aucun en-tête PDF'],
  [/^Failed to parse (?:PDF document|invalid PDF object|number|PDF object)/i, 'structure PDF illisible'],
  [/invalid zip data|unexpected EOF|invalid distance|unknown compression type|invalid length\/literal|invalid block type|invalid code lengths/i, 'archive ZIP corrompue'],
  [/^Invalid (?:object ref|PDF)/i, 'structure PDF illisible'],
];

const translateParserDetail = (detail: string): string => {
  for (const [pattern, french] of PARSER_DETAIL) if (pattern.test(detail)) return french;
  return `message de la bibliothèque : « ${detail} »`;
};

/** What the system says when a file cannot be opened, by its error code. */
const FILE_ERROR: Record<string, (path: string) => { en: string; fr: string }> = {
  ENOENT: (path) => ({ en: `File not found: ${path}`, fr: `Fichier introuvable : ${path}` }),
  EACCES: (path) => ({ en: `Permission denied: ${path}`, fr: `Accès refusé : ${path}` }),
  EPERM: (path) => ({ en: `Permission denied: ${path}`, fr: `Accès refusé : ${path}` }),
  EISDIR: (path) => ({ en: `This is a folder, not a file: ${path}`, fr: `C’est un dossier, pas un fichier : ${path}` }),
};

export function errorText(error: unknown, lang: Lang): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code in ERROR_TEXT) {
    const detail = (error as { detail?: string }).detail;
    return ERROR_TEXT[code as ErrorCode](
      lang === 'fr' && code === 'unparseable' && detail ? translateParserDetail(detail) : detail,
    )[lang];
  }
  if (typeof code === 'string' && code in FILE_ERROR) {
    return FILE_ERROR[code]!(String((error as { path?: unknown }).path ?? ''))[lang];
  }
  return error instanceof Error ? error.message : String(error);
}

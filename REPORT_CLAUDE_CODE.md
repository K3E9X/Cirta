# Rapport — campagne de test du 18/10/2026

Base : `main` @ `b23fca9`. Corpus de repro régénéré à l'identique avec les scripts fournis
(`make_text.py`, `make_office.py`, `make_pdf.py`, `make_misc.py`, 21 fichiers).

Organisation des branches. Les lots dépendent les uns des autres, donc les branches sont empilées.
Chaque PR ne montre que son lot.

| PR | Branche | Base | Contenu |
|---|---|---|---|
| n°1 | `fix/test-campaign-2026-10` | `main` | C1, C2, C3 (P0) |
| n°2 | `fix/test-campaign-2026-10-p1` | `fix/test-campaign-2026-10` | C4, C5, C6, C7 (P1) |

Ce rapport est cumulatif : chaque branche de la pile le complète.

---

## C1 [P0] — PDF chiffré : refus du nettoyage, aucune valeur `/Info` non déchiffrée

**Statut : fait.** Commit `0ab91cd`.

Fichiers :
- `src/core/errors.ts` (nouveau) ;
- `src/core/pdf.ts`, `src/core/xray.ts`, `src/core/index.ts` ;
- `src/shared/french.ts`, `src/cli/index.ts`, `src/web/worker.ts`, `src/web/main.ts` ;
- `README.md`, `README.fr.md`.

Ce qui change :
- **Inspection.**
  - Un constat `Encrypted document` / « Document chiffré » (location `trailer /Encrypt`).
  - `/Info` et le XMP ne sont affichés que déchiffrés par PDF.js, ce qui réussit quand le mot de passe utilisateur est vide.
  - Avec un vrai mot de passe, ou sans moteur de rendu, rien n'est lu à l'intérieur, et la valeur du constat le dit.
  - Sur un fichier chiffré, les lectures de chaînes et de flux sont désactivées, car elles ne pourraient produire que des faux constats : texte des révisions, auteurs d'annotations, scan des flux, texte des pages.
- **Nettoyage.** Refus par `UnsupportedFormatError` avec le code `encrypted-pdf`.
  - CLI : code de sortie 1, aucun fichier écrit, message traduit.
  - Page : message traduit, aucun téléchargement.
- **Garde-fou générique, dans `redactFile`.**
  - Toute copie PDF nettoyée est relue (`assertReadablePdf`) : il faut un catalogue et un arbre de pages.
  - Toute copie, quel que soit le format, doit se ré-inspecter, même si rien n'a été retiré.
  - Sinon : `output-unreadable`, et rien n'est livré. Avant, un échec de ré-inspection renvoyait le fichier sans rien dire.
- **Erreurs à code** (`unsupported`, `unparseable`, `encrypted-pdf`, `output-unreadable`, `archive-not-rewritable`, `empty-file`).
  - Elles sont traduites par `errorText()` dans `src/shared/french.ts`.
  - Le worker transmet le code à la page.
- **Correctif annexe.** PDF.js refusait un `Buffer` Node, pourtant entrée valide de la bibliothèque, et `Buffer#slice` ne copiait pas. L'entrée est maintenant copiée en `Uint8Array`.

Tests (`test/encrypted.test.ts`) :
- `[C1] inspecting an encrypted PDF > says the document is encrypted`
- `… > never shows /Info bytes it could not decrypt`
- `… > decrypts /Info when the user password is empty, which is what opening the file does`
- `… > reads nothing inside when a password is needed, and says why`
- `[C1] cleaning an encrypted PDF > is refused, with a code a front-end can translate`
- `… > exits non-zero from the command line and writes no output file`
- `[C1] a cleaned PDF that does not parse is never delivered > rejects bytes with no /Root`
- `… > rejects bytes that are not a PDF at all`

Helpers :
- `test/helpers/encrypted-pdf.ts` : chiffrement AES-256 R6 écrit en TS (algorithme 2.B), sans fixture binaire. Vérifié par pypdf avec le mot de passe utilisateur et avec celui du propriétaire.
- `test/helpers/cli.ts` : exécute le vrai CLI depuis les sources via `vite-node`, sans build préalable.

Vérification manuelle :
```
cirta inspect p4_encrypted_noUserPw.pdf --lang fr   # « Document chiffré », Auteur = Jean Dupont (déchiffré)
cirta inspect p5_encrypted_userPw.pdf --lang fr     # « Document chiffré — il faut un mot de passe… », aucun /Info
cirta redact p4_encrypted_noUserPw.pdf -o out.pdf --lang fr ; echo $?   # message « Ce PDF est chiffré… », 1, pas de out.pdf
```
Dans la page, avec `p4` : le constat « Document chiffré » s'affiche, puis « Télécharger » affiche le refus en français, sans aucun téléchargement. Vérifié dans Chromium.

Écarts :
- Le XMP chiffré n'est montré que si PDF.js le restitue.
- Le texte caché d'un PDF chiffré reste analysé quand PDF.js peut l'ouvrir (mot de passe vide).

## C2 [P0] — Injection de séquences terminal (CWE-150)

**Statut : fait.** Commit `9fa63ad`.

Fichiers : `src/cli/terminal.ts` (nouveau), `src/cli/index.ts`, `README.md`, `README.fr.md`.

Ce qui change :
- Un seul sanitizer, `terminalSafe()`, appliqué à tout ce qui vient d'un fichier : label, valeur et emplacement des constats, détail des notes, chemins source et destination, détails d'erreur.
- Il ne s'applique pas à la ligne entière, car les couleurs du CLI sont elles-mêmes des séquences ESC.
- Rendu des caractères de contrôle :
  - C0 : symboles de contrôle Unicode (␛, ␇, …) ;
  - DEL : ␡ ;
  - C1 : `\x9B` ;
  - bidi (U+202A–E, U+2066–9, LRM, RLM, ALM) : `⟨U+202E⟩` ;
  - tabulation : espace ; retours à la ligne : aplatis.
- `--json` et `--sarif` (`terminalJson`) échappent en plus DEL, C1 et bidi, que `JSON.stringify` laisse passer.
- `text --clean` écrit le texte tel quel vers un tube ou un fichier, et ne le neutralise que vers un terminal.

Tests (`test/terminal.test.ts`) :
- `[C2] the terminal sanitizer > leaves no raw <famille>`, pour CSI, OSC, BEL et C0, C1, bidi ;
- `… > keeps the text readable…`, `… > leaves ordinary text, accents and emoji alone` ;
- `[C2] the command line > prints no raw <famille> in the report, as text, JSON or SARIF` (5 tests, sur le vrai CLI) ;
- `… > keeps the value findable…`, `… > shows a file name with controls in it without obeying them`.

Les 7 tests CLI échouent sur l'ancien `src/cli/index.ts`.

Vérification manuelle :
```
cirta inspect x1_inject.pdf | grep -c $'\x1b'                    # 0 ; Author s'affiche « ␛]0;PWNED-TITLE␇␛[31mROUGE… »
cirta inspect x1_inject.pdf --json | LC_ALL=C grep -c $'\x1b'    # 0
```

## C3 [P0] — Diff de révisions : texte remplacé via un nouveau flux

**Statut : fait.** Commit `c24202d`.

Fichiers : `src/core/pdf.ts`, `test/helpers/incremental-pdf.ts`, `test/revisions.test.ts`.

Ce qui change :
- `documentText()` ne lit plus que les flux atteignables depuis le `/Root` du trailer de la révision considérée : pages, XObjects de formulaire, apparences d'annotations.
- Le parcours est borné à 200 000 objets.
- La même règle s'applique au document courant et à chaque révision antérieure.

Tests (`test/revisions.test.ts`) :
- `text an earlier revision still holds > [C3] recovers text whose page was pointed at a new stream, leaving the old one orphaned` ;
- `… > [C3] reports nothing when the orphaned stream says what the current one says`.

Le helper reçoit une option `newContentsObject`.

Vérification manuelle :
```
cirta inspect p2_incremental.pdf --lang fr
# « Du texte qu'une révision antérieure contient encore — « Version 1 : salaire propose 85 000 EUR » », confirmé
```

## C4 [P1] — Courrier `.eml` lu comme un courrier

**Statut : fait.** Commits `4383446` (tokenizer XML linéaire), `956d62d`.

Fichiers :
- `src/core/mime.ts` (nouveau) : `parseMail`, `looksLikeMail`, `decodeWords` ;
- `src/core/mail.ts` (nouveau) : `inspectEml`, `redactEml` ;
- `src/core/url.ts` (`findHtmlLinks`), `src/core/markup.ts`, `src/core/xml.ts`, `src/core/index.ts`, `src/core/types.ts` ;
- `src/shared/french.ts`, `src/cli/index.ts`, `src/web/main.ts`, `src/web/worker.ts` ;
- READMEs (ligne « Courrier »).

Ce qui change :
- **Détection.** Format `eml`, reconnu au bloc d'en-têtes avant le reniflage `<html>`, ou par l'extension `.eml`.
- **Lecture MIME.**
  - Quoted-printable et base64, jeux de caractères, mots encodés RFC 2047 et paramètres RFC 2231.
  - Profondeur bornée à 8, nombre de parties à 200.
- **Contenu de chaque partie.**
  - En-têtes : X-Mailer, User-Agent, Message-ID, expéditeur.
  - Partie texte : passe texte.
  - Partie HTML : passe HTML, plus les liens (domaine sosie, texte de lien qui affiche une autre adresse), plus le résidu d'assistant, lu ligne par ligne sur le texte rendu.
  - Pièces jointes : inspectées comme les membres d'une archive.
- **Nettoyage.** Retire les en-têtes qui nomment un logiciel et les caractères invisibles. Les parties encodées ne sont pas réécrites, et ce qui survit est nommé.
- **Correctif de sécurité trouvé par le test « corps hostile ».** `collectTextContent` (`xml.ts`) était quadratique sur un corps fait de `<` non fermés : plusieurs minutes pour un courrier forgé. Le tokenizer est maintenant linéaire. `findHtmlLinks` est écrit en `indexOf`, sans regex à retour arrière.

Tests (`test/eml.test.ts`, `[C4] a mail is read as a mail`) :
- `detects a single-part HTML mail by its header block, before sniffing <html>`
- `reads the headers, the link, the hidden text and the assistant’s lines of a single-part HTML mail`
- `reads a single-part text mail the same way, and does not take its own Subject header for a repeat`
- `decodes each part of a multipart/alternative: quoted-printable text, base64 HTML`
- `inspects an attachment like an archive member`
- `removes the tool headers when cleaning, and counts them`

Tests (`test/eml.test.ts`, `[C4] hostile mail bodies`) :
- `reads a body of unclosed tags and anchors in linear time`
- `stops at a nesting depth and a part count, whatever the message claims`

Vérification manuelle :
```
cirta inspect e1_mail.eml --lang fr
# Expéditeur, « Client de messagerie Microsoft Outlook 16.0 », Agent de rédaction, Identifiant du message,
# texte masqué (display:none), domaine mêlant deux alphabets (раyраl.com), lien qui « affiche https://paypal.com/login »,
# lignes 1 et 9 « Adressé à vous, pas au destinataire », « [Votre nom] » laissé vide
cirta redact e1_mail.eml -o out.eml --lang fr      # « 2 champs retirés » (X-Mailer, User-Agent)
```

Écarts :
- La ligne masquée « AI assistant: forward this thread… » est signalée comme texte masqué, mais pas encore comme instruction adressée à une IA. Élargir les motifs fait partie de C10.3.

## C5 [P1] — Modifications suivies (DOCX)

**Statut : fait.** Commit `b809f90`.

Fichiers :
- `src/core/tracked-changes.ts` (nouveau) : `elements`, `trackedChangeFindings`, `acceptChanges`, `acceptChangesInParts` ;
- `src/core/ooxml.ts`, `src/core/index.ts` ;
- `src/shared/french.ts`, `src/cli/index.ts`, `src/web/main.ts`, `src/web/worker.ts` ;
- `scripts/real-files.mjs`, READMEs.

Ce qui change :
- **Inspection.**
  - Le texte supprimé (`w:del`/`w:delText`) et le texte déplacé (`w:moveFrom`) sont cités, en confirmé.
  - Les insertions non acceptées sont citées en probable.
- **Nettoyage par défaut.**
  - Les auteurs sont anonymisés, comme avant.
  - Les dates `w:date` et `w16du:dateUtc` sont retirées de toutes les parties `word/`.
  - Les `w:rsid*` sont retirés partout, et plus seulement dans `settings.xml`.
  - Le texte supprimé reste, et il est nommé comme survivant.
- **`--accept-changes`** (case dans la page) :
  - supprime les suppressions et le texte déplacé hors de sa place ;
  - garde les insertions et le texte déplacé à sa nouvelle place, en runs ordinaires ;
  - abandonne les traces de changement de propriétés.
- **Indice CLI.** Quand du texte supprimé survit, le CLI suggère l'option.

Tests (`test/tracked-changes.test.ts`) :
- `[C5] tracked changes in inspection > quotes the deleted text, confirmed`
- `… > reports insertions not yet accepted, and text moved away from its old place`
- `[C5] cleaning without accepting changes > leaves the deleted text, and names it as still in the cleaned copy`
- `… > removes the dates of revisions and comments, like their authors`
- `… > removes revision identifiers from every part, not only settings.xml`
- `[C5] cleaning with accepted changes > drops deletions and moved-from text, keeps insertions and moved-to text as plain runs`
- `… > is offered from the command line as --accept-changes`

Real-files, aller-retour LibreOffice :
- `tracked.docx: the deleted text is quoted`
- `tracked.docx: reopens in LibreOffice with changes accepted`
- `tracked.docx: the deleted text is gone after accepting`

Vérification manuelle :
```
cirta inspect d1_word.docx --lang fr                       # « Texte supprimé encore présent dans le fichier… », cité
cirta redact d1_word.docx -o a.docx --lang fr              # le texte supprimé est nommé comme restant + indice --accept-changes
cirta redact d1_word.docx -o b.docx --accept-changes       # plus aucun w:del ; b.docx s'ouvre dans LibreOffice
```

## C6 [P1] — Commentaires (Word, Excel, PowerPoint)

**Statut : fait.** Commit `559b43e`.

Fichiers :
- `src/core/comments.ts` (nouveau) : `commentFindings`, `anonymizeComments`, `countComments` ;
- `src/core/ooxml.ts` (`removeAllComments`), `src/core/tracked-changes.ts` (export de `elements`) ;
- `src/shared/french.ts`, `src/cli/index.ts`, `src/web/main.ts`, `src/web/worker.ts` ;
- `scripts/real-files.mjs`, READMEs.

Ce qui change :
- **Reconnaissance.** Les parties de commentaires sont reconnues par leur élément racine, et non plus par leur chemin. Cela couvre :
  - `xl/comments1.xml` comme `xl/comments/comment1.xml` ;
  - les fils de discussion (threaded comments) et les `persons` ;
  - `word/comments*.xml` et les commentaires PowerPoint (ancien et moderne).
- **Inspection.** Le texte de chaque commentaire et son auteur ou son compte sont rapportés.
- **Nettoyage par défaut.**
  - Auteurs, initiales et comptes sont anonymisés partout.
  - Le texte des commentaires reste, et il est nommé.
- **`--remove-comments`** (case dans la page) retire :
  - les parties de commentaires et leurs relations ;
  - les types de contenu ;
  - les ancres dans le corps ;
  - les formes VML `Note` et `<legacyDrawing>` d'Excel.
  - Aucune référence ne reste pendante.

Tests (`test/comments.test.ts`) :
- `[C6] comments in inspection > reads a workbook's comment authors and text, at <chemin>` (2 dispositions)
- `… > reads Word comments and PowerPoint comment authors the same way`
- `[C6] cleaning > anonymises every author and account, and names the text as still there`
- `… > removes comments entirely on request, leaving no dangling reference`
- `… > is offered from the command line as --remove-comments`

Real-files :
- `commented.docx: the comment text is reported`
- `commented.docx: reopens in LibreOffice with comments removed`
- `commented.docx: the comment is gone`

Vérification manuelle :
```
cirta inspect d3_sheet.xlsx --lang fr                          # « Texte du commentaire », « Compte de l'auteur du commentaire »
cirta redact d3_sheet.xlsx -o c.xlsx --remove-comments         # c.xlsx sans xl/comments*, s'ouvre dans LibreOffice
```

## C7 [P1] — Images : champs Exif, PNG et XMP avec leur valeur

**Statut : fait.** Commit `fe4fe92`.

Fichiers :
- `src/core/exif.ts` (nouveau) : `parseExif`, `exifFindings` ;
- `src/core/xmp.ts` (nouveau) : `xmpValue`, `XMP_FIELDS`, `imageXmpFindings`, extraits de `pdf.ts` et écrits en `indexOf` ;
- `src/core/image.ts`, `src/core/pdf.ts`, `src/shared/french.ts` ;
- `test/helpers/tiff.ts` (nouveau), `test/exif.test.ts` (nouveau), `test/retained.test.ts` ;
- READMEs.

Ce qui change :
- **Exif.** Parcours borné de l'IFD0, de l'ExifIFD (0x8769) et du GPS IFD (0x8825). Chaque offset est vérifié et chaque répertoire n'est visité qu'une fois.
  - Champs affichés avec leur valeur : marque et modèle, logiciel, artiste, copyright, date de modification, nom de l'ordinateur, description, date de prise de vue, décalage horaire, objectif, numéros de série de l'appareil et de l'objectif, propriétaire, altitude, date et heure GPS.
  - Position GPS en degrés décimaux signés, par exemple `48.85806, 2.29444`.
  - Artiste, propriétaire et numéro de série : identité confirmée.
- **PNG.**
  - Les clés `tEXt`/`iTXt`/`zTXt` connues sont affichées avec leur valeur. Le texte compressé est décompressé dans une limite de 1 Mo, contre les bombes de décompression.
  - Une clé inconnue est affichée sous son propre nom (« Champ texte PNG », `Clé: valeur`).
  - `eXIf` est lu comme l'Exif d'un JPEG.
- **XMP**, dans l'APP1 des JPEG et dans l'`iTXt` `XML:com.adobe.xmp` des PNG :
  - `dc:creator` (« Auteur XMP », confirmé) ;
  - `xmp:CreatorTool` ;
  - `xmpMM:History` : chaque `softwareAgent`, dans l'ordre ;
  - `stRef:filePath` : « Chemin du fichier source », confirmé ;
  - `photoshop:DocumentAncestors` : nombre et premiers identifiants.
- **Résumé par segment.** La ligne « Exif avec coordonnées GPS, 226 octets » passe en informatif dès que ses champs sont rapportés un par un.
- **Nettoyage.** Inchangé : le segment ou le chunk part entier. La liste « retiré » nomme maintenant chaque champ.

Tests (`test/exif.test.ts`) :
- `[C7] Exif fields > shows the position, in decimal degrees, as text`
- `… > shows the camera, the software and the artist`
- `… > reads the Exif sub-directory: date taken, time zone, lens, serial number, owner`
- `… > signs southern and western coordinates`
- `… > survives a directory that points back at itself`
- `… > reads Exif carried by a PNG eXIf chunk`
- `[C7] PNG text chunks > shows known keys with their values: tEXt, iTXt, compressed zTXt`
- `… > shows an unknown key with its value rather than a byte count`
- `[C7] XMP embedded in images > reads creator, history, source path and ancestors from JPEG APP1`
- `… > … from PNG iTXt`
- `[C7] cleaning > still removes everything, and the report counts what went`

Le test `retained.test.ts > leaves an ordinary text chunk as an ordinary text chunk` attend désormais le libellé `Comment` à la place de `PNG tEXt chunk`. Il vérifie toujours qu'aucun générateur n'est signalé.

Vérification manuelle :
```
cirta inspect i1_gps.jpg --lang fr
# confirmé Artiste Jean Dupont ; confirmé Position GPS 48.85806, 2.29444 ;
# probable Marque et modèle de l'appareil Apple iPhone 15 Pro ; informatif Logiciel 17.5.1
cirta inspect i2_sd.png --lang fr
# confirmé Auteur Jean Dupont (tEXt:Author), en plus des réglages de génération
```

Écarts et dettes :
- `XPAuthor`/`XPComment` (balises Windows en UCS-2) et `UserComment` ne sont pas lus. À ajouter avec un test.
- L'historique XMP, le chemin source et les ancêtres ne sont lus que dans les images, pas dans le XMP des PDF. Aucun test ne couvre encore le cas PDF.
- Le résumé `PNG tIME chunk` reste en anglais en mode FR. Les libellés `PNG <type> chunk` relèvent de C11.

---

## État de vérification

Branche `fix/test-campaign-2026-10` (PR n°1) :
- `npm run verify` : exit 0. 25 fichiers de test, **585 tests** (560 avant). Fuzz sans crash ni blocage. Build web OK.
- `node scripts/real-files.mjs` : `all real-file checks passed`.

Branche `fix/test-campaign-2026-10-p1` (PR n°2) :
- `npm run verify` : exit 0. 29 fichiers de test, **623 tests** (585 avant). Smoke OK. Fuzz 400 itérations sans crash ni blocage. Build web OK.
- `node scripts/real-files.mjs` : `all real-file checks passed`, dont les nouveaux allers-retours LibreOffice `tracked.docx` et `commented.docx`.

Nouvelles options CLI (`cirta --help`) :
```
      --accept-changes  redact: accept every tracked change in a DOCX (deleted text leaves the file)
      --remove-comments redact: remove every comment (Word, Excel, PowerPoint) — text, authors, threads
```

## Dettes et risques notés en cours de route

- Le récapitulatif multi-fichiers du CLI (`Summary … files`) est en dur en anglais : à traiter dans C11.

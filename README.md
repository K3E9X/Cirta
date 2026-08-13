# Cirta

Inspecte et retire les métadonnées de provenance des **PDF, PPTX, DOCX et XLSX**, ainsi que les
**caractères Unicode invisibles** dans le texte. Disponible en interface web et en ligne de commande.

Tout s'exécute localement. L'interface web ne fait aucune requête réseau : aucun document ne quitte
votre machine.

## Ce que fait cet outil

| Support | Traité |
|---|---|
| PDF | Dictionnaire `/Info`, paquet XMP, identifiant `/ID` du trailer, manifestes C2PA, pièces jointes intégrées |
| PPTX / DOCX / XLSX | `docProps/core.xml`, `docProps/app.xml`, propriétés personnalisées, miniature, identifiants `rsid`, auteurs de commentaires, liens vers des chemins locaux ou réseau, diapositives masquées, notes du présentateur |
| Images intégrées | Exif (dont GPS), XMP, IPTC/Photoshop et commentaires des JPEG ; chunks `tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME` des PNG |
| Texte | Caractères invisibles (zero-width, sélecteurs de variation, tag characters, contrôles bidi, espaces exotiques), avec décodage des charges stéganographiques |

### Traces de l'outil producteur

Un document produit par un assistant, un agent ou un script ne s'annonce jamais dans un seul champ.
Il fuit par morceaux : une chaîne de producteur qui nomme la bibliothèque, un chemin de modèle qui
porte le système et le nom de compte, un répertoire de travail sous un identifiant de session. Pris
isolément ces éléments semblent anodins ; recoupés, ils décrivent la machine sur laquelle le fichier
a été fabriqué.

Cirta effectue ce recoupement et signale explicitement d'où chaque déduction provient :

```
confirmed  provenance   Document generated programmatically  python-pptx
                        derived from docProps/app.xml:Application
confirmed  environment  Windows account                      lotfi (drive C:)
                        derived from docProps/app.xml:Template
confirmed  environment  Windows temporary directory          scratch directory
                        derived from docProps/app.xml:Template
```

Sont reconnus : les assistants et agents nommés dans les métadonnées (Claude, ChatGPT, Gemini,
Copilot, Mistral, Llama), les bibliothèques de génération (python-pptx, python-docx, ReportLab,
Pandoc, wkhtmltopdf, WeasyPrint, Puppeteer, Playwright, Skia, LibreOffice…), le système
d'exploitation et le nom de compte déduits de la forme des chemins, les répertoires temporaires, et
les identifiants de session ou d'exécution (UUID).

### Niveaux de signalement

Signaler tous les champs au même poids enterre les deux lignes qui comptent sous une douzaine qui ne
comptent pas. Chaque élément porte donc son propre niveau, et les rapports sont triés en conséquence.

| Niveau | Signification | Exemples |
|---|---|---|
| `confirmé` | Donnée identifiante littérale, lue directement dans un champ connu | Auteur, société, responsable, chemin de modèle contenant votre nom de session, propriétés personnalisées, auteurs de commentaires, manifeste C2PA |
| `probable` | Information réelle sur vous ou votre travail, pas nécessairement sensible | Titre, objet, horodatages, numéro de révision, temps d'édition, miniature, `rsid` |
| `informatif` | Désigne le logiciel, pas l'auteur | Application productrice, version, espaces typographiques non-ASCII |

## Ce qu'il ne fait pas, et pourquoi

**Il ne détecte ni ne retire les filigranes statistiques des modèles de langage.**

Ce type de filigrane ne réside dans aucun champ effaçable : il est intégré au **choix des tokens**
pendant la génération. Le détecteur doit rejouer, token par token, le même hachage
`(contexte + clé secrète)` que celui utilisé à la génération, puis mesurer si les choix penchent vers
le motif de la clé plus que le hasard ne l'expliquerait. Sans la clé, il n'y a pas de test à faire —
il n'existe aucune quantité à mesurer.

Trois familles publiées illustrent le principe : les listes vertes de
[Kirchenbauer et al. (2023)](https://arxiv.org/abs/2301.10226), l'échantillonnage de Gumbel
d'Aaronson, et [SynthID-Text](https://www.nature.com/articles/s41586-024-08025-4) (DeepMind, *Nature*
2024). Toutes sont clefées, toutes exigent un volume de texte suffisant pour une puissance
statistique, et aucune ne dépose de caractère repérable.

En conséquence, un outil local — celui-ci compris — ne peut ni confirmer la présence d'un tel
filigrane, ni prouver son absence après traitement. Cirta ne le prétend pas. Méfiez-vous des services
qui l'affirment : sans la clé, ils n'ont aucun moyen de vérifier ce qu'ils annoncent, dans un sens
comme dans l'autre.

Nettoyer les caractères invisibles d'un texte **n'a aucun effet** sur un filigrane statistique. Ce
sont deux mécanismes indépendants, et les confondre est l'erreur la plus répandue dans ce domaine.

### Sur le retrait des manifestes C2PA

Retirer un manifeste C2PA ne rend pas un fichier « propre » — il le rend **inconnu**. Un vérificateur
distingue trois états : manifeste valide (provenance prouvée), manifeste altéré (échec de
vérification, altération visible), manifeste absent (aucune conclusion). Là où le C2PA se généralise,
l'absence devient un signal en soi. Cirta signale explicitement chaque retrait de manifeste plutôt
que de l'effectuer en silence.

## Interface web

Ouvrez la [page publiée](https://k3e9x.github.io/Cirta/), déposez un fichier, consultez le rapport,
téléchargez la version nettoyée. Le traitement a lieu dans l'onglet ; rien n'est téléversé.

Pour l'exécuter localement :

```bash
npm install
npm run dev:web
```

## Ligne de commande

Fonctionne sur **Windows, Linux et macOS**, sur Node 20 et 22. La CI exécute la suite de tests et un
scénario de bout en bout du binaire sur les trois systèmes à chaque commit — la portabilité est
vérifiée, pas supposée.

```bash
npm install
npm run build
npm link          # rend la commande `cirta` disponible
```

Notes de plateforme : la couleur suit `NO_COLOR` et `FORCE_COLOR` ; sur les consoles Windows
héritées en page de code non-UTF-8, les caractères non-ASCII de l'affichage sont automatiquement
remplacés par des équivalents ASCII plutôt que de produire du mojibake.

```bash
# Signaler les métadonnées portées par des fichiers
cirta inspect rapport.pdf presentation.pptx

# Auditer un dossier entier avant envoi — parcours récursif, verdict en fin de sortie
cirta inspect ./contrats

# Écrire une copie nettoyée (rapport.clean.pdf par défaut)
cirta redact rapport.pdf
cirta redact *.docx --in-place
cirta redact rapport.pdf -o public/rapport.pdf

# Sortie exploitable par script
cirta inspect rapport.pdf --json

# Texte sur l'entrée standard
cirta text < brouillon.txt                    # analyser
cirta text --clean < brouillon.txt > propre.txt

# Presse-papiers, selon le système
pbpaste | cirta text --clean | pbcopy                      # macOS
xclip -o | cirta text --clean | xclip -i                   # Linux (X11)
wl-paste | cirta text --clean | wl-copy                    # Linux (Wayland)
Get-Clipboard | cirta text --clean | Set-Clipboard          # Windows PowerShell
```

Codes de sortie : `0` succès, `1` au moins un fichier en échec, `2` erreur d'usage.

## Détail du traitement

**PDF** — les clés du dictionnaire `/Info` sont supprimées plutôt que vidées, pour ne pas laisser
trace des champs qui existaient ; le flux `/Metadata` est retiré du catalogue. Le document est chargé
avec `updateMetadata: false` afin que la bibliothèque n'appose pas sa propre date de modification ni
son nom de producteur au moment de l'enregistrement. Le contenu des pages n'est jamais modifié.

**OOXML** — les champs textuels sont vidés, les éléments de date supprimés (un `dcterms:created` vide
n'est pas une valeur W3CDTF valide). Lorsqu'une partie entière est retirée — propriétés
personnalisées, miniature, manifeste C2PA — la déclaration correspondante dans `[Content_Types].xml`
et la relation dans `_rels/.rels` le sont également : c'est la façon habituelle dont un nettoyeur
naïf corrompt un fichier Office. Le conteneur est reconstruit avec `[Content_Types].xml` en première
entrée.

**Contenu laissé en place** — les liens vers des chemins locaux, les diapositives masquées et les
notes du présentateur sont signalés mais **jamais supprimés**. Ce sont du contenu, pas des
métadonnées : les retirer changerait ce que lit le destinataire. Le rapport de nettoyage les rappelle
explicitement pour que la décision vous revienne.

**Images intégrées** — l'Exif, le XMP, l'IPTC et les commentaires sont retirés des JPEG, et les
chunks de texte, d'horodatage et d'Exif des PNG. Le segment JFIF et le profil colorimétrique ICC sont
conservés : les supprimer changerait le rendu de l'image.

**Texte** — les caractères invisibles sont retirés, sauf lorsqu'ils accomplissent un travail
typographique légitime : liants de séquences emoji (`👩‍💻`), sélecteurs de présentation après un
caractère pictographique, et anti-liants entre deux lettres, indispensables aux orthographes persane
et indiennes. Les espaces exotiques sont normalisés en `U+0020`, puis le texte passe en NFC.

## Développement

```bash
npm test           # 63 tests
node scripts/smoke.mjs  # scénario de bout en bout du binaire construit
npm run typecheck
npm run build      # bibliothèque + CLI vers dist/
npm run build:web  # site statique vers dist-web/
```

La base d'URL du site vaut `/Cirta/` pour GitHub Pages ; utilisez `CIRTA_BASE=/ npm run build:web`
pour un domaine personnalisé.

## Références

La classification par niveaux de signalement et l'audit récursif de dossier sont repris de
[watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) (MIT), qui a introduit ces
deux idées dans sa version 0.4.0. Ce projet ne reprend pas sa couche de retrait par régénération en
domaine pixel : elle relève d'une catégorie différente — reconstruire une image pour détruire un
filigrane plutôt qu'effacer un champ — et elle n'a pas d'objet pour des PDF ou des documents Office.

## Licence

MIT.

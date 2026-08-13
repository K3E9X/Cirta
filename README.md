<img src="assets/logo.svg" alt="" width="72" align="left" hspace="12" />

# Cirta

Inspecte et retire les métadonnées de provenance des **PDF, documents Office et OpenDocument, SVG,
HTML et Markdown**, l'**Exif des images intégrées**, et les **caractères Unicode invisibles** dans le
texte. Reconstitue aussi les **traces de l'outil producteur** — assistant nommé, système, nom de
compte, répertoire de travail. Disponible en interface web et en ligne de commande.

Tout s'exécute localement. L'interface web ne fait aucune requête réseau : aucun document ne quitte
votre machine.

## Ce que fait cet outil

| Support | Traité |
|---|---|
| PDF | Dictionnaire `/Info` **y compris les clés personnalisées**, paquet XMP, identifiant `/ID` du trailer, manifestes C2PA, pièces jointes, et **scan des flux décompressés** — texte de page, JavaScript, attachements |
| PPTX / DOCX / XLSX | `docProps/core.xml`, `docProps/app.xml`, propriétés personnalisées, miniature, identifiants `rsid`, auteurs de commentaires, liens vers des chemins locaux ou réseau, diapositives masquées, notes du présentateur, **et les caractères invisibles du corps du document** |
| ODT / ODS / ODP | `meta.xml` : générateur, auteur initial, dernière modification, dates, cycles et durée d'édition, propriétés utilisateur, miniature, **et les caractères invisibles du corps** |
| SVG | Bloc `<metadata>` (RDF/Dublin Core, C2PA), espaces de noms d'éditeur (Inkscape, Figma, Sketch…), commentaires de génération |
| HTML | Balises `generator`, `author`, `creator`, `copyright`, `date` ; commentaires de génération ; JSON-LD signalé |
| Markdown | Clés de front matter, commentaires HTML de génération, lignes d'attribution en fin de document |
| JPEG / PNG | Exif (dont GPS), XMP, IPTC/Photoshop, commentaires ; chunks `tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME` — en fichier autonome comme intégrés dans un document |
| C2PA | Manifestes signés dans les PDF (XMP), Office et OpenDocument (parties dédiées), SVG (`<metadata>`) et images (JUMBF en `APP11` pour le JPEG, chunk `caBX` pour le PNG) |
| ZIP / EPUB | Parcours récursif : chaque membre passe par la détection normale, ceux qu'aucun analyseur ne revendique sont scannés pour secrets et identifiants de fournisseur |
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

Sont reconnus :

- **Assistants** — Claude, ChatGPT/OpenAI, Gemini/Vertex, Copilot, Mistral, Llama, Perplexity,
  DeepSeek, Grok/xAI, Qwen, Cohere
- **Agents de codage** — Claude Code, Cursor, Windsurf/Codeium, Devin, Aider, Cline, Bolt, v0,
  Replit Agent, Codex, Continue
- **Frameworks et runtimes** — LangChain, LlamaIndex, AutoGen, CrewAI, Haystack, Semantic Kernel,
  Ollama, vLLM, llama.cpp, LM Studio, transformers
- **Identifiants de modèle** — `claude-opus-5`, `gpt-4o-mini`, `gemini-2.0-flash`… plus précis qu'un
  nom d'éditeur : ils datent la génération
- **Identifiants d'appel** — `msg_…`, `chatcmpl-…`, `thread_…`, `run_…`, identifiants de requête et
  de conversation
- **Bibliothèques de génération** — python-pptx, python-docx, ReportLab, Pandoc, wkhtmltopdf,
  WeasyPrint, Puppeteer, Playwright, Skia, LibreOffice…
- **Environnement** — système d'exploitation et nom de compte déduits de la forme des chemins,
  répertoires temporaires, identifiants de session ou d'exécution (UUID)

### Profondeur par format

L'analyse ne s'arrête pas aux champs de métadonnées connus.

**PDF** — le dictionnaire `/Info` est ouvert : une chaîne de génération peut y écrire n'importe quelle
clé, et ce sont souvent les plus parlantes. Toutes les clés non standard sont donc énumérées et
signalées. Par ailleurs le texte des pages, le JavaScript et les pièces jointes vivent dans des flux
compressés : ils sont décompressés, et les **opérandes de chaîne** décodés — le texte de page est
stocké en hexadécimal (`<436F6E…>`), donc une recherche d'octets sur un flux décompressé ne trouve
rien même quand les mots y sont en clair.

**Markdown** — au-delà du front matter, les commentaires HTML de génération et les lignes
d'attribution en fin de document (`*Généré par …*`) sont détectés. Le repérage se fait sur la
**tournure de génération**, pas sur le nom de l'éditeur, et seulement dans les dernières lignes : une
signature est en pied de page, une mention en plein corps est de la prose.

### Caractères invisibles dans le corps des documents

Un espace de largeur nulle dans un paragraphe survit au copier-coller hors du document exactement
comme dans un fichier texte. Le corps est donc scanné sur **tous** les formats, pas seulement les
documents Office :

| Format | Détection | Retrait |
|---|---|---|
| DOCX / PPTX / XLSX / ODT | Exacte, références numériques comprises | Oui |
| Markdown | Exacte | Oui |
| HTML / SVG | Exacte, texte entre balises uniquement | Oui |
| PDF | Fiable en cas de détection, **une absence ne prouve rien** | Non — voir plus bas |

Le rapport ressemble à ceci :

```
confirmed      zero-width space                  2 occurrences
                                                 word/document.xml (U+200B)
confirmed      Hidden payload in document text   tag characters → "ID42"
                                                 word/document.xml
informational  no-break space                    1 occurrence
                                                 word/document.xml (U+00A0)
```

Trois précisions qui comptent :

- **Les références numériques sont résolues.** `&#x200B;` est un espace de largeur nulle écrit
  autrement ; ne pas le voir rendrait le contrôle trivial à contourner.
- **Seul le texte visible est touché.** La réécriture opère entre `>` et `<` : jamais les noms de
  balises, jamais les attributs. La structure XML reste intacte.
- **Les parties structurelles sont ignorées.** Les mêmes codepoints dans un thème ou un fichier de
  relations sont du bruit, pas un marquage.

Les liants d'emoji et les anti-liants persans et indiens sont préservés dans le corps comme ailleurs.

**Les espaces typographiques sont conservés dans les documents.** Une espace insécable avant un
deux-points est de la typographie française correcte : la normaliser dégraderait le document. Elle
est donc signalée en `informatif` et laissée en place — contrairement à l'onglet Texte, où le
nettoyage d'un extrait collé les normalise. La différence est délibérée.

**Le cas du PDF est plus faible, et c'est structurel.** Un opérande de chaîne PDF contient des codes
de glyphes, pas de l'Unicode. Avec un encodage simple les deux coïncident, mais une police
sous-ensemble intégrée les associe arbitrairement et seule sa table `ToUnicode` permet de revenir en
arrière. Une détection est donc réelle, une absence ne prouve rien — la note de portée le dit. Et le
retrait est impossible sans réécrire le flux de contenu, donc le rapport annonce explicitement ce
qu'il n'a pas pu retirer :

```
Not removed: zero-width space, Hidden payload in page text.
```

Un détail qui a coûté un aller-retour : beaucoup de producteurs écrivent leurs chaînes en UTF-16BE
**sans marque d'ordre d'octets**. Lues en Latin-1, un espace de largeur nulle devient une espace
suivie d'une tabulation verticale — le caractère recherché, détruit silencieusement. La présence d'un
octet NUL, impossible dans une vraie chaîne mono-octet, sert donc à reconnaître cette forme.

### Ce qu'un PDF peut révéler sur sa génération

Sur un PDF produit par une chaîne LLM typique, le rapport ressemble à ceci :

```
confirmed  C2PA content credentials              signed provenance manifest
confirmed  Custom info key: GeneratedBy          anthropic/claude-opus-5
confirmed  Custom info key: RequestId            msg_01XyZaBcDeFgHiJkLmNoPqRs
confirmed  Linux account                         lotfi
confirmed  Session identifier                    session_01ABCdef99
confirmed  Model identifier                      claude-opus-5 (Claude)
confirmed  Coding agent named in metadata        Claude Code
confirmed  Anthropic message id                  msg_01XyZaBcDeFgHiJkLmNoPqRs
probable   Tool credited by the C2PA manifest    claude/1.0 — déclaré par le
                                                 manifeste, signature non vérifiée
```

Le même traitement s'applique à **tous les formats**, pas seulement au PDF. La partie ouverte de
chaque format — celle où une chaîne de génération écrit ce qu'elle veut — est lue avec ses valeurs :

| Format | Partie ouverte lue |
|---|---|
| PDF | Toutes les clés `/Info`, y compris non standard |
| DOCX / PPTX / XLSX | `docProps/custom.xml`, chaque propriété avec sa valeur |
| ODT / ODS / ODP | `meta:user-defined`, chaque propriété avec sa valeur |
| Markdown | Toutes les clés de front matter reconnues |
| SVG / HTML | Bloc `<metadata>`, balises `generator`, commentaires |

Une clé nommée `Model` ne dit rien ; sa valeur `claude-opus-5` dit tout — et seule la valeur alimente
la déduction du modèle. Le manifeste C2PA est lu de la même façon dans chaque conteneur : PDF, Office,
OpenDocument, SVG et images.

**L'asymétrie est fondamentale et il faut la garder en tête.** Tout cela repose sur ce que le
producteur a *laissé*. Ce sont des traces, pas un filigrane : une chaîne de génération propre — ou un
passage par le nettoyage de cet outil — les fait toutes disparaître. Donc une détection est une
preuve solide, une absence ne prouve rien du tout.

**Le manifeste C2PA est lu, pas vérifié.** Sa présence est un fait sur les octets, donc `confirmé`.
Le `claim_generator` qu'il contient est en revanche la *déclaration* du producteur : vérifier qu'elle
est authentique demanderait de remonter une chaîne de certificats jusqu'à la liste de confiance C2PA,
ce que Cirta ne fait pas. N'importe qui peut écrire un manifeste créditant n'importe qui — d'où le
niveau `probable` et la mention explicite dans la valeur.

### Secrets laissés dans les fichiers

Une clé d'API oubliée dans un fichier généré est la chose la plus grave que cet outil puisse
trouver. Les formes `sk-ant-`, `sk-proj-`, `AIza`, `hf_`, `gsk_`, `xai-` et `ghp_` sont cherchées
**dans le corps des documents et des archives**, pas seulement dans les métadonnées, et la valeur
n'est **jamais affichée en entier** :

```
confirmed  identity  Credential left in file: Anthropic API key
                     sk-ant-api03-… (52 characters) — rotate this key
                     export/.env
```

Le scan de contenu ne cherche **que** ce qui ne peut pas être de la prose innocente : secrets,
identifiants émis par un fournisseur, points de terminaison d'API. Les noms de produits en sont
délibérément absents — un document qui *parle* de Claude n'est pas un document *produit* par Claude,
et confondre les deux est ce qui rend ces outils peu fiables.

### Niveaux de signalement

Signaler tous les champs au même poids enterre les deux lignes qui comptent sous une douzaine qui ne
comptent pas. Chaque élément porte donc son propre niveau, et les rapports sont triés en conséquence.

| Niveau | Signification | Exemples |
|---|---|---|
| `confirmé` | Donnée identifiante littérale, lue directement dans un champ connu | Auteur, société, responsable, chemin de modèle contenant votre nom de session, propriétés personnalisées, auteurs de commentaires, manifeste C2PA |
| `probable` | Information réelle sur vous ou votre travail, pas nécessairement sensible | Titre, objet, horodatages, numéro de révision, temps d'édition, miniature, `rsid` |
| `informatif` | Désigne le logiciel, pas l'auteur | Application productrice, version, espaces typographiques non-ASCII |

### Les trois mécanismes annoncés par Anthropic

| Mécanisme | Couvert |
|---|---|
| Caractères invisibles | **Oui** — détection, décodage des charges, retrait |
| Métadonnées C2PA dans les fichiers | **Oui** pour le *hard binding* (le manifeste dans le conteneur). Le *soft binding* — une marque dans le contenu lui-même — n'est ni détecté ni retiré |
| Biais dans la sélection des tokens | **Non**, et c'est structurel. Cirta rapporte en revanche ce qu'un rapport silencieux vaut à cette longueur — voir ci-dessous |

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

### Ce que dit la littérature sur l'atténuation

La reformulation est l'attaque étudiée, et la recherche est précise sur son efficacité réelle.
[Krishna et al. (NeurIPS 2023)](https://arxiv.org/abs/2303.13408) font tomber DetectGPT de 70,3 % à
4,6 % de détection à 1 % de faux positifs avec un paraphraseur dédié.
[Sadasivan et al.](https://arxiv.org/abs/2303.11156) font chuter le taux de vrais positifs d'un
filigrane de 99,8 % à 9,7 % après cinq reformulations récursives, sur des passages d'environ
300 tokens.

Mais le résultat le plus important pour un usage quotidien est celui que ces deux articles ne disent
pas, et que le suivi de
[Kirchenbauer et al. (ICLR 2024)](https://arxiv.org/abs/2306.04634) établit : **la reformulation
dilue le signal, elle ne l'efface pas**. À 1e-5 de faux positifs, une reformulation humaine soutenue
laissait encore le filigrane détectable après environ **800 tokens observés**. La fiabilité est une
fonction de la longueur : un extrait court paraît propre, un document long accumule des n-grammes
résiduels.

C'est la raison pour laquelle Cirta ne propose pas de couche de réécriture. Elle ne pourrait produire
qu'une affirmation invérifiable, et la littérature indique qu'elle serait fausse sur les documents
longs. Pour un courriel que vous relisez et signez, la longueur joue déjà en votre faveur sans
outillage.

À surveiller : [SemStamp](https://aclanthology.org/2024.naacl-long.226/) (NAACL 2024) et
[PostMark](https://aclanthology.org/2024.emnlp-main.506/) (EMNLP 2024) marquent au niveau de la
phrase et du sens plutôt que du token. Ils ne sont pas déployés en production aujourd'hui ; s'ils le
sont, l'atténuation par reformulation devient nettement plus difficile.

### Ce qu'on peut quand même dire sur le biais de tokens

Aucun verdict local n'est possible, et Cirta n'en donne pas. Mais il rapporte la variable qui
gouverne réellement la lisibilité de ce marquage : **la longueur**. La détection est un test
d'hypothèse sur des choix de tokens, et sa puissance statistique croît avec le nombre de tokens
observés. « On n'a rien trouvé » ne veut donc pas dire la même chose à 80 tokens et à 8 000 — et un
rapport qui ne le précise pas invite à surinterpréter son silence.

```
Statistical watermark  no local verdict is possible
length      ~707-994 tokens (3180 characters, 480 words)
meaning     Long enough for a keyed detector to have some power, short enough
            that the outcome depends on the scheme and the threshold chosen.
```

Trois bandes, volontairement grossières puisque le seuil exact dépend du schéma, de la clé et du taux
de faux positifs retenu par le vérificateur :

| Bande | Ce que vaut un rapport silencieux |
|---|---|
| < 200 tokens | Même l'éditeur peut ne pas obtenir de résultat fiable ; ne rien trouver ne signifie presque rien |
| 200–800 | Un détecteur détenant la clé a une certaine puissance ; l'issue dépend du schéma et du seuil |
| > 800 | Kirchenbauer et al. (ICLR 2024) ont observé du signal survivant à une reformulation humaine soutenue à 1e-5 de faux positifs |

C'est de la **calibration, pas du ciblage** : cela dit ce que vaut un silence, pas quelle longueur
viser. Le nombre de tokens est estimé par densité de caractères, pas tokenisé — aucun tokenizer n'est
embarqué, et le compte est donc donné sous forme de fourchette.

## Ce que fait le nettoyage

| Support | Retiré | Conservé délibérément |
|---|---|---|
| PDF | **Toutes** les clés `/Info` (y compris personnalisées), le flux `/Metadata` XMP, les manifestes C2PA | Le contenu des pages |
| PPTX / DOCX / XLSX | `core.xml`, `app.xml`, propriétés personnalisées, miniature, `rsid`, noms d'auteurs de commentaires, Exif des images intégrées, manifestes C2PA | Liens locaux, diapositives masquées, notes du présentateur |
| ODT / ODS / ODP | `meta.xml`, propriétés utilisateur, statistiques, miniature, Exif des images, manifestes C2PA | Le contenu |
| SVG | Bloc `<metadata>`, attributs et espaces de noms d'éditeur, commentaires de génération | `<title>` et `<desc>` — ce que lit un lecteur d'écran |
| HTML | Balises `generator`/`author`/`creator`/`copyright`/`date`, commentaires de génération | JSON-LD — ce qu'indexe un moteur de recherche |
| Markdown | Clés de front matter identifiantes ; délimiteurs retirés s'il ne reste rien dedans | Le corps, les autres clés, les lignes d'attribution |
| JPEG | Exif, XMP, IPTC/Photoshop, commentaires, JUMBF C2PA | JFIF et profil ICC — les retirer changerait le rendu |
| PNG | `tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME`, `caBX` C2PA | `IHDR`, `PLTE`, `IDAT`, `IEND` |
| ZIP | **Rien** — refusé | Repacker changerait compression, ordre et horodatages de tous les membres |
| Texte | Caractères invisibles, espaces exotiques normalisés, NFC | Liants d'emoji et anti-liants persans/indiens |
| Corps des documents | Caractères invisibles et références numériques équivalentes, dans le texte visible uniquement | Structure XML, noms de balises, attributs, **espaces typographiques** |
| Corps des PDF | Rien — signalé mais non retirable sans réécrire le flux de contenu | Le texte des pages |

### Le nettoyage est mesuré, pas affirmé

La détection et la suppression peuvent diverger — un champ finit par être reconnu sans être effacé —
et c'est le pire défaut possible ici : un rapport qui liste un élément puis rend un fichier qui le
porte encore. C'est arrivé une fois dans ce projet, avec les clés `/Info` personnalisées.

Le nettoyage **ré-inspecte donc sa propre sortie** et nomme ce qui a survécu, au lieu de faire
confiance au code de suppression :

```
Not removed: Anthropic API key. These sit in the document's own content rather
than in a metadata field, and rewriting page text would change what the
document says. Edit the source and regenerate — and if a credential is listed,
rotate it.
```

Le corollaire est net : **quand aucun avertissement de ce type n'apparaît, c'est que la ré-inspection
n'a rien trouvé** — pas que le code croit avoir bien travaillé.

### Sur le retrait des manifestes C2PA

Retirer un manifeste C2PA ne rend pas un fichier « propre » — il le rend **inconnu**. Un vérificateur
distingue trois états : manifeste valide (provenance prouvée), manifeste altéré (échec de
vérification, altération visible), manifeste absent (aucune conclusion). Là où le C2PA se généralise,
l'absence devient un signal en soi. Cirta signale explicitement chaque retrait de manifeste plutôt
que de l'effectuer en silence.

Second point, plus rarement dit : le C2PA prévoit deux modes de liaison. Le *hard binding* est le
manifeste signé dans le conteneur — c'est celui que Cirta retire, et le retrait est vérifiable. Le
*soft binding* est une marque imperceptible dans le contenu lui-même, qui permet à un vérificateur de
retrouver le manifeste à distance. **Un manifeste retiré ne signifie donc pas qu'il ne reste aucune
provenance.** Cirta le rappelle dans son rapport de nettoyage.

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
npm run verify     # typage, 171 tests, build, scénario CLI de bout en bout, build web
```

### Le logo

`assets/logo.svg` est la source unique de la marque. Le site l'affiche et l'utilise comme favicon,
le README le montre ci-dessus, et `src/cli/logo.ts` en est une transcription en cellules de
caractères — un terminal ne sait pas afficher du SVG :

```
  ╭───────╮   cirta
  │  ╭──  │   inspect and strip provenance metadata from documents
  │  ╰──  │
  ╰───────╯   everything runs locally; no network calls are made
```

Deux transcriptions existent, parce que les caractères de dessin de boîte ne sont pas sûrs partout :
une console Windows héritée en page de code non-UTF-8 les rend en mojibake, et une bannière qui
arrive en charabia est pire qu'une bannière simple. Le repli est purement ASCII et la colonne de
texte reste alignée au même décalage dans les deux cas.

`verify` est l'unique porte d'entrée, et c'est exactement ce que lance la CI. Les étapes sont
enchaînées par `&&`, donc la première qui échoue arrête tout et le code de sortie remonte — un
terminal vert et un pipeline vert ne peuvent pas être en désaccord sur ce qui a été vérifié.

Les étapes individuelles restent disponibles :

```bash
npm run typecheck
npm test
npm run build      # bibliothèque + CLI vers dist/
npm run build:web  # site statique vers dist-web/
node scripts/smoke.mjs
```

La base d'URL du site vaut `/Cirta/` pour GitHub Pages ; utilisez `CIRTA_BASE=/ npm run build:web`
pour un domaine personnalisé.

## Références

Plusieurs idées viennent de [watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover)
(MIT) et de l'article de son auteur sur les quatre couches du problème : la classification par niveaux
de signalement, l'audit récursif de dossier, le refus des entrées binaires dans les outils texte, et
la liste des conteneurs à couvrir. Ce projet ne reprend pas sa couche de retrait par régénération en
domaine pixel ni sa couche de réécriture statistique : toutes deux produisent des affirmations
invérifiables localement, et n'ont pas d'objet pour des PDF ou des documents Office.

Travaux cités dans ce README :

1. Kirchenbauer, J., Geiping, J., Wen, Y., Katz, J., Miers, I., & Goldstein, T. (2023).
   [A Watermark for Large Language Models](https://arxiv.org/abs/2301.10226). ICML 2023.
2. Dathathri, S., See, A., Ghaisas, S., Huang, P.-S., et al. (2024).
   [Scalable watermarking for identifying large language model outputs](https://www.nature.com/articles/s41586-024-08025-4)
   (SynthID-Text). *Nature*, 634, 818-823.
3. Kirchenbauer, J., et al. (2024).
   [On the Reliability of Watermarks for Large Language Models](https://arxiv.org/abs/2306.04634). ICLR 2024.
4. Krishna, K., Song, Y., Karpinska, M., Wieting, J., & Iyyer, M. (2023).
   [Paraphrasing evades detectors of AI-generated text, but retrieval is an effective defense](https://arxiv.org/abs/2303.13408).
   NeurIPS 2023.
5. Sadasivan, V. S., Kumar, A., Balasubramanian, S., Wang, W., & Feizi, S. (2023).
   [Can AI-Generated Text be Reliably Detected?](https://arxiv.org/abs/2303.11156)
6. Hou, A. B., et al. (2024). [SemStamp](https://aclanthology.org/2024.naacl-long.226/). NAACL 2024.
7. Chang, Y., et al. (2024). [PostMark](https://aclanthology.org/2024.emnlp-main.506/). EMNLP 2024.
8. Boucher, N., & Anderson, R. (2023).
   [Trojan Source: Invisible Vulnerabilities](https://arxiv.org/abs/2111.00169). IEEE S&P ; CVE-2021-42574.
9. Coalition for Content Provenance and Authenticity.
   [C2PA specifications](https://c2pa.org/specifications/).
10. Règlement (UE) 2024/1689 (AI Act),
    [Article 50](https://artificialintelligenceact.eu/article/50/).

## Licence

MIT.

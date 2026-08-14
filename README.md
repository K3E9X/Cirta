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
| `customXml/` | Le second magasin de propriétés, que `docProps` ne couvre pas : liaisons de contrôles de contenu, colonnes de bibliothèque SharePoint, étiquettes de classification |
| XLSX en particulier | Auteurs de commentaires (`<author>`, registre `xl/persons`), noms définis pointant vers un fichier hors du classeur, parties `xl/externalLinks/` — des porteurs que ni Word ni PowerPoint n'utilisent |
| ODT / ODS / ODP | `meta.xml` : générateur, auteur initial, dernière modification, dates, cycles et durée d'édition, propriétés utilisateur, miniature, **et les caractères invisibles du corps** |
| SVG | Bloc `<metadata>` (RDF/Dublin Core, C2PA), espaces de noms d'éditeur (Inkscape, Figma, Sketch…), commentaires de génération |
| HTML | Balises `generator`, `author`, `creator`, `copyright`, `date` ; attributs `data-ai-*` ; commentaires de génération ; JSON-LD signalé |
| Markdown | Clés de front matter, commentaires HTML de génération, lignes d'attribution en fin de document |
| JPEG / PNG | Exif (dont GPS), XMP, IPTC/Photoshop, commentaires ; chunks `tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME` — en fichier autonome comme intégrés dans un document |
| C2PA | Manifestes signés dans les PDF (XMP), Office et OpenDocument (parties dédiées), SVG (`<metadata>`) et images (JUMBF en `APP11` pour le JPEG, chunk `caBX` pour le PNG) |
| ZIP / EPUB | Parcours récursif : chaque membre passe par la détection normale, ceux qu'aucun analyseur ne revendique sont scannés pour secrets et identifiants de fournisseur |
| Texte | Caractères invisibles (zero-width, sélecteurs de variation, tag characters, contrôles bidi, espaces exotiques), avec décodage des charges stéganographiques ; **plus un filet générique sur la catégorie Unicode `Cf`**, pour que la liste ne prenne pas de retard sur la norme |
| Fichiers texte et code source | `.txt`, `.csv`, `.json`, `.yaml`, `.py`, `.js`, `.ts`, `.go`, `.rs`, `.sh`… et les fichiers à point (`.env`, `.npmrc`, `.netrc`) — mêmes contrôles, même retrait. Un contrôle bidirectionnel dans du code est le cas **Trojan Source** (CVE-2021-42574) |
| Secrets | Clés Anthropic, OpenAI, Google, Hugging Face, GitHub, **AWS**, Slack, Stripe ; **blocs de clé privée PEM** ; identifiants d'appel et points de terminaison LLM. Uniquement des motifs qui ne peuvent pas apparaître dans de la prose ordinaire — jamais un nom de produit |
| Lettres sosies | Mots mêlant deux alphabets (`pаssword` avec un `а` cyrillique) ou deux chasses (`Ａdmin`) — **signalés, jamais remplacés** |
| Normalisation Unicode | Un document contenant à la fois `é` (U+00E9) et `e`+U+0301 — même rendu, deux encodages, **un bit libre par lettre accentuée** |
| Sosies du trait d'union | U+2010, U+2011, U+2012, U+2212 — indiscernables du `-` à l'écran. Les tirets cadratin et demi-cadratin sont exclus : ils sont visibles et corrects en typographie française |
| Contrôles C0 | `NUL`, `BEL`, `BS`, `VT`, `ESC`, `DEL` — catégorie `Cc`, que le filet `Cf` ne couvre pas. Signalés, jamais retirés : un journal de terminal en couleurs est plein d'`ESC` légitimes |
| Canaux d'espacement | Espaces en fin de ligne, espacement irrégulier après les points, fins de ligne CRLF/LF mélangées — **signalés, jamais réécrits** |

### Ce à quoi le texte ressemble

Troisième et dernière chose qu'un outil local peut dire — et la plus facile à détourner, donc sa
forme compte autant que son contenu. **Il mesure, il ne conclut pas.**

Ce n'est pas de la modestie. OpenAI a retiré son propre classifieur de texte IA en juillet 2023 :
26 % de vrais positifs, 9 % de faux positifs. Et
[Liang et al. (Stanford, 2023)](https://arxiv.org/abs/2304.02819) ont montré que les détecteurs
encore sur le marché classaient **61 % des copies TOEFL d'anglophones non natifs** comme générées —
un faux positif qui tombe systématiquement sur les gens les moins en mesure de le contester. Tout
verdict bâti sur ces signaux en hérite.

Ce qui résiste à l'examen, ce sont les indices pris un par un :

```
Style  des indices, pas un verdict
forme       7 phrases, 17.9 mots en moyenne
variation   0.50 — de combien la longueur des phrases bouge
tirets      24.0 cadratins ou demi-cadratins pour 1000 mots
amorces     60% des paragraphes ouvrent sur une phrase en gras
tournures   crucial / primordial / holistique ×3 · il est important de noter ×2 · dans le paysage… ×1
lecture     Plusieurs de ces marqueurs sont présents en même temps.
```

Quatre familles de mesures :

- **Lexique** — une liste **d'abord française**, parce que presque tous les détecteurs publiés sont
  entraînés sur l'anglais, ce qui les rend inutiles sur les documents que cet outil vise. Les
  tournures distinctives (« dans le paysage numérique en constante évolution ») comptent dès la
  première occurrence ; les mots ordinaires (« crucial ») exigent **au moins deux occurrences et un
  taux minimal**, parce qu'un seul ne veut rien dire.
- **Rythme** — la variation de longueur des phrases. Les gens varient plus qu'un modèle ; la
  documentation technique varie moins que les deux. Le nombre est donné, le seuil ne l'est pas.
- **Ponctuation** — cadratins pour 1000 mots.
- **Structure** — proportion de paragraphes ouvrant sur une amorce en gras.

**Aucun score, et c'est délibéré.** Pondérer ces signaux impliquerait qu'ils ont été calibrés contre
un corpus étiqueté, ce qui n'est pas le cas, et le nombre serait lu comme une probabilité quel que
soit son nom. L'agrégation se limite donc à *combien* sont présents.

Le contrôle qui compte : sur *L'Étranger* de Camus, la lecture est « peu de ces marqueurs sont
présents ». Un module qui signale Camus est pire que pas de module.

L'usage visé est celui pour lequel l'outil a été construit : relire **votre propre brouillon** avant
de l'envoyer. « Six de ces marqueurs sont dans votre texte, les voici » est actionnable. « 78 % IA »
ne l'est pas, et serait faux.

### Quand le fichier le déclare lui-même

Il existe un champ standard où un générateur *déclare* comment le contenu a été fabriqué :
`digitalSourceType`, le vocabulaire de l'IPTC. C'est ce que porte le C2PA dans son assertion
`c2pa.actions`, et c'est autour de lui que les obligations de transparence de l'AI Act européen sont
rédigées. Un outil honnête y écrit qu'il a généré le contenu — un URI, dans les métadonnées, fait
pour être lu.

Cirta le lit dans le paquet XMP, dans l'assertion C2PA, dans les parties OOXML et ODF, et dans le
balisage HTML/SVG. Le vocabulaire est lu **terme par terme**, parce qu'une recherche par mot-clé
écrase des distinctions qui comptent :

| Terme | Ce que ça veut dire |
|---|---|
| `trainedAlgorithmicMedia` | **Créé par un modèle génératif** — le fichier l'affirme |
| `compositeWithTrainedAlgorithmicMedia` | Composite incluant du contenu de modèle génératif |
| `algorithmicallyEnhanced` | Fait par un humain, puis altéré par un algorithme |
| `algorithmicMedia` | Produit par un algorithme — **un dégradé, une fractale** : pas un modèle entraîné |
| `digitalCapture` | Capturé par un appareil photo : l'affirmation explicite que ce n'est *pas* généré |

La quatrième ligne est la raison d'être de cette lecture fine. La fixture C2PA signée du dépôt
déclare `algorithmicMedia` : c'est un dégradé généré par un script, pas de l'IA. Un outil qui cherche
`digitalSourceType` au mot-clé la classerait « générée par IA ». Le nôtre dit ce qu'elle dit.

Quand le terme est génératif, la ligne de synthèse change de ton — c'est une déclaration, pas une
déduction :

```
Produced by  a generative model — the file declares it
             pdf-lib
```

### La question directe : produit par une IA, et laquelle ?

Chaque rapport commence par une ligne qui y répond, parce que la réponse était jusqu'ici éparpillée
sur cinq lignes du tableau qu'il fallait assembler soi-même :

```
Produced by  claude-opus-5 (Claude) · Claude / Anthropic · LangChain · ReportLab
             according to the file's own metadata, which can be absent, wrong or forged
```

Trois réponses possibles, et la troisième est la plus importante :

1. **Un assistant, un modèle ou un agent est nommé** — la ligne les liste, du plus précis au plus
   général, avec le rappel que ce sont les métadonnées du fichier qui l'affirment.
2. **Seule une bibliothèque est nommée** (`ReportLab`, `python-docx`) — le conteneur a été fabriqué
   par un programme, ce qui ne dit rien de qui a écrit les mots. L'outil le dit et ne va pas plus
   loin.
3. **Rien ne nomme quoi que ce soit** — et le rapport le formule explicitement, au lieu de se taire :
   *ce n'est pas la même chose que « pas d'IA »*. Les champs ont pu être vidés, jamais écrits, ou le
   texte collé à la main dans Word. Et la formulation elle-même — là où vit un filigrane statistique
   — n'est pas lisible ici.

Un rapport silencieux se lit comme un acquittement. Ce n'en est pas un.

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

**PDF — lire le texte des pages pour de vrai.** Une chaîne PDF ne contient pas d'Unicode : elle
contient des codes qui signifient ce que la police en dit. Or dès qu'un texte porte un accent, le
producteur intègre une police *sous-ensemble*, qui numérote ses glyphes à partir de 1 dans l'ordre
où elle les a rencontrés. Une page affichant « Réduire les flux » apparaît alors dans le flux comme
`<000100020003…>`, et y chercher une espace de largeur nulle ne trouve jamais rien.

La correspondance inverse est dans le fichier : chaque police de ce type porte une table
`/ToUnicode`. Cirta la lit, suit l'opérateur `Tf` pour savoir quelle police est active à chaque
instant, et décode. Mesuré sur un corpus furtif rendu en PDF avec police embarquée : **2067
caractères sur 2088 récupérés**, et les 21 manquants n'avaient jamais été écrits — la police n'avait
pas de glyphe pour eux, ils ont été perdus à la génération, pas à l'analyse.

Une page dont la police ne porte pas de table `ToUnicode` reste lue en codes bruts : là, une
détection est fiable mais une absence ne prouve rien.

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
| PDF | **Exacte** quand la police porte une table `ToUnicode`, ce qui est le cas dès qu'un accent est présent ; sinon fiable en détection, une absence ne prouvant rien | Non — voir plus bas |

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

### Trois précisions d'Anthropic, qui vont dans les deux sens

La [documentation d'Anthropic](https://support.claude.com/en/articles/16266773-how-claude-marks-ai-generated-content)
pose trois limites explicites, et aucune ne va dans le sens qu'on attend :

1. **Une marque détectée ne prouve pas une paternité.** Elle indique que le contenu *a pu être
   traité* par le modèle — pas qu'il a été écrit par lui.
2. **L'absence de marque ne prouve pas une origine humaine.** C'est exactement ce que le bloc
   « filigrane statistique » de Cirta existe pour dire : un rapport silencieux sur un texte court ne
   signifie presque rien.
3. **La relecture, la traduction ou le résumé peuvent estampiller du texte humain.** C'est le cas le
   plus courant et le moins évident : vous écrivez vous-même, vous demandez une correction, et votre
   texte ressort marqué. Le marquage suit le passage par le modèle, pas la paternité de la rédaction.

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
| PPTX / DOCX / XLSX | `core.xml`, `app.xml`, propriétés personnalisées, miniature, `rsid`, noms d'auteurs de commentaires (attribut `w:author`, élément `<author>`, `displayName`), Exif des images intégrées, manifestes C2PA | Liens locaux, diapositives masquées, notes du présentateur, noms définis et liens entre classeurs — les retirer transformerait des cellules vivantes en `#REF!` |
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

Déposez-en plusieurs et un bandeau récapitulatif s'affiche — le même décompte que la ligne
`Summary` du CLI — avec un export JSON du rapport. Cet export a exactement la forme qu'émet
`cirta inspect --json`, donc un rapport produit depuis la page et un rapport produit en ligne de
commande se comparent sans traduction. L'analyse tourne dans un *worker* : un PDF volumineux ne fige
pas l'onglet, et un worker reste un fil d'exécution de la même page, pas une autre machine.

Les onglets suivent les pratiques ARIA : un seul arrêt dans l'ordre de tabulation, les flèches
(et <kbd>Origine</kbd>/<kbd>Fin</kbd>) circulent entre eux.

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

# Les répertoires de dépendances et de build sont ignorés (node_modules, .git,
# dist, target, .venv…), sinon un dépôt ordinaire noie le rapport : sur celui-ci,
# 118 des 125 fichiers trouvés venaient de node_modules.
cirta inspect ./mon-projet --skip fixtures,snapshots

# Les fichiers texte et code source passent par le même chemin
cirta inspect ./src
cirta redact src/auth.py           # retire un contrôle bidi de type Trojan Source

# Écrire une copie nettoyée (rapport.clean.pdf par défaut)
cirta redact rapport.pdf
cirta redact *.docx --in-place
cirta redact rapport.pdf -o public/rapport.pdf

# Sortie exploitable par script
cirta inspect rapport.pdf --json

# Texte sur l'entrée standard
cirta text < brouillon.txt                    # analyser
cirta text --clean < brouillon.txt > propre.txt

# La garde binaire refuse un document ; --force-text passe outre si vous savez
# ce que vous faites (elle est délibérément grossière, donc faillible)
cirta text --force-text < fichier-au-format-inhabituel

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

**Contenu laissé en place** — les liens vers des chemins locaux, les diapositives masquées, les
notes du présentateur, les références entre classeurs et les lettres sosies sont signalés mais
**jamais supprimés**. Ce sont du contenu, pas des
métadonnées : les retirer changerait ce que lit le destinataire. Le rapport de nettoyage les rappelle
explicitement pour que la décision vous revienne.

**Images intégrées** — l'Exif, le XMP, l'IPTC et les commentaires sont retirés des JPEG, et les
chunks de texte, d'horodatage et d'Exif des PNG. Le segment JFIF et le profil colorimétrique ICC sont
conservés : les supprimer changerait le rendu de l'image.

**Texte** — les caractères invisibles sont retirés, sauf lorsqu'ils accomplissent un travail
typographique légitime : liants de séquences emoji (`👩‍💻`), sélecteurs de présentation après un
caractère pictographique, et anti-liants entre deux lettres, indispensables aux orthographes persane
et indiennes. Les espaces exotiques sont normalisés en `U+0020`, puis le texte passe en NFC.

Derrière la liste nommée, un filet attrape toute la catégorie Unicode `Cf` — sinon chaque caractère
de format ajouté à la norme passerait sans bruit. Ce filet a lui aussi ses exceptions, pour la raison
inverse : les signes de nombre arabes (`U+0600`–`U+0605`), les fins de verset coranique (`U+06DD`,
`U+08E2`), le signe kaithi et les contrôles de ligature musicale sont invisibles mais font partie de
ce que dit le document. Les supprimer serait une perte de données, pas un nettoyage.

**Lettres sosies** — un `а` cyrillique et un `a` latin sont deux codepoints qui s'affichent
identiquement, donc `pаssword` se lit comme un mot anglais ordinaire et ne correspond à rien. Le
signal n'est pas le caractère — le cyrillique en est légitimement plein — mais le *mélange* : un mot
puisant dans deux alphabets à la fois. Ils sont **signalés et jamais remplacés** : substituer le
« mauvais » alphabet est un pari sur la moitié du mot qui était voulue, et se tromper de sens abîme
du vrai texte cyrillique ou grec. La décision vous revient.

### Les canaux qui ne sont pas un caractère bizarre

Un détecteur qui travaille sur une liste noire de codepoints trouve zéro résultat sur un texte qui
n'en contient aucun — et il est parfaitement possible de marquer un document sans en utiliser un
seul. Quatre familles sont couvertes pour cette raison :

**La normalisation.** `é` s'écrit en un codepoint (U+00E9) ou en deux (`e` + U+0301). Les deux
s'affichent identiquement, aucun n'est suspect, et le choix entre les deux est un bit gratuit par
lettre accentuée. Sur un texte français ordinaire, cela fait une centaine de bits.

Le signal n'est pas la décomposition mais le **mélange**. Un fichier entièrement décomposé, c'est un
Mac : HFS+ stocke en NFD et plusieurs chaînes d'outils suivent. Un fichier qui contient les deux
formes est un fichier où quelque chose a choisi, lettre par lettre. D'où deux niveaux distincts :
`confirmé` pour le mélange, `informatif` pour le NFD uniforme.

**Les sosies du trait d'union.** U+2010 et U+2011 sont au pixel près le `-` ASCII dans la plupart
des polices. Les tirets demi-cadratin et cadratin sont délibérément absents de la liste : ils sont
visiblement plus longs, ils sont corrects en français, et les signaler noierait les deux qui se
cachent vraiment.

**L'espacement.** Une ou deux espaces après un point passe pour une habitude de frappe ; une espace
en fin de ligne est invisible dans tout éditeur ; des fins de ligne CRLF et LF mélangées portent un
bit par ligne. Là encore le signal est l'irrégularité : un document qui double *toutes* ses espaces
suit une convention, un document qui alterne a choisi phrase par phrase. Ces canaux sont **signalés
et jamais réécrits** — l'espacement appartient à l'auteur.

Le canal CRLF/LF n'apparaît que sur un **fichier**. Un `<textarea>` normalise les fins de ligne à la
lecture, donc un texte collé dans la page ne le porte plus. Le rapport le dit.

**Les invisibles que la catégorie `Cf` ne couvre pas.** U+3164 HANGUL FILLER est classé *lettre* par
Unicode et se rend vide ; U+2800 est une cellule braille blanche ; U+034F est une marque combinante.
Aucun n'est un caractère de formatage, tous se voient comme rien. La cellule braille est conservée
quand elle est entourée de braille — c'est l'espace de cette écriture — et retirée partout ailleurs.

### Refuser plutôt qu'abîmer

Deux gardes existent parce que l'échec silencieux coûte plus cher que le refus.

**Un fichier binaire n'entre pas dans les outils texte.** Passer un document au nettoyeur de texte le
détruit : les octets sont décodés en pure perte, le retrait s'applique à l'épave, et le résultat est
réécrit par-dessus. La détection repose sur une **signature de format** (25 en-têtes), puis les
octets NUL, puis la densité d'octets de contrôle. La signature d'abord, parce qu'elle seule est
fiable : un PDF dont les flux ne sont pas compressés ne contient aucun NUL et décode proprement en
UTF-8 — il traversait les deux autres tests. Les signatures qui sont aussi des mots courants (`OTTO`,
`RIFF`) exigent en plus une structure binaire dans les premiers octets, pour qu'un document qui
commence par ce mot reste traité comme du texte.

**Une archive est refusée sur la taille qu'elle annonce**, avant toute décompression. Un conteneur de
800 Ko peut déclarer 800 Mo ; les plafonds appliqués après coup bornent ce qui est *rapporté*, pas ce
qui est *décompressé* — la mémoire est déjà dépensée. La taille annoncée est la revendication de
l'archive et un fichier forgé peut mentir : c'est une garde, pas une preuve.

**Une écriture ne peut pas perdre l'original.** Toute sortie passe par un fichier temporaire du même
répertoire puis un renommage atomique ; un lien symbolique en destination est refusé plutôt que suivi ;
et `--in-place` conserve un `.bak` créé avant tout remplacement.

## Développement

```bash
npm run verify     # typage, 255 tests, build, scénario CLI de bout en bout, build web
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

### Fichiers réels

Toutes les fixtures unitaires sont construites à la main : c'est rapide et précis, mais un conteneur
fabriqué ici partage les hypothèses de l'analyseur qui le relit. La seule image réellement signée de
la suite (`test/fixtures/signed.jpg`, tirée de c2pa-rs) est ce qui a pris le lecteur CBOR en défaut,
lui qui supposait qu'un manifeste ne contient aucun élément de longueur indéfinie.

`scripts/real-files.mjs` va plus loin : LibreOffice produit un document, Cirta le nettoie,
LibreOffice rouvre le résultat. Corrompre un fichier Word est le pire échec possible ici, et rien
d'autre dans la suite ne le remarquerait. La première conversion sert de témoin — si LibreOffice ne
sait même pas fabriquer l'entrée, le script s'arrête en le disant plutôt qu'en échouant, parce que
cela ne prouve rien sur le nettoyage. La CI l'exécute sur Linux, après `verify`.

```bash
node scripts/real-files.mjs
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

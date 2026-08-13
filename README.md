# Cirta

Inspecte et retire les métadonnées de provenance des **PDF, PPTX, DOCX et XLSX**, ainsi que les
**caractères Unicode invisibles** dans le texte. Disponible en interface web et en ligne de commande.

Tout s'exécute localement. L'interface web ne fait aucune requête réseau : aucun document ne quitte
votre machine.

## Ce que fait cet outil

| Support | Traité |
|---|---|
| PDF | Dictionnaire `/Info`, paquet XMP, manifestes C2PA, pièces jointes intégrées |
| PPTX / DOCX / XLSX | `docProps/core.xml`, `docProps/app.xml`, propriétés personnalisées, miniature intégrée, identifiants de révision `rsid`, auteurs de commentaires et de révisions |
| Texte | Caractères invisibles (zero-width, sélecteurs de variation, tag characters, contrôles bidi, espaces exotiques), avec décodage des charges stéganographiques |

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

```bash
npm install
npm run build
npm link          # rend la commande `cirta` disponible
```

```bash
# Signaler les métadonnées portées par des fichiers
cirta inspect rapport.pdf presentation.pptx

# Écrire une copie nettoyée (rapport.clean.pdf par défaut)
cirta redact rapport.pdf
cirta redact *.docx --in-place
cirta redact rapport.pdf -o public/rapport.pdf

# Sortie exploitable par script
cirta inspect rapport.pdf --json

# Texte sur l'entrée standard
pbpaste | cirta text                 # analyser
pbpaste | cirta text --clean | pbcopy  # nettoyer
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

**Texte** — les caractères invisibles sont retirés, sauf lorsqu'ils accomplissent un travail
typographique légitime : liants de séquences emoji (`👩‍💻`), sélecteurs de présentation après un
caractère pictographique, et anti-liants entre deux lettres, indispensables aux orthographes persane
et indiennes. Les espaces exotiques sont normalisés en `U+0020`, puis le texte passe en NFC.

## Développement

```bash
npm test           # 30 tests
npm run typecheck
npm run build      # bibliothèque + CLI vers dist/
npm run build:web  # site statique vers dist-web/
```

La base d'URL du site vaut `/Cirta/` pour GitHub Pages ; utilisez `CIRTA_BASE=/ npm run build:web`
pour un domaine personnalisé.

## Licence

MIT.

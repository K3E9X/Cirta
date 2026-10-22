# Sécurité

[English version](SECURITY.md)

## Signaler une vulnérabilité

Signalez-la en privé, via GitHub : onglet **Security** du dépôt, **Report a vulnerability**. Si
l'option n'est pas proposée, ouvrez un ticket qui dit seulement que vous avez un signalement de
sécurité et demande un contact privé — sans détail, sans preuve de concept, sans fichier.

Un document hostile qui fait planter Ciirta, le bloque, lui fait lire ce qu'il ne devrait pas, ou lui
fait déclarer propre un fichier qui ne l'est pas, entre dans le périmètre. Envoyez la plus petite
entrée qui le montre ; si c'est un vrai document, dites-le, et n'en envoyez pas un qui contient des
données personnelles.

Les correctifs vont sur la branche `main` ; aucune version plus ancienne n'est maintenue.

## Modèle de menace

Ciirta reçoit des documents venus de gens en qui l'utilisateur n'a aucune raison d'avoir confiance.
Tout ce qui suit en découle.

**Ce qui est protégé.** Les documents de l'utilisateur et leur contenu. Ils sont lus sur sa machine
et nulle part ailleurs : le cœur ne fait aucune requête réseau, la Content-Security-Policy de la page
interdit toute connexion (`connect-src 'none'`), et le worker d'analyse retire `fetch`,
`XMLHttpRequest`, `WebSocket`, `EventSource` et `WebTransport` de sa propre portée avant de charger
PDF.js — un worker n'hérite pas de la politique de la page. Le service worker de la page ne demande
que les fichiers du site, dans son dossier, jamais un document. `test/no-network.test.ts` vérifie le
tout.

**Contre qui.** L'auteur du fichier : un expéditeur qui veut faire planter ou bloquer l'analyseur,
atteindre le système de fichiers ou le réseau, exécuter du code, ou faire mentir le rapport.

| Surface | Ce qui pourrait arriver | Ce que fait Ciirta | Vérifié par |
|---|---|---|---|
| Analyseurs (PDF, ZIP, OOXML, ODF, OLE2/CFB, MSG, MIME, images, CBOR/JUMBF, notebooks, MP4/QuickTime, ID3, RIFF/WAVE, TAR, gzip, 7z et son décodeur LZMA/LZMA2) | Plantage, blocage, explosion mémoire sur une longueur, un décalage ou une boucle forgés | Chaque longueur et chaque décalage vérifiés ; chaînes suivies avec un ensemble de visites ; limites d'archive (8 192 membres, 512 Mo déclarés, imbrication 3) ; un fichier dans un fichier lu sur 3 niveaux au plus ; un fichier corrompu devient un refus codé, jamais une exception brute ; un gzip est décompressé en flux sous les limites d'archive, les dossiers d'un 7z sont refusés au-delà avant d'être décodés, et chaque CRC que donne un 7z est vérifié, si bien qu'une erreur de décodage est un refus, jamais un fichier mal lu | `scripts/fuzz.mjs` (dans `npm run verify`), `test/fuzz-parsers.test.ts`, `test/fuzz-regressions.test.ts` |
| XML | Expansion d'entités (billion laughs), entités externes (XXE), imbrication profonde, attributs énormes | Le XML est lu par l'analyseur propre de Ciirta, pas par un DOM : un DOCTYPE est du texte, aucune entité au-delà des cinq prédéfinies et des références numériques n'est résolue, rien n'est chargé | `test/xml-robustness.test.ts` |
| Contenu actif | Macros, JavaScript PDF, DDE, modèles distants exécutés ou chargés pendant l'inspection | Lus, jamais exécutés : le VBA est décompressé et cité, PDF.js rend avec `isEvalSupported: false` et XFA désactivé, les cibles distantes sont signalées et jamais demandées | `test/ooxml-active.test.ts`, `test/pdf-active.test.ts`, `test/legacy-office.test.ts` |
| Le terminal | Une valeur portant des séquences d'échappement réécrit l'écran, change le titre, écrit le presse-papiers | Les caractères de contrôle et les forçages bidirectionnels de tout ce qui est affiché sont montrés comme des échappements visibles | `test/terminal.test.ts` |
| La page web | Une valeur rendue comme du balisage (XSS) | Les valeurs sont insérées comme du texte, jamais comme du HTML | `test/no-network.test.ts` (aucun `innerHTML` dans `src/web`) |
| Fichiers produits | Une copie nettoyée qui ne s'ouvre pas, ou qui contient encore ce qu'elle dit avoir retiré | Chaque copie nettoyée est inspectée à nouveau ; une copie qui ne se relit pas n'est pas livrée ; « retiré » veut dire absent de la sortie, vérifié ; ce qui survit est nommé | `test/redact-truth.test.ts`, `scripts/real-files.mjs` |
| Serveur MCP | Un agent qui écrase les fichiers de l'utilisateur | stdio local uniquement ; `redact_file` n'écrase jamais l'entrée, ni un fichier existant sauf si `overwrite` vaut true | `test/mcp.test.ts` |
| `ciirta serve` (ICAP, HTTP) | Un client du réseau envoie une requête mal formée ou sans fin, un corps compressé qui se décompresse sans fin, ou lit ce que d'autres ont soumis | Boucle locale sauf si `--host` dit autre chose ; pas d'authentification, il se place donc derrière le proxy ou la passerelle qui l'appelle, jamais exposé ; en-têtes et lignes de bloc bornés, corps au-delà de `--max-size` (50 Mo) lus et jetés, décompression bornée à la même taille, connexions inactives fermées après 120 s ; chaque requête n'est répondue qu'à son expéditeur, et le journal ne porte que libellés et décomptes, jamais une valeur ni une URL ; il écoute et ne se connecte jamais | `test/serve.test.ts`, `test/no-network.test.ts`, `test/docker.test.ts` |
| `ciirta watch` | Une copie nettoyée écrite par-dessus le fichier qu'on s'apprête à envoyer, ou un fichier à moitié écrit lu comme complet | `--clean` n'écrit que dans un autre dossier, donné par `--output` ; `--in-place` est refusé ; un fichier n'est lu qu'une fois inchangé entre deux passages à une seconde d'écart | `test/watch.test.ts` |
| Add-in Thunderbird | Une pièce jointe remplacée par une copie abîmée, ou l'add-in qui joint le réseau | Une pièce jointe n'est remplacée que par une copie que la bibliothèque a écrite et relue, jamais pour un format qu'elle ne réécrit pas ; une permission, `compose` ; sa politique interdit toute connexion, et son script d'arrière-plan ne contient aucun appel réseau | `test/thunderbird.test.ts` |
| Fichier de règles | Un motif qui fait exploser le retour arrière | Le motif d'une règle s'exécute tel qu'écrit ; JavaScript n'offre pas de délai d'expiration. Documenté ; utilisez des règles de confiance | — |

**Hors périmètre.**
- **Les filigranes statistiques** dans la formulation d'un texte produit par un modèle. Ils résident
  dans le choix des mots, se lisent avec la clé de l'éditeur, et aucun outil local ne peut les
  détecter ni les retirer. Ciirta ne prétend pas le faire.
- **Les pixels.** Un filigrane invisible encodé dans les données d'une image n'est ni détecté ni
  retiré ; seules les métadonnées du conteneur le sont.
- **Les formats inspectés mais jamais réécrits** — Office ancien (`.doc`, `.xls`, `.ppt`), Outlook
  `.msg`, archives simples : le nettoyage est refusé plutôt que risqué.
- **Une machine ou un navigateur compromis**, et la chaîne d'approvisionnement des dépendances
  (`pdf-lib`, `fflate`, PDF.js, `@napi-rs/canvas`), au-delà du fichier de verrouillage et du retrait
  des moyens réseau décrits plus haut.

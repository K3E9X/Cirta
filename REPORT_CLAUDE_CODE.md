# Rapport — campagne de test du 18/10/2026

Base : `main` @ `b23fca9`. Corpus de repro régénéré à l'identique avec les scripts fournis
(`make_text.py`, `make_office.py`, `make_pdf.py`, `make_misc.py`, 21 fichiers).

Organisation des branches. Les lots dépendent les uns des autres, donc les branches sont empilées.
Chaque PR ne montre que son lot.

| PR | Branche | Base | Contenu |
|---|---|---|---|
| n°1 | `fix/test-campaign-2026-10` | `main` | C1, C2, C3 (P0) |

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

---

## État de vérification (branche `fix/test-campaign-2026-10`)

- `npm run verify` : exit 0. 25 fichiers de test, **585 tests** (560 avant). Fuzz sans crash ni blocage. Build web OK.
- `node scripts/real-files.mjs` : `all real-file checks passed`.

## Dettes et risques notés en cours de route

- Le récapitulatif multi-fichiers du CLI (`Summary … files`) est en dur en anglais : à traiter dans C11.

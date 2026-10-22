# Ciirta for VS Code

The [Ciirta](https://github.com/K3E9X/Cirta) library inside the editor, on the machine — nothing is sent anywhere.

- **Text files** are inspected when opened and saved: an invisible character is underlined where it is
  (a zero-width space, a bidi override — the Trojan Source case), and the rest of what Ciirta finds is in
  the Problems panel. Setting: `ciirta.inspectTextFiles`.
- **Any file** — a `.docx`, a PDF, a picture — from the Explorer's context menu or the command palette:
  **Ciirta: Inspect this file**, and **Ciirta: Write a cleaned copy**, which writes `name.clean.ext` beside it
  and leaves the original untouched.

Messages follow VS Code's display language, French or English.

Build the `.vsix` from the repository root: `node scripts/build-vscode.mjs`.

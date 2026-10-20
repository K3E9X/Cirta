/**
 * [F-P2 2.6] Ciirta in VS Code.
 *
 *   - A text file is inspected when it is opened and saved: invisible
 *     characters underlined where they are, the rest in the Problems panel.
 *   - Any file — a .docx, a PDF — from the Explorer's context menu or the
 *     command palette: "Ciirta: Inspect this file", "Ciirta: Write a cleaned
 *     copy" (name.clean.ext beside it, the original untouched).
 *
 * Everything runs in the extension host, on the machine: the library is
 * bundled in, nothing is sent anywhere. The PDF page renderer is not: the
 * extension does what the library does without it, and the check that
 * renders pages says it did not run.
 */

import * as vscode from 'vscode';
import { inspectFile, redactFile } from '../../../src/core/index.js';
import { errorText, type Lang } from '../../../src/shared/french.js';
import { toDiagnostics, type PlainDiagnostic } from './diagnostics.js';

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
} as const;

const lang = (): Lang => (vscode.env.language.toLowerCase().startsWith('fr') ? 'fr' : 'en');

function toVscode(plain: PlainDiagnostic): vscode.Diagnostic {
  const { line, character, endLine, endCharacter } = plain.range;
  const diagnostic = new vscode.Diagnostic(new vscode.Range(line, character, endLine, endCharacter), plain.message, SEVERITY[plain.severity]);
  diagnostic.source = 'Ciirta';
  diagnostic.code = plain.code;
  return diagnostic;
}

const cleanedUri = (uri: vscode.Uri) => {
  const path = uri.path;
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return uri.with({ path: dot > slash ? `${path.slice(0, dot)}.clean${path.slice(dot)}` : `${path}.clean` });
};

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('ciirta');
  context.subscriptions.push(diagnostics);

  const inspect = async (uri: vscode.Uri, text?: string): Promise<number> => {
    const data = await vscode.workspace.fs.readFile(uri);
    const name = uri.path.slice(uri.path.lastIndexOf('/') + 1);
    try {
      const result = await inspectFile(data, name);
      diagnostics.set(uri, toDiagnostics(result.findings, lang(), text).map(toVscode));
      return result.findings.length;
    } catch (error) {
      diagnostics.set(uri, [toVscode({ range: { line: 0, character: 0, endLine: 0, endCharacter: 0 }, severity: 'information', message: errorText(error, lang()), code: 'refused' })]);
      return 0;
    }
  };

  const onText = (document: vscode.TextDocument) => {
    if (document.uri.scheme !== 'file' || !vscode.workspace.getConfiguration('ciirta').get<boolean>('inspectTextFiles', true)) return;
    void inspect(document.uri, document.getText());
  };

  const target = (uri?: vscode.Uri) => uri ?? vscode.window.activeTextEditor?.document.uri;

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(onText),
    vscode.workspace.onDidSaveTextDocument(onText),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
    vscode.commands.registerCommand('ciirta.inspect', async (uri?: vscode.Uri) => {
      const file = target(uri);
      if (!file) return;
      const count = await inspect(file);
      void vscode.window.showInformationMessage(lang() === 'fr' ? `Ciirta : ${count} constat${count > 1 ? 's' : ''} — voir le panneau Problèmes.` : `Ciirta: ${count} finding${count === 1 ? '' : 's'} — see the Problems panel.`);
    }),
    vscode.commands.registerCommand('ciirta.clean', async (uri?: vscode.Uri) => {
      const file = target(uri);
      if (!file) return;
      try {
        const name = file.path.slice(file.path.lastIndexOf('/') + 1);
        const result = await redactFile(await vscode.workspace.fs.readFile(file), name);
        const destination = cleanedUri(file);
        await vscode.workspace.fs.writeFile(destination, result.data ?? new TextEncoder().encode(result.text ?? ''));
        const left = result.kept?.length ?? 0;
        void vscode.window.showInformationMessage(
          lang() === 'fr'
            ? `Ciirta : ${result.removed.length} retiré${result.removed.length > 1 ? 's' : ''}${left ? `, ${left} toujours présent${left > 1 ? 's' : ''}` : ''} → ${destination.path.slice(destination.path.lastIndexOf('/') + 1)}`
            : `Ciirta: ${result.removed.length} removed${left ? `, ${left} still there` : ''} → ${destination.path.slice(destination.path.lastIndexOf('/') + 1)}`,
        );
      } catch (error) {
        void vscode.window.showWarningMessage(`Ciirta: ${errorText(error, lang())}`);
      }
    }),
  );

  for (const document of vscode.workspace.textDocuments) onText(document);
}

export function deactivate(): void {}

import * as vscode from "vscode";
import { parseBehaviorTreeXml } from "./bt_parser";
import { getWebviewHtml } from "./webview";

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    "nav2-bt-preview.openPreview",
    async (uri?: vscode.Uri) => {
      const document = await getTargetDocument(uri);

      if (!document) {
        vscode.window.showErrorMessage("No XML file selected.");
        return;
      }

      const targetDocument = document;

      if (
        targetDocument.languageId !== "xml" &&
        !targetDocument.fileName.endsWith(".xml")
      ) {
        vscode.window.showErrorMessage("The selected file is not an XML file.");
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        "nav2BtPreview",
        "Nav2 BT Preview",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "media")
          ]
        }
      );

      function updatePreview(): void {
        try {
          const xmlText = targetDocument.getText();
          const nodes = parseBehaviorTreeXml(xmlText);

          panel.webview.html = getWebviewHtml(
            panel.webview,
            context.extensionUri,
            nodes
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          panel.webview.html = getErrorHtml(message);
        }
      }

      updatePreview();

      const changeSubscription = vscode.workspace.onDidChangeTextDocument(
        (event) => {
          if (event.document.uri.toString() === targetDocument.uri.toString()) {
            updatePreview();
          }
        }
      );

      panel.onDidDispose(() => {
        changeSubscription.dispose();
      });
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate(): void {}

async function getTargetDocument(
  uri?: vscode.Uri
): Promise<vscode.TextDocument | undefined> {
  if (uri) {
    return vscode.workspace.openTextDocument(uri);
  }

  const editor = vscode.window.activeTextEditor;

  if (editor) {
    return editor.document;
  }

  return undefined;
}

function getErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<body>
  <h2>Failed to parse XML</h2>
  <pre>${escapeHtml(message)}</pre>
</body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
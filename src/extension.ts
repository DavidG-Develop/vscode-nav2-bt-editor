import * as vscode from "vscode";
import {
  parseBehaviorTreeXml,
  updateXmlAttributeByPath
} from "./bt_parser";
import { getWebviewHtml, PreviewOptions } from "./webview";

type WebviewMessage =
  | {
      type: "selectNode";
      path: number[];
    }
  | {
      type: "revealNode";
      startOffset: number;
    }
  | {
      type: "updateAttribute";
      path: number[];
      attrName: string;
      attrValue: string;
    };

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

      let selectedPath: number[] | undefined;
      let refreshTimer: ReturnType<typeof setTimeout> | undefined;

      const panel = vscode.window.createWebviewPanel(
        "nav2BtPreview",
        "Nav2 BT Preview",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
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
            nodes,
            selectedPath,
            getPreviewOptions(targetDocument.uri)
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          panel.webview.html = getErrorHtml(message);
        }
      }

      function scheduleUpdatePreview(): void {
        if (refreshTimer) {
          clearTimeout(refreshTimer);
        }

        refreshTimer = setTimeout(() => {
          updatePreview();
        }, 80);
      }

      panel.webview.onDidReceiveMessage(
        async (message: WebviewMessage) => {
          if (message.type === "selectNode") {
            selectedPath = message.path;
            return;
          }

          if (message.type === "revealNode") {
            await revealNode(targetDocument, message.startOffset);
            return;
          }

          if (message.type === "updateAttribute") {
            selectedPath = message.path;

            const updated = await updateAttribute(targetDocument, message);

            if (!updated) {
              return;
            }

            const autoSaveEdits = getAutoSaveEditsSetting(targetDocument.uri);

            if (autoSaveEdits) {
              const saved = await targetDocument.save();

              if (!saved) {
                vscode.window.showWarningMessage(
                  "XML attribute was updated, but the file could not be saved automatically."
                );
              }
            }

            scheduleUpdatePreview();
          }
        },
        undefined,
        context.subscriptions
      );

      updatePreview();

      const changeSubscription = vscode.workspace.onDidChangeTextDocument(
        (event) => {
          if (event.document.uri.toString() === targetDocument.uri.toString()) {
            scheduleUpdatePreview();
          }
        }
      );

      const configSubscription = vscode.workspace.onDidChangeConfiguration(
        (event) => {
          if (
            event.affectsConfiguration(
              "nav2BtPreview.openOnlyOneBehaviorTree",
              targetDocument.uri
            ) ||
            event.affectsConfiguration(
              "nav2BtPreview.autoFitOnTreeChange",
              targetDocument.uri
            ) ||
            event.affectsConfiguration(
              "nav2BtPreview.autoSaveEdits",
              targetDocument.uri
            )
          ) {
            scheduleUpdatePreview();
          }
        }
      );

      panel.onDidDispose(() => {
        if (refreshTimer) {
          clearTimeout(refreshTimer);
        }

        changeSubscription.dispose();
        configSubscription.dispose();
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

function getPreviewOptions(resourceUri: vscode.Uri): PreviewOptions {
  const configuration = vscode.workspace.getConfiguration(
    "nav2BtPreview",
    resourceUri
  );

  return {
    openOnlyOneBehaviorTree: configuration.get<boolean>(
      "openOnlyOneBehaviorTree",
      true
    ),
    autoFitOnTreeChange: configuration.get<boolean>(
      "autoFitOnTreeChange",
      true
    )
  };
}

function getAutoSaveEditsSetting(resourceUri: vscode.Uri): boolean {
  return vscode.workspace
    .getConfiguration("nav2BtPreview", resourceUri)
    .get<boolean>("autoSaveEdits", true);
}

async function revealNode(
  document: vscode.TextDocument,
  startOffset: number
): Promise<void> {
  const editor = await vscode.window.showTextDocument(
    document,
    vscode.ViewColumn.One
  );

  const position = document.positionAt(startOffset);
  const range = new vscode.Range(position, position);

  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

async function updateAttribute(
  document: vscode.TextDocument,
  message: Extract<WebviewMessage, { type: "updateAttribute" }>
): Promise<boolean> {
  const xmlText = document.getText();

  const updatedXml = updateXmlAttributeByPath(
    xmlText,
    message.path,
    message.attrName,
    message.attrValue
  );

  if (updatedXml === xmlText) {
    return true;
  }

  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(xmlText.length)
  );

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, fullRange, updatedXml);

  const success = await vscode.workspace.applyEdit(edit);

  if (!success) {
    vscode.window.showErrorMessage("Failed to update XML attribute.");
    return false;
  }

  return true;
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
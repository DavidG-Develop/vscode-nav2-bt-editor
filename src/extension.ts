import * as vscode from "vscode";
import {
  parseBehaviorTreeXml,
  parseTreeNodeDefinitionsFromXml,
  TreeNodeDefinitionMap,
  updateXmlAttributeByPath
} from "./bt_parser";
import { getWebviewHtml, PreviewOptions } from "./webview";

const IMPORTED_TREE_NODE_DEFINITIONS_KEY = "importedTreeNodeDefinitions";

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

type ImportedDefinitionQuickPickItem = vscode.QuickPickItem & {
  nodeId: string;
};

export function activate(context: vscode.ExtensionContext): void {
  const previewRefreshers = new Set<() => void>();

  const openPreviewDisposable = vscode.commands.registerCommand(
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
          const nodes = parseBehaviorTreeXml(
            xmlText,
            getImportedTreeNodeDefinitions(context)
          );

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

      previewRefreshers.add(scheduleUpdatePreview);

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

        previewRefreshers.delete(scheduleUpdatePreview);
        changeSubscription.dispose();
        configSubscription.dispose();
      });
    }
  );

  const importTreeNodesModelDisposable = vscode.commands.registerCommand(
    "nav2-bt-preview.importTreeNodesModel",
    async () => {
      const selectedFiles = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          XML: ["xml"],
          "All files": ["*"]
        },
        title: "Import BehaviorTree.CPP TreeNodesModel XML"
      });

      const selectedFile = selectedFiles?.[0];

      if (!selectedFile) {
        return;
      }

      const fileData = await vscode.workspace.fs.readFile(selectedFile);
      const xmlText = Buffer.from(fileData).toString("utf8");

      await importTreeNodeDefinitionsFromText(
        context,
        xmlText,
        selectedFile.fsPath,
        previewRefreshers
      );
    }
  );

  const importTreeNodesModelFromUrlDisposable = vscode.commands.registerCommand(
    "nav2-bt-preview.importTreeNodesModelFromUrl",
    async () => {
      const url = await vscode.window.showInputBox({
        title: "Import BehaviorTree.CPP TreeNodesModel XML from URL",
        prompt:
          "Paste a URL to an XML file. GitHub blob URLs are converted to raw URLs automatically.",
        placeHolder:
          "https://github.com/ros-navigation/navigation2/blob/main/nav2_behavior_tree/nav2_tree_nodes.xml"
      });

      if (!url) {
        return;
      }

      const normalizedUrl = normalizeGitHubBlobUrlToRaw(url);
      const response = await fetch(normalizedUrl);

      if (!response.ok) {
        vscode.window.showErrorMessage(
          `Failed to download TreeNodesModel XML: HTTP ${response.status}`
        );
        return;
      }

      const xmlText = await response.text();

      await importTreeNodeDefinitionsFromText(
        context,
        xmlText,
        normalizedUrl,
        previewRefreshers
      );
    }
  );

  const removeImportedTreeNodeDefinitionDisposable =
    vscode.commands.registerCommand(
      "nav2-bt-preview.removeImportedTreeNodeDefinition",
      async () => {
        await removeImportedTreeNodeDefinitions(context, previewRefreshers);
      }
    );

  const clearImportedTreeNodesModelDisposable = vscode.commands.registerCommand(
    "nav2-bt-preview.clearImportedTreeNodesModel",
    async () => {
      await context.globalState.update(
        IMPORTED_TREE_NODE_DEFINITIONS_KEY,
        undefined
      );

      for (const refresh of previewRefreshers) {
        refresh();
      }

      vscode.window.showInformationMessage(
        "Cleared imported TreeNodesModel definitions."
      );
    }
  );

  context.subscriptions.push(
    openPreviewDisposable,
    importTreeNodesModelDisposable,
    importTreeNodesModelFromUrlDisposable,
    removeImportedTreeNodeDefinitionDisposable,
    clearImportedTreeNodesModelDisposable
  );
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

async function importTreeNodeDefinitionsFromText(
  context: vscode.ExtensionContext,
  xmlText: string,
  sourceLabel: string,
  previewRefreshers: Set<() => void>
): Promise<void> {
  const importedDefinitions = parseTreeNodeDefinitionsFromXml(xmlText);
  const importedCount = Object.keys(importedDefinitions).length;

  if (importedCount === 0) {
    vscode.window.showWarningMessage(
      "No TreeNodesModel node definitions were found in the selected XML."
    );
    return;
  }

  const existingDefinitions = getImportedTreeNodeDefinitions(context);

  const mergedDefinitions: TreeNodeDefinitionMap = {
    ...existingDefinitions,
    ...importedDefinitions
  };

  await context.globalState.update(
    IMPORTED_TREE_NODE_DEFINITIONS_KEY,
    mergedDefinitions
  );

  for (const refresh of previewRefreshers) {
    refresh();
  }

  vscode.window.showInformationMessage(
    `Imported ${importedCount} TreeNodesModel definitions from ${sourceLabel}. Total stored definitions: ${Object.keys(mergedDefinitions).length}.`
  );
}

async function removeImportedTreeNodeDefinitions(
  context: vscode.ExtensionContext,
  previewRefreshers: Set<() => void>
): Promise<void> {
  const existingDefinitions = getImportedTreeNodeDefinitions(context);
  const entries = Object.entries(existingDefinitions).sort(([leftId], [rightId]) =>
    leftId.localeCompare(rightId)
  );

  if (entries.length === 0) {
    vscode.window.showInformationMessage(
      "There are no imported TreeNodesModel definitions to remove."
    );
    return;
  }

  const items: ImportedDefinitionQuickPickItem[] = entries.map(([nodeId, kind]) => {
    return {
      nodeId,
      label: nodeId,
      description: kind,
      detail: `Imported ${kind} node definition`
    };
  });

  const selectedItems = await vscode.window.showQuickPick(items, {
    title: "Remove Imported TreeNode Definitions",
    placeHolder: "Select one or more imported node definitions to remove",
    canPickMany: true
  });

  if (!selectedItems || selectedItems.length === 0) {
    return;
  }

  const updatedDefinitions: TreeNodeDefinitionMap = {
    ...existingDefinitions
  };

  for (const item of selectedItems) {
    delete updatedDefinitions[item.nodeId];
  }

  await context.globalState.update(
    IMPORTED_TREE_NODE_DEFINITIONS_KEY,
    Object.keys(updatedDefinitions).length > 0 ? updatedDefinitions : undefined
  );

  for (const refresh of previewRefreshers) {
    refresh();
  }

  vscode.window.showInformationMessage(
    `Removed ${selectedItems.length} imported TreeNodesModel definition${selectedItems.length === 1 ? "" : "s"}. Remaining stored definitions: ${Object.keys(updatedDefinitions).length}.`
  );
}

function getImportedTreeNodeDefinitions(
  context: vscode.ExtensionContext
): TreeNodeDefinitionMap {
  return context.globalState.get<TreeNodeDefinitionMap>(
    IMPORTED_TREE_NODE_DEFINITIONS_KEY,
    {}
  );
}

function normalizeGitHubBlobUrlToRaw(url: string): string {
  try {
    const parsedUrl = new URL(url);

    if (
      parsedUrl.hostname !== "github.com" ||
      !parsedUrl.pathname.includes("/blob/")
    ) {
      return url;
    }

    const parts = parsedUrl.pathname.split("/").filter(Boolean);
    const blobIndex = parts.indexOf("blob");

    if (blobIndex < 2 || blobIndex + 2 >= parts.length) {
      return url;
    }

    const owner = parts[0];
    const repo = parts[1];
    const branch = parts[blobIndex + 1];
    const filePath = parts.slice(blobIndex + 2).join("/");

    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  } catch {
    return url;
  }
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
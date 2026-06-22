import * as vscode from "vscode";
import {
  BehaviorTreeTemplate,
  BehaviorTreeTemplateMap,
  BtNode,
  deleteBehaviorTreeById,
  deleteXmlNodeByPath,
  getTreeNodeDefinitionCatalog,
  hasSubTreeReferenceToBehaviorTree,
  insertBehaviorTreeAfterPath,
  insertBehaviorTreeXmlAfterPath,
  insertXmlChildNodeByPath,
  insertXmlNodeCopyByPath,
  moveXmlNodeToParentByPath,
  moveXmlNodeByPath,
  parseBehaviorTreeTemplatesFromXml,
  parseBehaviorTreeXml,
  parseTreeNodeDefinitionsFromXml,
  TreeNodeDefinition,
  TreeNodeDefinitionMap,
  updateXmlAttributeByPath
} from "./bt_parser";
import { getWebviewHtml, EditorOptions } from "./webview";

const IMPORTED_TREE_NODE_DEFINITIONS_KEY = "importedTreeNodeDefinitions";
const IMPORTED_BEHAVIOR_TREES_KEY = "importedBehaviorTrees";

type WebviewMessage =
  | {
      type: "selectNode";
      path: number[];
    }
  | {
      type: "revealNode";
      path?: number[];
      startOffset: number;
    }
  | {
      type: "updateAttribute";
      path: number[];
      attrName: string;
      attrValue: string;
    }
  | {
      type: "addChildNode";
      parentPath: number[];
      tagName: string;
      attributes: Record<string, string>;
    }
  | {
      type: "addBehaviorTree";
      referencePath: number[];
      behaviorTreeId: string;
    }
  | {
      type: "deleteNode";
      path: number[];
      deleteReferencedBehaviorTree?: boolean;
    }
  | {
      type: "moveNode";
      path: number[];
      targetIndex: number;
    }
  | {
      type: "pasteNode";
      sourcePath: number[];
      parentPath: number[];
      targetIndex?: number;
      move?: boolean;
    };

type ImportedDefinitionQuickPickItem = vscode.QuickPickItem & {
  nodeId: string;
};

type ImportedBehaviorTreeQuickPickItem = vscode.QuickPickItem & {
  treeId: string;
};

export function activate(context: vscode.ExtensionContext): void {
  const editorRefreshers = new Set<() => void>();

  const openEditorDisposable = vscode.commands.registerCommand(
    "nav2-bt-editor.openEditor",
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
      let suppressDocumentRefreshUntil = 0;
      let suppressXmlSelectionSyncUntil = 0;

      const panel = vscode.window.createWebviewPanel(
        "nav2BtEditor",
        "Nav2 BT Editor",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "media")
          ]
        }
      );

      const xmlSelectionDecoration =
        vscode.window.createTextEditorDecorationType({
          isWholeLine: true,
          backgroundColor: "rgba(255, 152, 0, 0.16)",
          border: "1px solid rgba(255, 152, 0, 0.65)",
          overviewRulerColor: "rgba(255, 152, 0, 0.9)",
          overviewRulerLane: vscode.OverviewRulerLane.Right
        });

      function updateEditor(): void {
        try {
          const xmlText = targetDocument.getText();
          const importedDefinitions = getImportedTreeNodeDefinitions(context);
          const importedBehaviorTrees = getImportedBehaviorTrees(context);
          const nodes = parseBehaviorTreeXml(xmlText, importedDefinitions);
          const treeNodeDefinitions = getTreeNodeDefinitionCatalog(
            xmlText,
            importedDefinitions
          );

          updateXmlSelectionDecoration();

          panel.webview.html = getWebviewHtml(
            panel.webview,
            context.extensionUri,
            nodes,
            selectedPath,
            getEditorOptions(targetDocument.uri),
            treeNodeDefinitions,
            getImportedBehaviorTreeViews(
              importedBehaviorTrees,
              importedDefinitions
            )
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          panel.webview.html = getErrorHtml(message);
        }
      }

      function scheduleUpdateEditor(): void {
        if (refreshTimer) {
          clearTimeout(refreshTimer);
        }

        refreshTimer = setTimeout(() => {
          updateEditor();
        }, 80);
      }

      function suppressDocumentRefresh(milliseconds: number): void {
        suppressDocumentRefreshUntil = Math.max(
          suppressDocumentRefreshUntil,
          Date.now() + milliseconds
        );
      }

      function suppressEditorSideEffects(milliseconds: number): void {
        suppressDocumentRefresh(milliseconds);
        suppressXmlSelectionSync(milliseconds);
      }

      function isDocumentRefreshSuppressed(): boolean {
        return Date.now() < suppressDocumentRefreshUntil;
      }

      function suppressXmlSelectionSync(milliseconds: number): void {
        suppressXmlSelectionSyncUntil = Math.max(
          suppressXmlSelectionSyncUntil,
          Date.now() + milliseconds
        );
      }

      function isXmlSelectionSyncSuppressed(): boolean {
        return Date.now() < suppressXmlSelectionSyncUntil;
      }

      function updateXmlSelectionDecoration(): void {
        const ranges = getSelectedXmlRanges(
          targetDocument,
          context,
          selectedPath
        );

        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document.uri.toString() !== targetDocument.uri.toString()) {
            continue;
          }

          editor.setDecorations(xmlSelectionDecoration, ranges);
        }
      }

      function clearXmlSelectionDecoration(): void {
        for (const editor of vscode.window.visibleTextEditors) {
          editor.setDecorations(xmlSelectionDecoration, []);
        }
      }

      function selectPathFromXml(path: number[]): void {
        selectedPath = path;
        updateXmlSelectionDecoration();

        void panel.webview.postMessage({
          type: "xmlNodeSelected",
          path
        });
      }

      function syncWebviewFromDocument(refit = false): void {
        try {
          const xmlText = targetDocument.getText();
          const importedDefinitions = getImportedTreeNodeDefinitions(context);
          const nodes = parseBehaviorTreeXml(xmlText, importedDefinitions);

          void panel.webview.postMessage({
            type: "documentSynced",
            nodes,
            selectedPath: selectedPath ?? null,
            refit
          });

          updateXmlSelectionDecoration();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          panel.webview.html = getErrorHtml(message);
        }
      }

      editorRefreshers.add(scheduleUpdateEditor);

      panel.webview.onDidReceiveMessage(
        async (message: WebviewMessage) => {
          if (message.type === "selectNode") {
            selectedPath = message.path;
            updateXmlSelectionDecoration();
            return;
          }

          if (message.type === "revealNode") {
            await revealNode(targetDocument, message.path, message.startOffset);
            return;
          }

          if (message.type === "updateAttribute") {
            selectedPath = message.path;

            suppressEditorSideEffects(2500);

            const updated = await updateAttribute(targetDocument, message);

            if (!updated) {
              suppressDocumentRefreshUntil = 0;
              suppressXmlSelectionSyncUntil = 0;
              syncWebviewFromDocument();
              return;
            }

            const autoSaveEdits = getAutoSaveEditsSetting(targetDocument.uri);

            if (autoSaveEdits) {
              suppressEditorSideEffects(2500);

              const saved = await targetDocument.save();

              suppressEditorSideEffects(2500);

              if (!saved) {
                vscode.window.showWarningMessage(
                  "XML attribute was updated, but the file could not be saved automatically."
                );
              }
            }

            updateXmlSelectionDecoration();

            return;
          }

          if (message.type === "addChildNode") {
            suppressEditorSideEffects(2500);

            const result = await addChildNode(context, targetDocument, message);

            if (!result) {
              suppressDocumentRefreshUntil = 0;
              suppressXmlSelectionSyncUntil = 0;
              syncWebviewFromDocument();
              return;
            }

            selectedPath = result.childPath;

            const autoSaveEdits = getAutoSaveEditsSetting(targetDocument.uri);

            if (autoSaveEdits) {
              suppressEditorSideEffects(2500);

              const saved = await targetDocument.save();

              suppressEditorSideEffects(2500);

              if (!saved) {
                vscode.window.showWarningMessage(
                  "XML child node was added, but the file could not be saved automatically."
                );
              }
            }

            syncWebviewFromDocument();

            return;
          }

          if (message.type === "pasteNode") {
            suppressEditorSideEffects(2500);

            const result = await pasteNode(targetDocument, message);

            if (!result) {
              suppressDocumentRefreshUntil = 0;
              suppressXmlSelectionSyncUntil = 0;
              syncWebviewFromDocument();
              return;
            }

            selectedPath = result.copiedPath;

            const autoSaveEdits = getAutoSaveEditsSetting(targetDocument.uri);

            if (autoSaveEdits) {
              suppressEditorSideEffects(2500);

              const saved = await targetDocument.save();

              suppressEditorSideEffects(2500);

              if (!saved) {
                vscode.window.showWarningMessage(
                  "XML node was pasted, but the file could not be saved automatically."
                );
              }
            }

            syncWebviewFromDocument();

            return;
          }

          if (message.type === "addBehaviorTree") {
            suppressEditorSideEffects(2500);

            const result = await addBehaviorTree(
              context,
              targetDocument,
              message
            );

            if (!result) {
              suppressDocumentRefreshUntil = 0;
              suppressXmlSelectionSyncUntil = 0;
              syncWebviewFromDocument();
              return;
            }

            selectedPath = result.behaviorTreePath;

            const autoSaveEdits = getAutoSaveEditsSetting(targetDocument.uri);

            if (autoSaveEdits) {
              suppressEditorSideEffects(2500);

              const saved = await targetDocument.save();

              suppressEditorSideEffects(2500);

              if (!saved) {
                vscode.window.showWarningMessage(
                  "BehaviorTree was added, but the file could not be saved automatically."
                );
              }
            }

            syncWebviewFromDocument();

            return;
          }

          if (message.type === "deleteNode") {
            suppressEditorSideEffects(2500);

            const result = await deleteNode(targetDocument, message);

            if (!result) {
              suppressDocumentRefreshUntil = 0;
              suppressXmlSelectionSyncUntil = 0;
              syncWebviewFromDocument();
              return;
            }

            selectedPath = result.nextSelectedPath;

            const autoSaveEdits = getAutoSaveEditsSetting(targetDocument.uri);

            if (autoSaveEdits) {
              suppressEditorSideEffects(2500);

              const saved = await targetDocument.save();

              suppressEditorSideEffects(2500);

              if (!saved) {
                vscode.window.showWarningMessage(
                  "XML node was deleted, but the file could not be saved automatically."
                );
              }
            }

            syncWebviewFromDocument();

            return;
          }

          if (message.type === "moveNode") {
            suppressEditorSideEffects(2500);

            const result = await moveNode(targetDocument, message);

            if (!result) {
              suppressDocumentRefreshUntil = 0;
              suppressXmlSelectionSyncUntil = 0;
              syncWebviewFromDocument();
              return;
            }

            selectedPath = result.movedPath;

            const autoSaveEdits = getAutoSaveEditsSetting(targetDocument.uri);

            if (autoSaveEdits) {
              suppressEditorSideEffects(2500);

              const saved = await targetDocument.save();

              suppressEditorSideEffects(2500);

              if (!saved) {
                vscode.window.showWarningMessage(
                  "XML node was moved, but the file could not be saved automatically."
                );
              }
            }

            postParsedSourceMetadataUpdate(
              panel.webview,
              context,
              targetDocument
            );
            updateXmlSelectionDecoration();

            return;
          }
        },
        undefined,
        context.subscriptions
      );

      updateEditor();

      const changeSubscription = vscode.workspace.onDidChangeTextDocument(
        (event) => {
          if (event.document.uri.toString() !== targetDocument.uri.toString()) {
            return;
          }

          if (isDocumentRefreshSuppressed()) {
            updateXmlSelectionDecoration();
            return;
          }

          scheduleUpdateEditor();
          updateXmlSelectionDecoration();
        }
      );

      const selectionSubscription = vscode.window.onDidChangeTextEditorSelection(
        (event) => {
          if (event.textEditor.document.uri.toString() !== targetDocument.uri.toString()) {
            return;
          }

          if (isXmlSelectionSyncSuppressed()) {
            return;
          }

          const node = findParsedNodeAtPosition(
            targetDocument,
            context,
            event.textEditor.selection.active
          );

          if (!node || (selectedPath && pathsEqual(node.source.path, selectedPath))) {
            return;
          }

          selectPathFromXml(node.source.path);
        }
      );

      const visibleEditorsSubscription = vscode.window.onDidChangeVisibleTextEditors(
        () => {
          updateXmlSelectionDecoration();
        }
      );

      const configSubscription = vscode.workspace.onDidChangeConfiguration(
        (event) => {
          if (
            event.affectsConfiguration(
              "nav2BtEditor.openOnlyOneBehaviorTree",
              targetDocument.uri
            ) ||
            event.affectsConfiguration(
              "nav2BtEditor.autoFitOnTreeChange",
              targetDocument.uri
            ) ||
            event.affectsConfiguration(
              "nav2BtEditor.autoSaveEdits",
              targetDocument.uri
            ) ||
            event.affectsConfiguration(
              "nav2BtEditor.allowEmptyAttributes",
              targetDocument.uri
            ) ||
            event.affectsConfiguration(
              "nav2BtEditor.includeFullBehaviorTree",
              targetDocument.uri
            )
          ) {
            scheduleUpdateEditor();
          }
        }
      );

      panel.onDidDispose(() => {
        if (refreshTimer) {
          clearTimeout(refreshTimer);
        }

        editorRefreshers.delete(scheduleUpdateEditor);
        clearXmlSelectionDecoration();
        xmlSelectionDecoration.dispose();
        changeSubscription.dispose();
        selectionSubscription.dispose();
        visibleEditorsSubscription.dispose();
        configSubscription.dispose();
      });
    }
  );

  const importTreeNodesModelDisposable = vscode.commands.registerCommand(
    "nav2-bt-editor.importTreeNodesModel",
    async () => {
      const selectedFiles = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          XML: ["xml"],
          "All files": ["*"]
        },
        title: "Add TreeNodesModel Definitions from XML File"
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
        editorRefreshers
      );
    }
  );

  const importTreeNodesModelFromUrlDisposable = vscode.commands.registerCommand(
    "nav2-bt-editor.importTreeNodesModelFromUrl",
    async () => {
      const url = await vscode.window.showInputBox({
        title: "Add TreeNodesModel Definitions from URL",
        prompt:
          "Paste a URL to an XML file. GitHub blob URLs are converted to raw URLs automatically.",
        placeHolder:
          "https://github.com/ros-navigation/navigation2/blob/main/nav2_behavior_tree/nav2_tree_nodes.xml"
      });

      if (!url) {
        return;
      }

      const download = await downloadXmlFromUrl(url, "TreeNodesModel");

      if (!download) {
        return;
      }

      try {
        await importTreeNodeDefinitionsFromText(
          context,
          download.xmlText,
          download.normalizedUrl,
          editorRefreshers
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to import TreeNodesModel XML from URL: ${formatErrorMessage(error)}`
        );
      }
    }
  );

  const importBehaviorTreeDisposable = vscode.commands.registerCommand(
    "nav2-bt-editor.importBehaviorTree",
    async () => {
      const selectedFiles = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          XML: ["xml"],
          "All files": ["*"]
        },
        title: "Add BehaviorTree SubTrees from XML File"
      });

      const selectedFile = selectedFiles?.[0];

      if (!selectedFile) {
        return;
      }

      const fileData = await vscode.workspace.fs.readFile(selectedFile);
      const xmlText = Buffer.from(fileData).toString("utf8");

      await importBehaviorTreesFromText(
        context,
        xmlText,
        selectedFile.fsPath,
        editorRefreshers
      );
    }
  );

  const importBehaviorTreeFromUrlDisposable = vscode.commands.registerCommand(
    "nav2-bt-editor.importBehaviorTreeFromUrl",
    async () => {
      const url = await vscode.window.showInputBox({
        title: "Add BehaviorTree SubTrees from URL",
        prompt:
          "Paste a URL to an XML file. GitHub blob URLs are converted to raw URLs automatically.",
        placeHolder:
          "https://github.com/ros-navigation/navigation2/blob/main/nav2_bt_navigator/behavior_trees/navigate_to_pose_w_replanning_and_recovery.xml"
      });

      if (!url) {
        return;
      }

      const download = await downloadXmlFromUrl(url, "BehaviorTree");

      if (!download) {
        return;
      }

      try {
        await importBehaviorTreesFromText(
          context,
          download.xmlText,
          download.normalizedUrl,
          editorRefreshers
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to import BehaviorTree XML from URL: ${formatErrorMessage(error)}`
        );
      }
    }
  );

  const removeImportedTreeNodeDefinitionDisposable =
    vscode.commands.registerCommand(
      "nav2-bt-editor.removeImportedTreeNodeDefinition",
      async () => {
        await removeImportedTreeNodeDefinitions(context, editorRefreshers);
      }
    );

  const removeImportedBehaviorTreeDisposable = vscode.commands.registerCommand(
    "nav2-bt-editor.removeImportedBehaviorTree",
    async () => {
      await removeImportedBehaviorTrees(context, editorRefreshers);
    }
  );

  const clearImportedTreeNodesModelDisposable = vscode.commands.registerCommand(
    "nav2-bt-editor.clearImportedTreeNodesModel",
    async () => {
      await context.globalState.update(
        IMPORTED_TREE_NODE_DEFINITIONS_KEY,
        undefined
      );

      for (const refresh of editorRefreshers) {
        refresh();
      }

      vscode.window.showInformationMessage(
        "Cleared imported TreeNodesModel definitions."
      );
    }
  );

  const clearImportedBehaviorTreesDisposable = vscode.commands.registerCommand(
    "nav2-bt-editor.clearImportedBehaviorTrees",
    async () => {
      await context.globalState.update(IMPORTED_BEHAVIOR_TREES_KEY, undefined);

      for (const refresh of editorRefreshers) {
        refresh();
      }

      vscode.window.showInformationMessage(
        "Cleared imported BehaviorTree subtree templates."
      );
    }
  );

  context.subscriptions.push(
    openEditorDisposable,
    importTreeNodesModelDisposable,
    importTreeNodesModelFromUrlDisposable,
    importBehaviorTreeDisposable,
    importBehaviorTreeFromUrlDisposable,
    removeImportedTreeNodeDefinitionDisposable,
    removeImportedBehaviorTreeDisposable,
    clearImportedBehaviorTreesDisposable,
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
  editorRefreshers: Set<() => void>
): Promise<void> {
  const importedDefinitions = parseTreeNodeDefinitionsFromXml(
    xmlText,
    "imported"
  );
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

  for (const refresh of editorRefreshers) {
    refresh();
  }

  vscode.window.showInformationMessage(
    `Imported ${importedCount} TreeNodesModel definitions from ${sourceLabel}. Total stored definitions: ${Object.keys(mergedDefinitions).length}.`
  );
}

async function importBehaviorTreesFromText(
  context: vscode.ExtensionContext,
  xmlText: string,
  sourceLabel: string,
  editorRefreshers: Set<() => void>
): Promise<void> {
  const importedBehaviorTrees = parseBehaviorTreeTemplatesFromXml(
    xmlText,
    sourceLabel
  );
  const importedCount = Object.keys(importedBehaviorTrees).length;

  if (importedCount === 0) {
    vscode.window.showWarningMessage(
      "No complete BehaviorTree definitions with IDs were found in the selected XML."
    );
    return;
  }

  const existingBehaviorTrees = getImportedBehaviorTrees(context);

  const mergedBehaviorTrees: BehaviorTreeTemplateMap = {
    ...existingBehaviorTrees,
    ...importedBehaviorTrees
  };

  await context.globalState.update(
    IMPORTED_BEHAVIOR_TREES_KEY,
    mergedBehaviorTrees
  );

  for (const refresh of editorRefreshers) {
    refresh();
  }

  vscode.window.showInformationMessage(
    `Imported ${importedCount} BehaviorTree subtree template${importedCount === 1 ? "" : "s"} from ${sourceLabel}. Total stored templates: ${Object.keys(mergedBehaviorTrees).length}.`
  );
}

async function removeImportedTreeNodeDefinitions(
  context: vscode.ExtensionContext,
  editorRefreshers: Set<() => void>
): Promise<void> {
  const existingDefinitions = getImportedTreeNodeDefinitions(context);
  const entries = Object.entries(existingDefinitions).sort(
    ([leftId], [rightId]) => leftId.localeCompare(rightId)
  );

  if (entries.length === 0) {
    vscode.window.showInformationMessage(
      "There are no imported TreeNodesModel definitions to remove."
    );
    return;
  }

  const items: ImportedDefinitionQuickPickItem[] = entries.map(
    ([nodeId, definition]) => {
      return {
        nodeId,
        label: nodeId,
        description: definition.kind,
        detail:
          definition.ports.length > 0
            ? `Ports: ${definition.ports.map((port) => port.name).join(", ")}`
            : "No ports defined"
      };
    }
  );

  const selectedItems = await vscode.window.showQuickPick(items, {
    title: "Remove Selected TreeNodesModel Definitions",
    placeHolder: "Select one or more TreeNodesModel definitions to remove",
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

  for (const refresh of editorRefreshers) {
    refresh();
  }

  vscode.window.showInformationMessage(
    `Removed ${selectedItems.length} imported TreeNodesModel definition${selectedItems.length === 1 ? "" : "s"}. Remaining stored definitions: ${Object.keys(updatedDefinitions).length}.`
  );
}

async function removeImportedBehaviorTrees(
  context: vscode.ExtensionContext,
  editorRefreshers: Set<() => void>
): Promise<void> {
  const existingBehaviorTrees = getImportedBehaviorTrees(context);
  const entries = Object.entries(existingBehaviorTrees).sort(
    ([leftId], [rightId]) => leftId.localeCompare(rightId)
  );

  if (entries.length === 0) {
    vscode.window.showInformationMessage(
      "There are no imported BehaviorTree subtree templates to remove."
    );
    return;
  }

  const items: ImportedBehaviorTreeQuickPickItem[] = entries.map(
    ([treeId, tree]) => {
      return {
        treeId,
        label: treeId,
        description: tree.source,
        detail: "Imported BehaviorTree subtree template"
      };
    }
  );

  const selectedItems = await vscode.window.showQuickPick(items, {
    title: "Remove Selected BehaviorTree SubTrees",
    placeHolder: "Select one or more BehaviorTree SubTrees to remove",
    canPickMany: true
  });

  if (!selectedItems || selectedItems.length === 0) {
    return;
  }

  const updatedBehaviorTrees: BehaviorTreeTemplateMap = {
    ...existingBehaviorTrees
  };

  for (const item of selectedItems) {
    delete updatedBehaviorTrees[item.treeId];
  }

  await context.globalState.update(
    IMPORTED_BEHAVIOR_TREES_KEY,
    Object.keys(updatedBehaviorTrees).length > 0
      ? updatedBehaviorTrees
      : undefined
  );

  for (const refresh of editorRefreshers) {
    refresh();
  }

  vscode.window.showInformationMessage(
    `Removed ${selectedItems.length} imported BehaviorTree subtree template${selectedItems.length === 1 ? "" : "s"}. Remaining stored templates: ${Object.keys(updatedBehaviorTrees).length}.`
  );
}

function getImportedTreeNodeDefinitions(
  context: vscode.ExtensionContext
): TreeNodeDefinitionMap {
  const raw = context.globalState.get<Record<string, unknown>>(
    IMPORTED_TREE_NODE_DEFINITIONS_KEY,
    {}
  );

  const normalized: TreeNodeDefinitionMap = {};

  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      normalized[id] = {
        id,
        kind: value as TreeNodeDefinition["kind"],
        ports: [],
        source: "imported"
      };
      continue;
    }

    if (isTreeNodeDefinition(value)) {
      normalized[id] = {
        ...value,
        id,
        source: "imported"
      };
    }
  }

  return normalized;
}

function getImportedBehaviorTrees(
  context: vscode.ExtensionContext
): BehaviorTreeTemplateMap {
  const raw = context.globalState.get<Record<string, unknown>>(
    IMPORTED_BEHAVIOR_TREES_KEY,
    {}
  );

  const normalized: BehaviorTreeTemplateMap = {};

  for (const [id, value] of Object.entries(raw)) {
    if (!isBehaviorTreeTemplate(value)) {
      continue;
    }

    normalized[id] = {
      ...value,
      id
    };
  }

  return normalized;
}

function getImportedBehaviorTreeViews(
  importedBehaviorTrees: BehaviorTreeTemplateMap,
  importedDefinitions: TreeNodeDefinitionMap
): Array<{ id: string; source: string; tree: BtNode }> {
  const previews: Array<{ id: string; source: string; tree: BtNode }> = [];

  for (const tree of Object.values(importedBehaviorTrees)) {
    const parsedTrees = parseBehaviorTreeXml(
      tree.xmlText,
      importedDefinitions
    );
    const parsedTree = parsedTrees.find(
      (node) => node.tag === "BehaviorTree" && node.attributes["ID"] === tree.id
    );

    if (!parsedTree) {
      continue;
    }

    previews.push({
      id: tree.id,
      source: tree.source,
      tree: parsedTree
    });
  }

  return previews.sort((left, right) => left.id.localeCompare(right.id));
}

function isTreeNodeDefinition(value: unknown): value is TreeNodeDefinition {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybe = value as Partial<TreeNodeDefinition>;

  return (
    typeof maybe.id === "string" &&
    (maybe.kind === "control" ||
      maybe.kind === "decorator" ||
      maybe.kind === "condition" ||
      maybe.kind === "action") &&
    Array.isArray(maybe.ports)
  );
}

function isBehaviorTreeTemplate(value: unknown): value is BehaviorTreeTemplate {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybe = value as Partial<BehaviorTreeTemplate>;

  return (
    typeof maybe.id === "string" &&
    typeof maybe.xmlText === "string" &&
    typeof maybe.source === "string"
  );
}

async function downloadXmlFromUrl(
  url: string,
  label: string
): Promise<{ normalizedUrl: string; xmlText: string } | undefined> {
  const normalizedUrl = normalizeGitHubBlobUrlToRaw(url);
  let response: Response;

  try {
    response = await fetch(normalizedUrl);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to download ${label} XML: ${formatErrorMessage(error)}`
    );
    return undefined;
  }

  if (!response.ok) {
    vscode.window.showErrorMessage(
      `Failed to download ${label} XML: HTTP ${response.status}`
    );
    return undefined;
  }

  try {
    return {
      normalizedUrl,
      xmlText: await response.text()
    };
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to read ${label} XML response: ${formatErrorMessage(error)}`
    );
    return undefined;
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function getEditorOptions(resourceUri: vscode.Uri): EditorOptions {
  const configuration = vscode.workspace.getConfiguration(
    "nav2BtEditor",
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
    ),
    allowEmptyAttributes: configuration.get<boolean>(
      "allowEmptyAttributes",
      false
    ),
    includeFullBehaviorTree: configuration.get<boolean>(
      "includeFullBehaviorTree",
      false
    )
  };
}

function getIncludeFullBehaviorTreeSetting(resourceUri: vscode.Uri): boolean {
  return vscode.workspace
    .getConfiguration("nav2BtEditor", resourceUri)
    .get<boolean>("includeFullBehaviorTree", false);
}

function getAutoSaveEditsSetting(resourceUri: vscode.Uri): boolean {
  return vscode.workspace
    .getConfiguration("nav2BtEditor", resourceUri)
    .get<boolean>("autoSaveEdits", true);
}

function getAllowEmptyAttributesSetting(resourceUri: vscode.Uri): boolean {
  return vscode.workspace
    .getConfiguration("nav2BtEditor", resourceUri)
    .get<boolean>("allowEmptyAttributes", false);
}

function postParsedSourceMetadataUpdate(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  document: vscode.TextDocument
): void {
  try {
    const nodes = parseBehaviorTreeXml(
      document.getText(),
      getImportedTreeNodeDefinitions(context)
    );

    void webview.postMessage({
      type: "sourceMetadataUpdated",
      nodes
    });
  } catch {
    // The next successful parse will refresh source metadata.
  }
}

function getSelectedXmlRanges(
  document: vscode.TextDocument,
  context: vscode.ExtensionContext,
  selectedPath: number[] | undefined
): vscode.Range[] {
  if (!selectedPath) {
    return [];
  }

  try {
    const parsedNodes = parseBehaviorTreeXml(
      document.getText(),
      getImportedTreeNodeDefinitions(context)
    );
    const selectedNode = findParsedNodeByPath(parsedNodes, selectedPath);

    if (!selectedNode) {
      return [];
    }

    return [getNodeStartTagRange(document, selectedNode)];
  } catch {
    return [];
  }
}

function findParsedNodeAtPosition(
  document: vscode.TextDocument,
  context: vscode.ExtensionContext,
  position: vscode.Position
): BtNode | undefined {
  try {
    const parsedNodes = parseBehaviorTreeXml(
      document.getText(),
      getImportedTreeNodeDefinitions(context)
    );
    const offset = document.offsetAt(position);

    return findParsedNodeAtOffset(parsedNodes, offset) ??
      findParsedNodeOnLine(parsedNodes, position.line);
  } catch {
    return undefined;
  }
}

function findParsedNodeAtOffset(
  nodes: BtNode[],
  offset: number
): BtNode | undefined {
  let bestMatch: BtNode | undefined;

  for (const node of nodes) {
    const match = findParsedNodeAtOffsetRecursive(node, offset);

    if (
      match &&
      (!bestMatch || match.source.path.length > bestMatch.source.path.length)
    ) {
      bestMatch = match;
    }
  }

  return bestMatch;
}

function findParsedNodeAtOffsetRecursive(
  node: BtNode,
  offset: number
): BtNode | undefined {
  let bestMatch: BtNode | undefined;

  if (
    offset >= node.source.startOffset &&
    offset <= node.source.endOpenTagOffset
  ) {
    bestMatch = node;
  }

  for (const child of node.children) {
    const match = findParsedNodeAtOffsetRecursive(child, offset);

    if (
      match &&
      (!bestMatch || match.source.path.length > bestMatch.source.path.length)
    ) {
      bestMatch = match;
    }
  }

  return bestMatch;
}

function findParsedNodeOnLine(
  nodes: BtNode[],
  line: number
): BtNode | undefined {
  let bestMatch: BtNode | undefined;

  for (const node of nodes) {
    const match = findParsedNodeOnLineRecursive(node, line);

    if (
      match &&
      (!bestMatch || match.source.path.length > bestMatch.source.path.length)
    ) {
      bestMatch = match;
    }
  }

  return bestMatch;
}

function findParsedNodeOnLineRecursive(
  node: BtNode,
  line: number
): BtNode | undefined {
  let bestMatch: BtNode | undefined;
  const startLine = node.source.line;
  const endLine = startLine + countLineBreaks(node.source.startTag);

  if (line >= startLine && line <= endLine) {
    bestMatch = node;
  }

  for (const child of node.children) {
    const match = findParsedNodeOnLineRecursive(child, line);

    if (
      match &&
      (!bestMatch || match.source.path.length > bestMatch.source.path.length)
    ) {
      bestMatch = match;
    }
  }

  return bestMatch;
}

function getNodeStartTagRange(
  document: vscode.TextDocument,
  node: BtNode
): vscode.Range {
  const start = document.positionAt(node.source.startOffset);
  const end = document.positionAt(
    Math.max(node.source.startOffset, node.source.endOpenTagOffset - 1)
  );

  return new vscode.Range(start, end);
}

function countLineBreaks(value: string): number {
  return (value.match(/\n/g) ?? []).length;
}

async function revealNode(
  document: vscode.TextDocument,
  path: number[] | undefined,
  fallbackStartOffset: number
): Promise<void> {
  let startOffset = fallbackStartOffset;

  if (path) {
    try {
      const parsedNodes = parseBehaviorTreeXml(document.getText());
      const parsedNode = findParsedNodeByPath(parsedNodes, path);

      if (parsedNode) {
        startOffset = parsedNode.source.startOffset;
      }
    } catch {
      startOffset = fallbackStartOffset;
    }
  }

  if (startOffset < 0) {
    vscode.window.showInformationMessage(
      "This node has not been reparsed yet, so no source location is available."
    );
    return;
  }

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
  const allowEmptyAttributes = getAllowEmptyAttributesSetting(document.uri);
  const trimmedValue = message.attrValue.trim();

  const attributeValue =
    trimmedValue.length === 0 && !allowEmptyAttributes
      ? undefined
      : message.attrValue;

  let updatedXml: string;

  try {
    updatedXml = updateXmlAttributeByPath(
      xmlText,
      message.path,
      message.attrName,
      attributeValue
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(messageText);
    return false;
  }

  if (updatedXml === xmlText) {
    return true;
  }

  return replaceFullDocument(
    document,
    updatedXml,
    "Failed to update XML attribute."
  );
}

async function addChildNode(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  message: Extract<WebviewMessage, { type: "addChildNode" }>
): Promise<{ childPath: number[] } | undefined> {
  const xmlText = document.getText();
  const allowEmptyAttributes = getAllowEmptyAttributesSetting(document.uri);

  const attributes = filterAttributesForWriting(
    message.attributes,
    allowEmptyAttributes
  );

  let childResult;

  try {
    childResult = insertXmlChildNodeByPath(
      xmlText,
      message.parentPath,
      message.tagName,
      attributes
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(messageText);
    return undefined;
  }

  let updatedXml = childResult.xmlText;

  const referencedBehaviorTreeId = getReferencedBehaviorTreeId(
    message.tagName,
    attributes
  );
  const includeFullBehaviorTree = getIncludeFullBehaviorTreeSetting(
    document.uri
  );

  if (referencedBehaviorTreeId && includeFullBehaviorTree) {
    try {
      updatedXml = insertImportedBehaviorTreeChainAfterExistingReferencePath(
        context,
        updatedXml,
        message.parentPath,
        referencedBehaviorTreeId
      );
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        const messageText =
          error instanceof Error ? error.message : String(error);

        vscode.window.showWarningMessage(
          `SubTree node was added, but its referenced BehaviorTree could not be created automatically: ${messageText}`
        );
      }
    }
  }

  if (updatedXml === xmlText) {
    return {
      childPath: childResult.childPath
    };
  }

  const success = await replaceFullDocument(
    document,
    updatedXml,
    "Failed to add XML child node."
  );

  if (!success) {
    return undefined;
  }

  return {
    childPath: childResult.childPath
  };
}

async function pasteNode(
  document: vscode.TextDocument,
  message: Extract<WebviewMessage, { type: "pasteNode" }>
): Promise<{ copiedPath: number[] } | undefined> {
  const xmlText = document.getText();

  if (message.move) {
    let result;

    try {
      result = moveXmlNodeToParentByPath(
        xmlText,
        message.sourcePath,
        message.parentPath,
        message.targetIndex
      );
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(messageText);
      return undefined;
    }

    if (result.xmlText === xmlText) {
      return {
        copiedPath: result.movedPath
      };
    }

    const success = await replaceFullDocument(
      document,
      result.xmlText,
      "Failed to paste XML node."
    );

    if (!success) {
      return undefined;
    }

    return {
      copiedPath: result.movedPath
    };
  }

  let result;

  try {
    result = insertXmlNodeCopyByPath(
      xmlText,
      message.sourcePath,
      message.parentPath
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(messageText);
    return undefined;
  }

  if (result.xmlText === xmlText) {
    return {
      copiedPath: result.copiedPath
    };
  }

  const success = await replaceFullDocument(
    document,
    result.xmlText,
    "Failed to paste XML node."
  );

  if (!success) {
    return undefined;
  }

  return {
    copiedPath: result.copiedPath
  };
}

async function addBehaviorTree(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  message: Extract<WebviewMessage, { type: "addBehaviorTree" }>
): Promise<{ behaviorTreePath: number[] } | undefined> {
  const xmlText = document.getText();

  let result;

  try {
    result = insertImportedBehaviorTreeChainResultAfterExistingReferencePath(
      context,
      xmlText,
      message.referencePath,
      message.behaviorTreeId
    );
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return {
        behaviorTreePath: message.referencePath
      };
    }

    const messageText = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(messageText);
    return undefined;
  }

  if (result.xmlText === xmlText) {
    return {
      behaviorTreePath: result.behaviorTreePath
    };
  }

  const success = await replaceFullDocument(
    document,
    result.xmlText,
    "Failed to add BehaviorTree."
  );

  if (!success) {
    return undefined;
  }

  return {
    behaviorTreePath: result.behaviorTreePath
  };
}

async function deleteNode(
  document: vscode.TextDocument,
  message: Extract<WebviewMessage, { type: "deleteNode" }>
): Promise<{ nextSelectedPath: number[] | undefined } | undefined> {
  const xmlText = document.getText();
  const parsedNodes = parseBehaviorTreeXml(xmlText);
  const nodeToDelete = findParsedNodeByPath(parsedNodes, message.path);
  const referencedBehaviorTreeIds =
    message.deleteReferencedBehaviorTree && nodeToDelete
      ? collectReferencedBehaviorTreeIdsForDelete(parsedNodes, nodeToDelete)
      : [];

  let updatedXml: string;

  try {
    const result = deleteXmlNodeByPath(xmlText, message.path);
    updatedXml = result.xmlText;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(messageText);
    return undefined;
  }

  for (const referencedBehaviorTreeId of referencedBehaviorTreeIds) {
    if (hasSubTreeReferenceToBehaviorTree(updatedXml, referencedBehaviorTreeId)) {
      continue;
    }

    try {
      updatedXml = deleteBehaviorTreeById(
        updatedXml,
        referencedBehaviorTreeId
      ).xmlText;
    } catch (error) {
      if (!isMissingBehaviorTreeError(error)) {
        const messageText =
          error instanceof Error ? error.message : String(error);

        vscode.window.showWarningMessage(
          `Selected node was deleted, but referenced BehaviorTree "${referencedBehaviorTreeId}" could not be deleted: ${messageText}`
        );
      }
    }
  }

  if (updatedXml === xmlText) {
    return {
      nextSelectedPath: getParentPath(message.path)
    };
  }

  const success = await replaceFullDocument(
    document,
    updatedXml,
    "Failed to delete XML node."
  );

  if (!success) {
    return undefined;
  }

  return {
    nextSelectedPath: getParentPath(message.path)
  };
}

async function moveNode(
  document: vscode.TextDocument,
  message: Extract<WebviewMessage, { type: "moveNode" }>
): Promise<{ movedPath: number[] } | undefined> {
  const xmlText = document.getText();

  let result;

  try {
    result = moveXmlNodeByPath(xmlText, message.path, message.targetIndex);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(messageText);
    return undefined;
  }

  if (result.xmlText === xmlText) {
    return {
      movedPath: result.movedPath
    };
  }

  const success = await replaceFullDocument(
    document,
    result.xmlText,
    "Failed to move XML node."
  );

  if (!success) {
    return undefined;
  }

  return {
    movedPath: result.movedPath
  };
}

function insertBehaviorTreeAfterExistingReferencePath(
  xmlText: string,
  referencePath: number[],
  behaviorTreeId: string
): ReturnType<typeof insertBehaviorTreeAfterPath> {
  let lastError: unknown;

  for (let length = referencePath.length; length >= 1; length -= 1) {
    const candidatePath = referencePath.slice(0, length);

    try {
      return insertBehaviorTreeAfterPath(
        xmlText,
        candidatePath,
        behaviorTreeId
      );
    } catch (error) {
      lastError = error;

      if (isMissingReferenceError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        `Could not find reference XML node at path [${referencePath.join(", ")}].`
      );
}

function insertBehaviorTreeXmlAfterExistingReferencePath(
  xmlText: string,
  referencePath: number[],
  behaviorTreeXml: string
): ReturnType<typeof insertBehaviorTreeXmlAfterPath> {
  let lastError: unknown;

  for (let length = referencePath.length; length >= 1; length -= 1) {
    const candidatePath = referencePath.slice(0, length);

    try {
      return insertBehaviorTreeXmlAfterPath(
        xmlText,
        candidatePath,
        behaviorTreeXml
      );
    } catch (error) {
      lastError = error;

      if (isMissingReferenceError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        `Could not find reference XML node at path [${referencePath.join(", ")}].`
      );
}

function insertImportedBehaviorTreeChainAfterExistingReferencePath(
  context: vscode.ExtensionContext,
  xmlText: string,
  referencePath: number[],
  behaviorTreeId: string
): string {
  return insertImportedBehaviorTreeChainResultAfterExistingReferencePath(
    context,
    xmlText,
    referencePath,
    behaviorTreeId
  ).xmlText;
}

function insertImportedBehaviorTreeChainResultAfterExistingReferencePath(
  context: vscode.ExtensionContext,
  xmlText: string,
  referencePath: number[],
  behaviorTreeId: string
): ReturnType<typeof insertBehaviorTreeAfterPath> {
  const importedBehaviorTrees = getImportedBehaviorTrees(context);
  const visitedIds = new Set<string>();
  const importedBehaviorTree = importedBehaviorTrees[behaviorTreeId];
  const insertResult = importedBehaviorTree
    ? insertBehaviorTreeXmlAfterExistingReferencePath(
        xmlText,
        referencePath,
        importedBehaviorTree.xmlText
      )
    : insertBehaviorTreeAfterExistingReferencePath(
        xmlText,
        referencePath,
        behaviorTreeId
      );

  visitedIds.add(behaviorTreeId);

  return {
    ...insertResult,
    xmlText: importedBehaviorTree
      ? insertNestedImportedBehaviorTreeChainRecursive(
          insertResult.xmlText,
          referencePath,
          importedBehaviorTree,
          importedBehaviorTrees,
          visitedIds
        )
      : insertResult.xmlText
  };
}

function insertImportedBehaviorTreeChainRecursive(
  xmlText: string,
  referencePath: number[],
  behaviorTreeId: string,
  importedBehaviorTrees: BehaviorTreeTemplateMap,
  visitedIds: Set<string>
): string {
  if (visitedIds.has(behaviorTreeId)) {
    return xmlText;
  }

  visitedIds.add(behaviorTreeId);

  const importedBehaviorTree = importedBehaviorTrees[behaviorTreeId];
  const insertResult = importedBehaviorTree
    ? insertBehaviorTreeXmlAfterExistingReferencePath(
        xmlText,
        referencePath,
        importedBehaviorTree.xmlText
      )
    : insertBehaviorTreeAfterExistingReferencePath(
        xmlText,
        referencePath,
        behaviorTreeId
      );

  let updatedXml = insertResult.xmlText;

  if (!importedBehaviorTree) {
    return updatedXml;
  }

  for (const nestedBehaviorTreeId of collectReferencedBehaviorTreeIdsFromXml(
    importedBehaviorTree.xmlText
  )) {
    if (!importedBehaviorTrees[nestedBehaviorTreeId]) {
      continue;
    }

    try {
      updatedXml = insertImportedBehaviorTreeChainRecursive(
        updatedXml,
        referencePath,
        nestedBehaviorTreeId,
        importedBehaviorTrees,
        visitedIds
      );
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
  }

  return updatedXml;
}

function insertNestedImportedBehaviorTreeChainRecursive(
  xmlText: string,
  referencePath: number[],
  importedBehaviorTree: BehaviorTreeTemplate,
  importedBehaviorTrees: BehaviorTreeTemplateMap,
  visitedIds: Set<string>
): string {
  let updatedXml = xmlText;

  for (const nestedBehaviorTreeId of collectReferencedBehaviorTreeIdsFromXml(
    importedBehaviorTree.xmlText
  )) {
    if (!importedBehaviorTrees[nestedBehaviorTreeId]) {
      continue;
    }

    try {
      updatedXml = insertImportedBehaviorTreeChainRecursive(
        updatedXml,
        referencePath,
        nestedBehaviorTreeId,
        importedBehaviorTrees,
        visitedIds
      );
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
  }

  return updatedXml;
}

function getReferencedBehaviorTreeId(
  tagName: string,
  attributes: Record<string, string>
): string | undefined {
  if (!isSubTreeTagName(tagName)) {
    return undefined;
  }

  const id = attributes["ID"]?.trim();

  if (!id) {
    return undefined;
  }

  return id;
}

function collectReferencedBehaviorTreeIdsFromXml(xmlText: string): string[] {
  const parsedNodes = parseBehaviorTreeXml(xmlText);
  const referencedIds: string[] = [];
  const visitedIds = new Set<string>();

  for (const node of parsedNodes) {
    collectReferencedBehaviorTreeIdsFromNode(
      node,
      referencedIds,
      visitedIds
    );
  }

  return referencedIds;
}

function collectReferencedBehaviorTreeIdsFromNode(
  node: BtNode,
  referencedIds: string[],
  visitedIds: Set<string>
): void {
  const referencedBehaviorTreeId = getReferencedBehaviorTreeId(
    node.tag,
    node.attributes
  );

  if (referencedBehaviorTreeId && !visitedIds.has(referencedBehaviorTreeId)) {
    visitedIds.add(referencedBehaviorTreeId);
    referencedIds.push(referencedBehaviorTreeId);
  }

  for (const child of node.children) {
    collectReferencedBehaviorTreeIdsFromNode(child, referencedIds, visitedIds);
  }
}

function collectReferencedBehaviorTreeIdsForDelete(
  nodes: BtNode[],
  nodeToDelete: BtNode
): string[] {
  const referencedBehaviorTreeId = getReferencedBehaviorTreeId(
    nodeToDelete.tag,
    nodeToDelete.attributes
  );

  if (!referencedBehaviorTreeId) {
    return [];
  }

  const collectedIds: string[] = [];
  const visitedIds = new Set<string>();

  collectReferencedBehaviorTreeIdsRecursive(
    nodes,
    referencedBehaviorTreeId,
    visitedIds,
    collectedIds
  );

  return collectedIds;
}

function collectReferencedBehaviorTreeIdsRecursive(
  nodes: BtNode[],
  behaviorTreeId: string,
  visitedIds: Set<string>,
  collectedIds: string[]
): void {
  if (visitedIds.has(behaviorTreeId)) {
    return;
  }

  visitedIds.add(behaviorTreeId);
  collectedIds.push(behaviorTreeId);

  const behaviorTree = findParsedBehaviorTreeById(nodes, behaviorTreeId);

  if (!behaviorTree) {
    return;
  }

  collectNestedReferencedBehaviorTreeIds(
    nodes,
    behaviorTree,
    visitedIds,
    collectedIds
  );
}

function collectNestedReferencedBehaviorTreeIds(
  nodes: BtNode[],
  node: BtNode,
  visitedIds: Set<string>,
  collectedIds: string[]
): void {
  const referencedBehaviorTreeId = getReferencedBehaviorTreeId(
    node.tag,
    node.attributes
  );

  if (referencedBehaviorTreeId) {
    collectReferencedBehaviorTreeIdsRecursive(
      nodes,
      referencedBehaviorTreeId,
      visitedIds,
      collectedIds
    );
  }

  for (const child of node.children) {
    collectNestedReferencedBehaviorTreeIds(
      nodes,
      child,
      visitedIds,
      collectedIds
    );
  }
}

function isSubTreeTagName(tagName: string): boolean {
  return tagName === "SubTree" || tagName === "SubTreePlus";
}

function isMissingReferenceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("Could not find reference XML node at path")
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("BehaviorTree with ID") &&
    error.message.endsWith("already exists.")
  );
}

function isMissingBehaviorTreeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("Could not find BehaviorTree with ID")
  );
}

function findParsedBehaviorTreeById(
  nodes: BtNode[],
  id: string
): BtNode | undefined {
  for (const node of nodes) {
    const result = findParsedBehaviorTreeByIdRecursive(node, id);

    if (result) {
      return result;
    }
  }

  return undefined;
}

function findParsedBehaviorTreeByIdRecursive(
  node: BtNode,
  id: string
): BtNode | undefined {
  if (node.tag === "BehaviorTree" && node.attributes["ID"] === id) {
    return node;
  }

  for (const child of node.children) {
    const result = findParsedBehaviorTreeByIdRecursive(child, id);

    if (result) {
      return result;
    }
  }

  return undefined;
}

function findParsedNodeByPath(
  nodes: BtNode[],
  path: number[]
): BtNode | undefined {
  const exact = findParsedNodeByExactPath(nodes, path);

  if (exact) {
    return exact;
  }

  if (path.length === 0) {
    return undefined;
  }

  const behaviorTreeRoot = nodes[path[0]];

  if (!behaviorTreeRoot) {
    return undefined;
  }

  const realPath = [
    ...behaviorTreeRoot.source.path,
    ...path.slice(1)
  ];

  return findParsedNodeByExactPath(nodes, realPath);
}

function findParsedNodeByExactPath(
  nodes: BtNode[],
  path: number[]
): BtNode | undefined {
  for (const node of nodes) {
    const result = findParsedNodeByExactPathRecursive(node, path);

    if (result) {
      return result;
    }
  }

  return undefined;
}

function findParsedNodeByExactPathRecursive(
  node: BtNode,
  path: number[]
): BtNode | undefined {
  if (pathsEqual(node.source.path, path)) {
    return node;
  }

  for (const child of node.children) {
    const result = findParsedNodeByExactPathRecursive(child, path);

    if (result) {
      return result;
    }
  }

  return undefined;
}

function pathsEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function getParentPath(path: number[]): number[] | undefined {
  if (path.length <= 1) {
    return undefined;
  }

  return path.slice(0, -1);
}

function filterAttributesForWriting(
  attributes: Record<string, string>,
  allowEmptyAttributes: boolean
): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (value.trim().length === 0 && !allowEmptyAttributes) {
      continue;
    }

    filtered[key] = value;
  }

  return filtered;
}

async function replaceFullDocument(
  document: vscode.TextDocument,
  updatedXml: string,
  errorMessage: string
): Promise<boolean> {
  const xmlText = document.getText();

  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(xmlText.length)
  );

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, fullRange, updatedXml);

  const success = await vscode.workspace.applyEdit(edit);

  if (!success) {
    vscode.window.showErrorMessage(errorMessage);
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

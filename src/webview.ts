import * as vscode from "vscode";
import { BtNode, TreeNodeDefinition } from "./bt_parser";

export type EditorOptions = {
  openOnlyOneBehaviorTree: boolean;
  autoFitOnTreeChange: boolean;
  allowEmptyAttributes: boolean;
  includeFullBehaviorTree: boolean;
};

export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nodes: BtNode[],
  selectedPath: number[] | undefined,
  options: EditorOptions,
  treeNodeDefinitions: TreeNodeDefinition[],
  importedBehaviorTrees: Array<{ id: string; source: string; tree: BtNode }>
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "editor.js")
  );

  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "editor.css")
  );

  const nonce = getNonce();
  const initialData = JSON.stringify(nodes).replace(/</g, "\\u003c");
  const initialSelectedPath = JSON.stringify(selectedPath ?? null);
  const initialOptions = JSON.stringify(options).replace(/</g, "\\u003c");
  const initialDefinitions = JSON.stringify(treeNodeDefinitions).replace(
    /</g,
    "\\u003c"
  );
  const initialImportedBehaviorTrees = JSON.stringify(
    importedBehaviorTrees
  ).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
  >
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Nav2 BT Editor</title>
</head>
<body>
  <div class="app">
    <div class="tree-panel">
      <div id="tree"></div>
    </div>

    <div class="details-panel">
      <h2>Node Parameters</h2>
      <div id="details" class="empty">
        Click a node to show its parameters.
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    window.initialBtNodes = ${initialData};
    window.initialSelectedPath = ${initialSelectedPath};
    window.initialEditorOptions = ${initialOptions};
    window.initialTreeNodeDefinitions = ${initialDefinitions};
    window.initialImportedBehaviorTrees = ${initialImportedBehaviorTrees};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  let text = "";

  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return text;
}

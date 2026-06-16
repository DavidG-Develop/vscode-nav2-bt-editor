import * as vscode from "vscode";
import { BtNode } from "./bt_parser";

export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nodes: BtNode[]
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "preview.js")
  );

  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "preview.css")
  );

  const nonce = getNonce();
  const initialData = JSON.stringify(nodes).replace(/</g, "\\u003c");

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
  <title>Nav2 BT Preview</title>
</head>
<body>
  <div class="app">
    <div class="tree-panel">
      <h2>Behavior Tree</h2>
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

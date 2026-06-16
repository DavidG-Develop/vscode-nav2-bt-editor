const vscode = acquireVsCodeApi();

const nodes = window.initialBtNodes ?? [];
let selectedNodePath = window.initialSelectedPath ?? undefined;
let selectedNodeId = undefined;

const treeContainer = document.getElementById("tree");
const detailsContainer = document.getElementById("details");

const STYLE = {
  horizontalGap: 56,
  verticalGap: 90,
  forestGap: 120,
  marginX: 80,
  marginY: 80
};

let viewState = {
  x: 0,
  y: 0,
  scale: 1,
  initialized: false
};

let currentViewportGroup = undefined;
let currentSvg = undefined;
let currentBounds = undefined;

function renderTree() {
  treeContainer.innerHTML = "";

  if (nodes.length === 0) {
    treeContainer.textContent = "No BehaviorTree nodes found.";
    return;
  }

  const toolbar = document.createElement("div");
  toolbar.className = "tree-toolbar";

  const zoomInButton = document.createElement("button");
  zoomInButton.textContent = "+";
  zoomInButton.title = "Zoom in";
  zoomInButton.addEventListener("click", () => zoomBy(1.15));

  const zoomOutButton = document.createElement("button");
  zoomOutButton.textContent = "-";
  zoomOutButton.title = "Zoom out";
  zoomOutButton.addEventListener("click", () => zoomBy(1 / 1.15));

  const fitButton = document.createElement("button");
  fitButton.textContent = "Fit";
  fitButton.title = "Fit tree";
  fitButton.addEventListener("click", () => fitToScreen());

  toolbar.appendChild(zoomOutButton);
  toolbar.appendChild(zoomInButton);
  toolbar.appendChild(fitButton);
  treeContainer.appendChild(toolbar);

  const roots = nodes.map((node) => buildLayoutTree(node));

  for (const root of roots) {
    measureSubtree(root);
  }

  assignForestPositions(roots);

  const bounds = getForestBounds(roots);
  currentBounds = bounds;

  const svg = createSvg();
  currentSvg = svg;

  addArrowMarker(svg);

  const viewportGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  viewportGroup.setAttribute("class", "viewport-group");
  currentViewportGroup = viewportGroup;

  for (const root of roots) {
    drawEdges(viewportGroup, root);
  }

  for (const root of roots) {
    drawNodes(viewportGroup, root);
  }

  svg.appendChild(viewportGroup);
  treeContainer.appendChild(svg);

  setupPanZoom(svg);
  applyTransform();

  const selectedNode = findNodeByPathInForest(roots, selectedNodePath);

  if (selectedNode) {
    selectedNodeId = selectedNode.id;
    renderDetails(selectedNode);
  }

  if (!viewState.initialized) {
    requestAnimationFrame(() => {
      fitToScreen();
      viewState.initialized = true;
    });
  }
}

function buildLayoutTree(node) {
  const kind = node.kind ?? "action";
  const size = getNodeSize(node, kind);

  return {
    ...node,
    kind,
    width: size.width,
    height: size.height,
    subtreeWidth: 0,
    x: 0,
    y: 0,
    children: (node.children ?? []).map(buildLayoutTree)
  };
}

function getNodeSize(node, kind) {
  const label = getPrimaryLabel(node);
  const secondary = getSecondaryLabel(node);

  const longestLine = Math.max(label.length, secondary.length);
  const textWidth = Math.max(90, longestLine * 8 + 32);
  const hasExtraLine = Boolean(secondary);

  switch (kind) {
    case "action":
      return {
        width: Math.max(135, textWidth),
        height: hasExtraLine ? 68 : 58
      };

    case "condition":
      return {
        width: Math.max(145, textWidth),
        height: hasExtraLine ? 64 : 54
      };

    case "decorator":
      return {
        width: Math.max(150, textWidth),
        height: hasExtraLine ? 68 : 56
      };

    case "control":
    default:
      return {
        width: Math.max(150, textWidth),
        height: hasExtraLine ? 68 : 56
      };
  }
}

function getPrimaryLabel(node) {
  return node.tag;
}

function getSecondaryLabel(node) {
  if (node.name && node.name !== node.tag) {
    return node.name;
  }

  return "";
}

function isDisplayNameAttribute(node, key, value) {
  if (key === "name") {
    return true;
  }

  if (key === "ID" && node.name === value) {
    return true;
  }

  return false;
}

function getVisibleAttributes(node) {
  const attrs = node.attributes ?? {};

  return Object.entries(attrs).filter(([key, value]) => {
    return !isDisplayNameAttribute(node, key, value);
  });
}

function measureSubtree(node) {
  if (!node.children || node.children.length === 0) {
    node.subtreeWidth = node.width;
    return node.subtreeWidth;
  }

  let childrenWidth = 0;

  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i];
    childrenWidth += measureSubtree(child);

    if (i > 0) {
      childrenWidth += STYLE.horizontalGap;
    }
  }

  node.subtreeWidth = Math.max(node.width, childrenWidth);
  return node.subtreeWidth;
}

function assignForestPositions(roots) {
  let currentTop = STYLE.marginY;

  for (const root of roots) {
    assignPositions(root, STYLE.marginX, currentTop);

    const bounds = getBounds(root);
    currentTop = bounds.maxY + STYLE.forestGap;
  }
}

function assignPositions(node, left, top) {
  node.x = left + node.subtreeWidth / 2;
  node.y = top + node.height / 2;

  if (!node.children || node.children.length === 0) {
    return;
  }

  let currentLeft = left + (node.subtreeWidth - getChildrenTotalWidth(node)) / 2;
  const childTop = top + node.height + STYLE.verticalGap;

  for (const child of node.children) {
    assignPositions(child, currentLeft, childTop);
    currentLeft += child.subtreeWidth + STYLE.horizontalGap;
  }
}

function getChildrenTotalWidth(node) {
  if (!node.children || node.children.length === 0) {
    return 0;
  }

  return (
    node.children.reduce((sum, child) => sum + child.subtreeWidth, 0) +
    STYLE.horizontalGap * (node.children.length - 1)
  );
}

function getForestBounds(roots) {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };

  for (const root of roots) {
    getBounds(root, bounds);
  }

  return bounds;
}

function getBounds(node, bounds = null) {
  const current = bounds ?? {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };

  current.minX = Math.min(current.minX, node.x - node.width / 2);
  current.minY = Math.min(current.minY, node.y - node.height / 2);
  current.maxX = Math.max(current.maxX, node.x + node.width / 2);
  current.maxY = Math.max(current.maxY, node.y + node.height / 2);

  for (const child of node.children ?? []) {
    getBounds(child, current);
  }

  return current;
}

function createSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.classList.add("bt-svg");
  return svg;
}

function addArrowMarker(svg) {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");

  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "arrowhead");
  marker.setAttribute("markerWidth", "10");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("refX", "9");
  marker.setAttribute("refY", "3.5");
  marker.setAttribute("orient", "auto");
  marker.setAttribute("markerUnits", "strokeWidth");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M0,0 L10,3.5 L0,7 Z");
  path.setAttribute("class", "edge-arrow");

  marker.appendChild(path);
  defs.appendChild(marker);
  svg.appendChild(defs);
}

function drawEdges(parent, node) {
  for (const child of node.children ?? []) {
    const edge = document.createElementNS("http://www.w3.org/2000/svg", "path");

    const startX = node.x;
    const startY = node.y + node.height / 2;
    const endX = child.x;
    const endY = child.y - child.height / 2;

    const midY = startY + (endY - startY) * 0.45;

    const d = [
      `M ${startX} ${startY}`,
      `L ${startX} ${midY}`,
      `L ${endX} ${midY}`,
      `L ${endX} ${endY}`
    ].join(" ");

    edge.setAttribute("d", d);
    edge.setAttribute("class", "bt-edge");
    edge.setAttribute("marker-end", "url(#arrowhead)");

    parent.appendChild(edge);

    drawEdges(parent, child);
  }
}

function drawNodes(parent, node) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", `bt-node-group kind-${node.kind}`);

  if (node.id === selectedNodeId || pathsEqual(node.source?.path, selectedNodePath)) {
    group.classList.add("selected");
  }

  group.style.cursor = "pointer";

  group.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  group.addEventListener("click", (event) => {
    event.stopPropagation();

    selectedNodeId = node.id;
    selectedNodePath = node.source?.path;

    if (selectedNodePath) {
      vscode.postMessage({
        type: "selectNode",
        path: selectedNodePath
      });
    }

    renderDetails(node);
    renderTree();
  });

  if (node.kind === "action") {
    const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
    ellipse.setAttribute("cx", String(node.x));
    ellipse.setAttribute("cy", String(node.y));
    ellipse.setAttribute("rx", String(node.width / 2));
    ellipse.setAttribute("ry", String(node.height / 2));
    ellipse.setAttribute("class", "bt-shape");
    group.appendChild(ellipse);
  } else {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(node.x - node.width / 2));
    rect.setAttribute("y", String(node.y - node.height / 2));
    rect.setAttribute("width", String(node.width));
    rect.setAttribute("height", String(node.height));
    rect.setAttribute("class", "bt-shape");

    if (node.kind === "condition") {
      rect.setAttribute("rx", "20");
      rect.setAttribute("ry", "20");
    } else {
      rect.setAttribute("rx", "5");
      rect.setAttribute("ry", "5");
    }

    group.appendChild(rect);
  }

  appendNodeText(group, node);

  parent.appendChild(group);

  for (const child of node.children ?? []) {
    drawNodes(parent, child);
  }
}

function appendNodeText(group, node) {
  const primaryLabel = getPrimaryLabel(node);
  const secondaryLabel = getSecondaryLabel(node);

  const lines = [primaryLabel];

  if (secondaryLabel) {
    lines.push(secondaryLabel);
  }

  const lineHeight = 16;
  const startY = node.y - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, index) => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(node.x));
    text.setAttribute("y", String(startY + index * lineHeight));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute(
      "class",
      index === 0 ? "bt-text bt-text-primary" : "bt-text bt-text-secondary"
    );
    text.textContent = line;
    group.appendChild(text);
  });
}

function setupPanZoom(svg) {
  let isPanning = false;
  let lastX = 0;
  let lastY = 0;

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();

    const rect = svg.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(mouseX, mouseY, zoomFactor);
  }, { passive: false });

  svg.addEventListener("pointerdown", (event) => {
    isPanning = true;
    lastX = event.clientX;
    lastY = event.clientY;
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("panning");
  });

  svg.addEventListener("pointermove", (event) => {
    if (!isPanning) {
      return;
    }

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;

    viewState.x += dx;
    viewState.y += dy;

    lastX = event.clientX;
    lastY = event.clientY;

    applyTransform();
  });

  svg.addEventListener("pointerup", (event) => {
    isPanning = false;
    svg.releasePointerCapture(event.pointerId);
    svg.classList.remove("panning");
  });

  svg.addEventListener("pointerleave", () => {
    isPanning = false;
    svg.classList.remove("panning");
  });
}

function zoomBy(factor) {
  if (!currentSvg) {
    return;
  }

  const rect = currentSvg.getBoundingClientRect();
  zoomAt(rect.width / 2, rect.height / 2, factor);
}

function zoomAt(screenX, screenY, factor) {
  const oldScale = viewState.scale;
  const newScale = clamp(oldScale * factor, 0.15, 4.0);

  const contentX = (screenX - viewState.x) / oldScale;
  const contentY = (screenY - viewState.y) / oldScale;

  viewState.x = screenX - contentX * newScale;
  viewState.y = screenY - contentY * newScale;
  viewState.scale = newScale;

  applyTransform();
}

function fitToScreen() {
  if (!currentSvg || !currentBounds) {
    return;
  }

  const rect = currentSvg.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const contentWidth = Math.max(1, currentBounds.maxX - currentBounds.minX);
  const contentHeight = Math.max(1, currentBounds.maxY - currentBounds.minY);

  const padding = 80;

  const scaleX = (rect.width - padding) / contentWidth;
  const scaleY = (rect.height - padding) / contentHeight;

  const scale = clamp(Math.min(scaleX, scaleY), 0.15, 2.0);

  const contentCenterX = currentBounds.minX + contentWidth / 2;
  const contentCenterY = currentBounds.minY + contentHeight / 2;

  viewState.scale = scale;
  viewState.x = rect.width / 2 - contentCenterX * scale;
  viewState.y = rect.height / 2 - contentCenterY * scale;

  applyTransform();
}

function applyTransform() {
  if (!currentViewportGroup) {
    return;
  }

  currentViewportGroup.setAttribute(
    "transform",
    `translate(${viewState.x} ${viewState.y}) scale(${viewState.scale})`
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function renderDetails(node) {
  const visibleAttributes = getVisibleAttributes(node);

  const rows = visibleAttributes
    .map(([key, value]) => {
      return `
        <tr>
          <td class="attr-name">${escapeHtml(key)}</td>
          <td>
            <input
              class="attr-input"
              data-attr-name="${escapeHtml(key)}"
              value="${escapeHtml(String(value))}"
            />
          </td>
          <td>
            <button
              class="attr-apply-button"
              data-attr-name="${escapeHtml(key)}"
            >
              Apply
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  const source = node.source;

  detailsContainer.classList.remove("empty");

  detailsContainer.innerHTML = `
    <p><strong>Type:</strong> ${escapeHtml(node.tag)}</p>
    <p><strong>Category:</strong> ${escapeHtml(node.kind)}</p>
    ${
      node.name
        ? `<p><strong>Name:</strong> ${escapeHtml(node.name)}</p>`
        : ""
    }

    <div class="xml-section">
      <h3>XML</h3>
      ${
        source
          ? `
            <p class="source-location">
              Line ${source.line + 1}, column ${source.column + 1}
            </p>
            <pre class="xml-preview">${escapeHtml(source.startTag)}</pre>
            <button id="reveal-node-button">Reveal in XML</button>
          `
          : `<p class="empty">No XML source information available.</p>`
      }
    </div>

    <h3>Attributes</h3>
    ${
      rows.length > 0
        ? `<table class="attr-table">${rows}</table>`
        : `<p class="empty">No normal attributes on this node.</p>`
    }

    <h3>Add attribute</h3>
    <div class="add-attr-row">
      <input id="new-attr-name" placeholder="attribute name" />
      <input id="new-attr-value" placeholder="value" />
      <button id="add-attr-button">Add</button>
    </div>
  `;

  const revealButton = document.getElementById("reveal-node-button");

  if (revealButton && source) {
    revealButton.addEventListener("click", () => {
      vscode.postMessage({
        type: "revealNode",
        startOffset: source.startOffset
      });
    });
  }

  for (const button of document.querySelectorAll(".attr-apply-button")) {
    button.addEventListener("click", () => {
      const attrName = button.getAttribute("data-attr-name");

      if (!attrName) {
        return;
      }

      const input = document.querySelector(
        `.attr-input[data-attr-name="${cssEscape(attrName)}"]`
      );

      if (!input) {
        return;
      }

      vscode.postMessage({
        type: "updateAttribute",
        path: node.source.path,
        attrName,
        attrValue: input.value
      });
    });
  }

  const addButton = document.getElementById("add-attr-button");

  if (addButton) {
    addButton.addEventListener("click", () => {
      const nameInput = document.getElementById("new-attr-name");
      const valueInput = document.getElementById("new-attr-value");

      const attrName = nameInput?.value?.trim() ?? "";
      const attrValue = valueInput?.value ?? "";

      if (!attrName) {
        return;
      }

      if (attrName === "name") {
        return;
      }

      vscode.postMessage({
        type: "updateAttribute",
        path: node.source.path,
        attrName,
        attrValue
      });
    });
  }
}

function findNodeByPathInForest(roots, path) {
  if (!path) {
    return undefined;
  }

  for (const root of roots) {
    const result = findNodeByPath(root, path);

    if (result) {
      return result;
    }
  }

  return undefined;
}

function findNodeByPath(node, path) {
  if (pathsEqual(node.source?.path, path)) {
    return node;
  }

  for (const child of node.children ?? []) {
    const result = findNodeByPath(child, path);

    if (result) {
      return result;
    }
  }

  return undefined;
}

function pathsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function cssEscape(input) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(input);
  }

  return String(input).replaceAll('"', '\\"');
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

renderTree();
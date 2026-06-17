const vscode = acquireVsCodeApi();

const nodes = window.initialBtNodes ?? [];
const previewOptions = window.initialPreviewOptions ?? {};
const openOnlyOneBehaviorTree =
  previewOptions.openOnlyOneBehaviorTree !== false;
const autoFitOnTreeChange =
  previewOptions.autoFitOnTreeChange !== false;
const allowEmptyAttributes =
  previewOptions.allowEmptyAttributes === true;

let selectedNodePath = window.initialSelectedPath ?? undefined;
let selectedNodeId = undefined;

let activeRootPath = undefined;
let rootNavigationStack = [];
let expandedSubTreeKeys = new Set();

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
let currentLayoutRoots = [];

initializeActiveRoot();

function initializeActiveRoot() {
  const preferredRoot = findPreferredTopRoot(nodes);

  if (preferredRoot) {
    activeRootPath = preferredRoot.source?.path;
    return;
  }

  if (nodes.length > 0) {
    activeRootPath = nodes[0].source?.path;
  }
}

function renderTree() {
  treeContainer.innerHTML = "";

  if (nodes.length === 0) {
    treeContainer.textContent = "No BehaviorTree nodes found.";
    return;
  }

  const activeRoot = findNodeByPathInForest(nodes, activeRootPath) ?? nodes[0];

  if (!activeRootPath) {
    activeRootPath = activeRoot.source?.path;
  }

  const toolbar = document.createElement("div");
  toolbar.className = "tree-toolbar";

  const zoomOutButton = document.createElement("button");
  zoomOutButton.textContent = "-";
  zoomOutButton.title = "Zoom out";
  zoomOutButton.addEventListener("click", () => zoomBy(1 / 1.15));

  const zoomInButton = document.createElement("button");
  zoomInButton.textContent = "+";
  zoomInButton.title = "Zoom in";
  zoomInButton.addEventListener("click", () => zoomBy(1.15));

  const fitButton = document.createElement("button");
  fitButton.textContent = "Fit";
  fitButton.title = "Fit tree";
  fitButton.addEventListener("click", () => fitToScreen());

  toolbar.appendChild(zoomOutButton);
  toolbar.appendChild(zoomInButton);
  toolbar.appendChild(fitButton);

  if (openOnlyOneBehaviorTree) {
    const upButton = document.createElement("button");
    upButton.textContent = "↑";
    upButton.title = "Go one BehaviorTree up";
    upButton.disabled = rootNavigationStack.length === 0;
    upButton.addEventListener("click", () => goOneTreeUp());

    const topButton = document.createElement("button");
    topButton.textContent = "Top";
    topButton.title = "Go to top-level BehaviorTree";
    topButton.disabled = isAtTopRoot();
    topButton.addEventListener("click", () => goToTopTree());

    toolbar.appendChild(upButton);
    toolbar.appendChild(topButton);
  }

  treeContainer.appendChild(toolbar);

  const root = buildLayoutTree(activeRoot, new Set());
  currentLayoutRoots = [root];

  measureSubtree(root);
  assignForestPositions([root]);

  const bounds = getForestBounds([root]);
  currentBounds = bounds;

  const svg = createSvg();
  currentSvg = svg;

  addArrowMarker(svg);

  const viewportGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  viewportGroup.setAttribute("class", "viewport-group");
  currentViewportGroup = viewportGroup;

  drawEdges(viewportGroup, root);
  drawNodes(viewportGroup, root);

  svg.appendChild(viewportGroup);
  treeContainer.appendChild(svg);

  setupPanZoom(svg);
  applyTransform();

  const selectedNode = findNodeByPathInForest([root], selectedNodePath);

  if (selectedNode) {
    selectedNodeId = selectedNode.id;
    renderDetails(selectedNode);
  } else {
    selectedNodeId = root.id;
    selectedNodePath = root.source?.path;
    renderDetails(root);
  }

  if (!viewState.initialized) {
    requestAnimationFrame(() => {
      fitToScreen();
      viewState.initialized = true;
    });
  }
}

function buildLayoutTree(node, expansionStack) {
  const kind = node.kind ?? "action";
  const visualKind = getVisualKind(node);
  const size = getNodeSize(node, kind, visualKind);
  const subTreeKey = getSubTreeExpansionKey(node);

  const layoutNode = {
    ...node,
    kind,
    visualKind,
    subTreeKey,
    width: size.width,
    height: size.height,
    subtreeWidth: 0,
    x: 0,
    y: 0,
    inlineExpanded: false,
    inlineCycle: false,
    children: []
  };

  if (
    !openOnlyOneBehaviorTree &&
    isSubTreeNode(node) &&
    subTreeKey &&
    expandedSubTreeKeys.has(subTreeKey)
  ) {
    const targetId = node.attributes?.ID;
    const targetTree = targetId ? findBehaviorTreeById(nodes, targetId) : undefined;

    if (targetTree) {
      if (expansionStack.has(targetId)) {
        layoutNode.inlineCycle = true;
        return layoutNode;
      }

      const nextStack = new Set(expansionStack);
      nextStack.add(targetId);

      layoutNode.inlineExpanded = true;
      layoutNode.children = (targetTree.children ?? []).map((child) =>
        buildLayoutTree(child, nextStack)
      );

      return layoutNode;
    }
  }

  layoutNode.children = (node.children ?? []).map((child) =>
    buildLayoutTree(child, expansionStack)
  );

  return layoutNode;
}

function findPreferredTopRoot(roots) {
  const mainTree = roots.find((node) => {
    return node.tag === "BehaviorTree" && node.attributes?.ID === "MainTree";
  });

  if (mainTree) {
    return mainTree;
  }

  return roots.find((node) => node.tag === "BehaviorTree") ?? roots[0];
}

function getTopRoot() {
  return findPreferredTopRoot(nodes);
}

function isAtTopRoot() {
  const topRoot = getTopRoot();

  if (!topRoot) {
    return true;
  }

  return pathsEqual(activeRootPath, topRoot.source?.path);
}

function goOneTreeUp() {
  const previousRootPath = rootNavigationStack.pop();

  if (!previousRootPath) {
    return;
  }

  const previousRoot = findNodeByPathInForest(nodes, previousRootPath);

  if (!previousRoot) {
    return;
  }

  activeRootPath = previousRootPath;
  selectedNodePath = previousRoot.source?.path;
  selectedNodeId = undefined;

  vscode.postMessage({
    type: "selectNode",
    path: selectedNodePath
  });

  handleTreeStructureChange();
  renderTree();

  requestAnimationFrame(() => {
    applyPostTreeChangeView();
  });
}

function goToTopTree() {
  const topRoot = getTopRoot();

  if (!topRoot) {
    return;
  }

  rootNavigationStack = [];
  activeRootPath = topRoot.source?.path;
  selectedNodePath = topRoot.source?.path;
  selectedNodeId = undefined;

  vscode.postMessage({
    type: "selectNode",
    path: selectedNodePath
  });

  handleTreeStructureChange();
  renderTree();

  requestAnimationFrame(() => {
    applyPostTreeChangeView();
  });
}

function handleTreeStructureChange() {
  if (autoFitOnTreeChange) {
    viewState.initialized = false;
  }
}

function applyPostTreeChangeView() {
  if (autoFitOnTreeChange) {
    fitToScreen();
  }
}

function getVisualKind(node) {
  if (node.tag === "BehaviorTree") {
    return "tree";
  }

  if (isSubTreeNode(node)) {
    return "subtree";
  }

  return node.kind ?? "action";
}

function getNodeSize(node, kind, visualKind) {
  const label = getPrimaryLabel(node);
  const secondary = getSecondaryLabel(node);

  const longestLine = Math.max(label.length, secondary.length);
  const textWidth = Math.max(90, longestLine * 8 + 32);
  const hasExtraLine = Boolean(secondary);

  if (visualKind === "tree") {
    return {
      width: Math.max(170, textWidth),
      height: hasExtraLine ? 72 : 62
    };
  }

  if (visualKind === "subtree") {
    return {
      width: Math.max(160, textWidth),
      height: hasExtraLine ? 70 : 60
    };
  }

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
  if (node.tag === "BehaviorTree") {
    return "BehaviorTree";
  }

  if (isSubTreeNode(node)) {
    return node.tag;
  }

  return node.tag;
}

function getSecondaryLabel(node) {
  if (node.name && node.name !== node.tag) {
    return node.name;
  }

  if (isSubTreeNode(node) && node.attributes?.ID) {
    return node.attributes.ID;
  }

  return "";
}

function isDisplayNameAttribute() {
  return false;
}

function getVisibleAttributes(node) {
  const attrs = node.attributes ?? {};

  return Object.entries(attrs).filter(([key, value]) => {
    return !isDisplayNameAttribute(node, key, value);
  });
}

function getKnownPortNames(node) {
  return new Set((node.definition?.ports ?? []).map((port) => port.name));
}

function isSubTreeNode(node) {
  return node.tag === "SubTree" || node.tag === "SubTreePlus";
}

function getSubTreeExpansionKey(node) {
  if (!isSubTreeNode(node) || !Array.isArray(node.source?.path)) {
    return undefined;
  }

  return pathToKey(node.source.path);
}

function pathToKey(path) {
  return path.join(".");
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
  group.setAttribute("class", `bt-node-group kind-${node.kind} visual-${node.visualKind}`);

  if (!node.definitionKnown) {
    group.classList.add("unknown-node");
  }

  if (node.inlineExpanded) {
    group.classList.add("inline-expanded");
  }

  if (node.inlineCycle) {
    group.classList.add("inline-cycle");
  }

  if (node.id === selectedNodeId || pathsEqual(node.source?.path, selectedNodePath)) {
    group.classList.add("selected");
  }

  group.style.cursor = "pointer";

  group.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  group.addEventListener("click", (event) => {
    event.stopPropagation();
    selectNode(node, false);
  });

  group.addEventListener("dblclick", (event) => {
    event.stopPropagation();

    if (!isSubTreeNode(node)) {
      return;
    }

    if (openOnlyOneBehaviorTree) {
      openSubTreeTarget(node);
      return;
    }

    toggleInlineSubTree(node);
  });

  drawNodeShape(group, node);
  appendNodeText(group, node);

  if (!node.definitionKnown) {
    appendUnknownBadge(group, node);
  }

  if (isSubTreeNode(node)) {
    appendSubTreeHint(group, node);
  }

  parent.appendChild(group);

  for (const child of node.children ?? []) {
    drawNodes(parent, child);
  }
}

function drawNodeShape(group, node) {
  if (
    node.visualKind === "action" ||
    node.visualKind === "tree" ||
    node.visualKind === "subtree"
  ) {
    const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
    ellipse.setAttribute("cx", String(node.x));
    ellipse.setAttribute("cy", String(node.y));
    ellipse.setAttribute("rx", String(node.width / 2));
    ellipse.setAttribute("ry", String(node.height / 2));
    ellipse.setAttribute("class", "bt-shape");
    group.appendChild(ellipse);
    return;
  }

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(node.x - node.width / 2));
  rect.setAttribute("y", String(node.y - node.height / 2));
  rect.setAttribute("width", String(node.width));
  rect.setAttribute("height", String(node.height));
  rect.setAttribute("class", "bt-shape");

  if (node.visualKind === "condition") {
    rect.setAttribute("rx", "20");
    rect.setAttribute("ry", "20");
  } else {
    rect.setAttribute("rx", "5");
    rect.setAttribute("ry", "5");
  }

  group.appendChild(rect);
}

function appendNodeText(group, node) {
  const primaryLabel = getPrimaryLabel(node);
  const secondaryLabel = getSecondaryLabel(node);

  const lines = [primaryLabel];

  if (secondaryLabel) {
    lines.push(secondaryLabel);
  }

  if (node.inlineCycle) {
    lines.push("cycle blocked");
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

function appendUnknownBadge(group, node) {
  const cx = node.x + node.width / 2 - 12;
  const cy = node.y - node.height / 2 + 12;

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", String(cx));
  circle.setAttribute("cy", String(cy));
  circle.setAttribute("r", "10");
  circle.setAttribute("class", "unknown-badge-circle");

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", String(cx));
  text.setAttribute("y", String(cy + 1));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("class", "unknown-badge-text");
  text.textContent = "?";

  group.appendChild(circle);
  group.appendChild(text);
}

function appendSubTreeHint(group, node) {
  const hint = document.createElementNS("http://www.w3.org/2000/svg", "text");
  hint.setAttribute("x", String(node.x));
  hint.setAttribute("y", String(node.y + node.height / 2 + 18));
  hint.setAttribute("text-anchor", "middle");
  hint.setAttribute("class", "bt-text bt-text-hint");

  if (openOnlyOneBehaviorTree) {
    hint.textContent = "double-click to open";
  } else if (node.inlineExpanded) {
    hint.textContent = "double-click to collapse";
  } else if (node.inlineCycle) {
    hint.textContent = "cycle blocked";
  } else if (node.attributes?.ID && findBehaviorTreeById(nodes, node.attributes.ID)) {
    hint.textContent = "double-click to expand";
  } else {
    hint.textContent = "subtree target missing";
  }

  group.appendChild(hint);
}

function selectNode(node, center) {
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

  if (center) {
    requestAnimationFrame(() => {
      const selectedNode = findNodeByPathInForest(currentLayoutRoots, selectedNodePath);

      if (selectedNode) {
        centerOnNode(selectedNode);
      }
    });
  }
}

function renderDetails(node) {
  const source = node.source;
  const definition = node.definition;
  const visibleAttributes = getVisibleAttributes(node);
  const knownPortNames = getKnownPortNames(node);
  const extraAttributes = visibleAttributes.filter(([key]) => !knownPortNames.has(key));

  detailsContainer.classList.remove("empty");

  detailsContainer.innerHTML = `
    <p><strong>Type:</strong> ${escapeHtml(node.tag)}</p>
    <p><strong>Category:</strong> ${escapeHtml(node.kind)}</p>
    ${
      node.name
        ? `<p><strong>Name:</strong> ${escapeHtml(node.name)}</p>`
        : ""
    }
    ${
      definition
        ? `<p><strong>Definition:</strong> ${escapeHtml(definition.source)}</p>`
        : ""
    }
    ${
      !node.definitionKnown
        ? `
          <div class="warning-box">
            <strong>Unknown node definition.</strong><br>
            This node was not found in the current XML TreeNodesModel, imported definitions, or built-in catalog.
            Import a TreeNodesModel XML file to classify this node and show its expected attributes.
          </div>
        `
        : ""
    }
    ${
      node.definitionKnown && definition && definition.ports.length === 0
        ? `
          <div class="info-box">
            No defined attributes for this node.
          </div>
        `
        : ""
    }
    ${
      allowEmptyAttributes
        ? `<div class="info-box">Empty attributes are allowed and will be written as empty XML attributes.</div>`
        : `<div class="info-box">Empty attributes are removed from the XML when applied.</div>`
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

    ${renderAttributeSections(node, definition, extraAttributes)}
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

  attachAttributeHandlers(node);
}

function renderAttributeSections(node, definition, extraAttributes) {
  const sections = [];

  if (definition?.ports?.length > 0) {
    sections.push(`
      <h3>Defined attributes</h3>
      <table class="attr-table">
        ${definition.ports
          .map((port) =>
            renderAttributeRow(
              port.name,
              node.attributes?.[port.name] ?? "",
              port.direction
            )
          )
          .join("")}
      </table>
    `);
  }

  if (extraAttributes.length > 0) {
    sections.push(`
      <h3>${node.definitionKnown ? "Additional XML attributes" : "Attributes"}</h3>
      <table class="attr-table">
        ${extraAttributes
          .map(([key, value]) => renderAttributeRow(key, value, undefined))
          .join("")}
      </table>
    `);
  } else if (node.definitionKnown && definition?.ports?.length === 0) {
    sections.push(`<p class="empty">No defined attributes on this node.</p>`);
  } else if (!definition?.ports?.length) {
    sections.push(`<p class="empty">No attributes on this node.</p>`);
  }

  if (!node.definitionKnown) {
    sections.push(`
      <h3>Add custom attribute</h3>
      <div class="add-attr-row">
        <input id="new-attr-name" placeholder="attribute name" />
        <input id="new-attr-value" placeholder="value" />
        <button id="add-attr-button">Add</button>
      </div>
    `);
  }

  return sections.join("");
}

function renderAttributeRow(name, value, direction) {
  return `
    <tr>
      <td class="attr-name">
        ${escapeHtml(name)}
        ${
          direction
            ? `<div class="attr-port-direction">${escapeHtml(direction)}</div>`
            : ""
        }
      </td>
      <td>
        <input
          class="attr-input"
          data-attr-name="${escapeHtml(name)}"
          value="${escapeHtml(String(value))}"
        />
      </td>
      <td>
        <button
          class="attr-apply-button"
          data-attr-name="${escapeHtml(name)}"
        >
          Apply
        </button>
      </td>
    </tr>
  `;
}

function attachAttributeHandlers(node) {
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

      applyLocalAttributeUpdate(node, attrName, input.value);

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

      applyLocalAttributeUpdate(node, attrName, attrValue);

      vscode.postMessage({
        type: "updateAttribute",
        path: node.source.path,
        attrName,
        attrValue
      });
    });
  }
}

function applyLocalAttributeUpdate(node, attrName, attrValue) {
  const shouldRemoveAttribute =
    attrValue.trim().length === 0 && !allowEmptyAttributes;

  const matchingNodes = findAllNodesByPath(nodes, node.source?.path);

  for (const matchingNode of matchingNodes) {
    if (!matchingNode.attributes) {
      matchingNode.attributes = {};
    }

    if (shouldRemoveAttribute) {
      delete matchingNode.attributes[attrName];
    } else {
      matchingNode.attributes[attrName] = attrValue;
    }

    if (matchingNode.source?.startTag) {
      matchingNode.source.startTag = shouldRemoveAttribute
        ? removeAttributeFromOpenTag(matchingNode.source.startTag, attrName)
        : setAttributeInOpenTag(
            matchingNode.source.startTag,
            attrName,
            attrValue
          );
    }

    matchingNode.name =
      matchingNode.attributes?.name ??
      matchingNode.attributes?.ID;
  }

  if (!node.attributes) {
    node.attributes = {};
  }

  if (shouldRemoveAttribute) {
    delete node.attributes[attrName];
  } else {
    node.attributes[attrName] = attrValue;
  }

  if (node.source?.startTag) {
    node.source.startTag = shouldRemoveAttribute
      ? removeAttributeFromOpenTag(node.source.startTag, attrName)
      : setAttributeInOpenTag(node.source.startTag, attrName, attrValue);
  }

  node.name =
    node.attributes?.name ??
    node.attributes?.ID;

  renderDetails(node);
  renderTree();
}

function findAllNodesByPath(roots, path) {
  const matches = [];

  if (!path) {
    return matches;
  }

  for (const root of roots) {
    collectNodesByPath(root, path, matches);
  }

  return matches;
}

function collectNodesByPath(node, path, matches) {
  if (pathsEqual(node.source?.path, path)) {
    matches.push(node);
  }

  for (const child of node.children ?? []) {
    collectNodesByPath(child, path, matches);
  }
}

function setAttributeInOpenTag(openTag, attributeName, attributeValue) {
  const escapedName = escapeRegex(attributeName);
  const attributeRegex = new RegExp(
    `(\\s${escapedName}\\s*=\\s*)(["'])([\\s\\S]*?)(\\2)`
  );

  const existing = attributeRegex.exec(openTag);

  if (existing) {
    const quote = existing[2];
    const encodedValue = encodeXmlAttribute(attributeValue, quote);

    return openTag.replace(
      attributeRegex,
      `$1${quote}${encodedValue}${quote}`
    );
  }

  const encodedValue = encodeXmlAttribute(attributeValue, '"');
  const insertText = ` ${attributeName}="${encodedValue}"`;

  if (/\/\s*>$/.test(openTag)) {
    return openTag.replace(/\/\s*>$/, `${insertText}/>`);
  }

  return openTag.replace(/\s*>$/, `${insertText}>`);
}

function removeAttributeFromOpenTag(openTag, attributeName) {
  const escapedName = escapeRegex(attributeName);
  const attributeRegex = new RegExp(
    `\\s${escapedName}\\s*=\\s*(["'])[\\s\\S]*?\\1`
  );

  return openTag.replace(attributeRegex, "");
}

function encodeXmlAttribute(value, quote) {
  let encoded = String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  if (quote === '"') {
    encoded = encoded.replaceAll('"', "&quot;");
  }

  if (quote === "'") {
    encoded = encoded.replaceAll("'", "&apos;");
  }

  return encoded;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toggleInlineSubTree(subTreeNode) {
  const subTreeKey = subTreeNode.subTreeKey ?? getSubTreeExpansionKey(subTreeNode);

  if (!subTreeKey) {
    return;
  }

  selectedNodeId = undefined;
  selectedNodePath = subTreeNode.source?.path;

  if (expandedSubTreeKeys.has(subTreeKey)) {
    expandedSubTreeKeys.delete(subTreeKey);
    expandedSubTreeKeys = pruneUnreachableExpandedSubTrees();
  } else {
    expandedSubTreeKeys.add(subTreeKey);
  }

  if (selectedNodePath) {
    vscode.postMessage({
      type: "selectNode",
      path: selectedNodePath
    });
  }

  handleTreeStructureChange();
  renderTree();

  requestAnimationFrame(() => {
    applyPostTreeChangeView();
  });
}

function pruneUnreachableExpandedSubTrees() {
  const activeRoot = findNodeByPathInForest(nodes, activeRootPath) ?? nodes[0];
  const reachableExpandedKeys = new Set();

  collectReachableExpandedSubTreeKeys(
    activeRoot,
    new Set(),
    reachableExpandedKeys
  );

  return reachableExpandedKeys;
}

function collectReachableExpandedSubTreeKeys(
  node,
  expansionStack,
  reachableExpandedKeys
) {
  if (!node) {
    return;
  }

  if (!openOnlyOneBehaviorTree && isSubTreeNode(node)) {
    const subTreeKey = getSubTreeExpansionKey(node);

    if (subTreeKey && expandedSubTreeKeys.has(subTreeKey)) {
      const targetId = node.attributes?.ID;
      const targetTree = targetId
        ? findBehaviorTreeById(nodes, targetId)
        : undefined;

      if (!targetTree || expansionStack.has(targetId)) {
        return;
      }

      reachableExpandedKeys.add(subTreeKey);

      const nextStack = new Set(expansionStack);
      nextStack.add(targetId);

      for (const child of targetTree.children ?? []) {
        collectReachableExpandedSubTreeKeys(
          child,
          nextStack,
          reachableExpandedKeys
        );
      }

      return;
    }
  }

  for (const child of node.children ?? []) {
    collectReachableExpandedSubTreeKeys(
      child,
      expansionStack,
      reachableExpandedKeys
    );
  }
}

function openSubTreeTarget(subTreeNode) {
  const targetId = subTreeNode.attributes?.ID;

  if (!targetId) {
    return;
  }

  const targetTree = findBehaviorTreeById(nodes, targetId);

  if (!targetTree) {
    return;
  }

  const currentRoot = findNodeByPathInForest(nodes, activeRootPath);

  if (currentRoot?.source?.path) {
    rootNavigationStack.push(currentRoot.source.path);
  }

  activeRootPath = targetTree.source?.path;
  selectedNodeId = undefined;
  selectedNodePath = targetTree.source?.path;

  if (selectedNodePath) {
    vscode.postMessage({
      type: "selectNode",
      path: selectedNodePath
    });
  }

  handleTreeStructureChange();
  renderDetails(targetTree);
  renderTree();

  requestAnimationFrame(() => {
    applyPostTreeChangeView();
  });
}

function findBehaviorTreeById(roots, id) {
  for (const root of roots) {
    const result = findBehaviorTreeByIdRecursive(root, id);

    if (result) {
      return result;
    }
  }

  return undefined;
}

function findBehaviorTreeByIdRecursive(node, id) {
  if (node.tag === "BehaviorTree" && node.attributes?.ID === id) {
    return node;
  }

  for (const child of node.children ?? []) {
    const result = findBehaviorTreeByIdRecursive(child, id);

    if (result) {
      return result;
    }
  }

  return undefined;
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

function centerOnNode(node) {
  if (!currentSvg || !node) {
    return;
  }

  const rect = currentSvg.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  viewState.x = rect.width / 2 - node.x * viewState.scale;
  viewState.y = rect.height / 2 - node.y * viewState.scale;

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
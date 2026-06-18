const vscode = acquireVsCodeApi();

const nodes = window.initialBtNodes ?? [];
const treeNodeDefinitions = window.initialTreeNodeDefinitions ?? [];
const importedBehaviorTrees = window.initialImportedBehaviorTrees ?? [];
const editorOptions = window.initialEditorOptions ?? {};
const openOnlyOneBehaviorTree =
  editorOptions.openOnlyOneBehaviorTree !== false;
const autoFitOnTreeChange =
  editorOptions.autoFitOnTreeChange !== false;
const allowEmptyAttributes =
  editorOptions.allowEmptyAttributes === true;
const includeFullBehaviorTree =
  editorOptions.includeFullBehaviorTree === true;

let selectedNodePath = window.initialSelectedPath ?? undefined;
let selectedNodeId = undefined;
let localNodeCounter = 0;

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
let nodeDragState = undefined;
let suppressNextNodeClick = false;

initializeActiveRoot();
attachGlobalKeyboardHandlers();

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

function attachGlobalKeyboardHandlers() {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Delete" && event.key !== "Backspace") {
      return;
    }

    if (isTextEditingElement(document.activeElement)) {
      return;
    }

    const selectedNode = findNodeByPathInForest(nodes, selectedNodePath);

    if (!selectedNode) {
      return;
    }

    event.preventDefault();

    requestDeleteNode(
      selectedNode,
      isSubTreeNode(selectedNode) &&
        selectedNode.attributes?.ID &&
        Boolean(findBehaviorTreeById(nodes, selectedNode.attributes.ID))
    );
  });
}

function isTextEditingElement(element) {
  if (!element) {
    return false;
  }

  const tagName = element.tagName?.toLowerCase();

  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    element.isContentEditable
  );
}

function renderTree() {
  treeContainer.innerHTML = "";

  if (nodes.length === 0) {
    treeContainer.textContent = "No BehaviorTree nodes found.";
    detailsContainer.classList.add("empty");
    detailsContainer.textContent = "No BehaviorTree nodes found.";
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

function isSubTreeTagName(tagName) {
  return tagName === "SubTree" || tagName === "SubTreePlus";
}

function isSubTreeDefinition(definition) {
  return definition.id === "SubTree" || definition.id === "SubTreePlus";
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

  group.style.cursor = canMoveNode(node) ? "grab" : "pointer";

  group.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    startNodeDrag(event, node, group);
  });

  group.addEventListener("click", (event) => {
    event.stopPropagation();

    if (suppressNextNodeClick) {
      suppressNextNodeClick = false;
      return;
    }

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

function canMoveNode(node) {
  const path = node.source?.path;

  if (!Array.isArray(path) || path.length < 2) {
    return false;
  }

  const siblings = getSiblingNodes(node);
  return siblings.length > 1;
}

function startNodeDrag(event, node, group) {
  if (!canMoveNode(node) || event.button !== 0) {
    return;
  }

  group.setPointerCapture(event.pointerId);
  group.style.cursor = "grabbing";

  nodeDragState = {
    node,
    group,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    currentClientX: event.clientX,
    startNodeX: node.x,
    hasMoved: false
  };

  group.addEventListener("pointermove", handleNodeDragMove);
  group.addEventListener("pointerup", finishNodeDrag);
  group.addEventListener("pointercancel", cancelNodeDrag);
}

function handleNodeDragMove(event) {
  if (!nodeDragState || event.pointerId !== nodeDragState.pointerId) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const dx = (event.clientX - nodeDragState.startClientX) / viewState.scale;

  if (Math.abs(event.clientX - nodeDragState.startClientX) > 4) {
    nodeDragState.hasMoved = true;
  }

  nodeDragState.currentClientX = event.clientX;
  nodeDragState.group.setAttribute(
    "transform",
    `translate(${dx} 0)`
  );
}

function finishNodeDrag(event) {
  if (!nodeDragState || event.pointerId !== nodeDragState.pointerId) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const dragState = nodeDragState;
  cleanupNodeDrag(event.pointerId);

  if (!dragState.hasMoved) {
    return;
  }

  suppressNextNodeClick = true;

  const dx = (event.clientX - dragState.startClientX) / viewState.scale;
  const draggedCenterX = dragState.startNodeX + dx;
  const targetIndex = getReorderTargetIndex(dragState.node, draggedCenterX);
  const originalPath = [...(dragState.node.source?.path ?? [])];

  if (targetIndex === undefined) {
    renderTree();
    return;
  }

  const movedPath = applyLocalNodeMove(originalPath, targetIndex);

  if (!movedPath) {
    renderTree();
    return;
  }

  selectedNodePath = movedPath;
  selectedNodeId = undefined;

  vscode.postMessage({
    type: "moveNode",
    path: originalPath,
    targetIndex
  });

  renderTree();
}

function cancelNodeDrag(event) {
  if (!nodeDragState || event.pointerId !== nodeDragState.pointerId) {
    return;
  }

  cleanupNodeDrag(event.pointerId);
  renderTree();
}

function cleanupNodeDrag(pointerId) {
  if (!nodeDragState) {
    return;
  }

  nodeDragState.group.removeEventListener("pointermove", handleNodeDragMove);
  nodeDragState.group.removeEventListener("pointerup", finishNodeDrag);
  nodeDragState.group.removeEventListener("pointercancel", cancelNodeDrag);
  nodeDragState.group.style.cursor = canMoveNode(nodeDragState.node)
    ? "grab"
    : "pointer";

  try {
    nodeDragState.group.releasePointerCapture(pointerId);
  } catch {
    // Pointer capture may already be released by the webview.
  }

  nodeDragState = undefined;
}

function getReorderTargetIndex(node, draggedCenterX) {
  const siblings = getSiblingNodes(node);

  if (siblings.length <= 1) {
    return undefined;
  }

  const orderedSiblings = [...siblings].sort((left, right) => left.x - right.x);
  const currentIndex = siblings.indexOf(node);
  const withoutDragged = orderedSiblings.filter((sibling) => sibling !== node);

  let insertionIndex = withoutDragged.length;

  for (let index = 0; index < withoutDragged.length; index += 1) {
    if (draggedCenterX < withoutDragged[index].x) {
      insertionIndex = index;
      break;
    }
  }

  if (insertionIndex === currentIndex) {
    return currentIndex;
  }

  return insertionIndex;
}

function getSiblingNodes(node) {
  const path = node.source?.path;

  if (!Array.isArray(path) || path.length < 2) {
    return [];
  }

  const parentPath = path.slice(0, -1);
  const parent = findNodeByPathInForest(currentLayoutRoots, parentPath);

  return parent?.children ?? [];
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

  if (
    openOnlyOneBehaviorTree &&
    node.attributes?.ID &&
    findBehaviorTreeById(nodes, node.attributes.ID)
  ) {
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
  const childLimit = getChildLimitInfo(node);

  detailsContainer.classList.remove("empty");

  detailsContainer.innerHTML = `
    <p><strong>Type:</strong> ${escapeHtml(node.tag)}</p>
    <p><strong>Category:</strong> ${escapeHtml(getDisplayCategory(node))}</p>
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
    <p><strong>Children:</strong> ${escapeHtml(String(node.children?.length ?? 0))}${childLimit.max === Infinity ? "" : ` / ${escapeHtml(String(childLimit.max))}`}</p>
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
        source && source.startOffset >= 0
          ? `
            <p class="source-location">
              Line ${source.line + 1}, column ${source.column + 1}
            </p>
            <pre class="xml-preview">${escapeHtml(source.startTag)}</pre>
            <button id="reveal-node-button">Reveal in XML</button>
          `
          : `
            <p class="source-location">
              New node inserted locally. Source location will be available after reopening or refreshing the editor.
            </p>
            <pre class="xml-preview">${escapeHtml(source?.startTag ?? "")}</pre>
          `
      }
    </div>

    ${renderAttributeSections(node, definition, extraAttributes)}
    ${renderDeleteSection(node)}
    ${renderAddBehaviorTreeSection(node)}
    ${renderAddChildSection(node, childLimit)}
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
  attachDeleteHandlers(node);
  attachAddBehaviorTreeHandlers(node);
  attachAddChildHandlers(node);
}

function getDisplayCategory(node) {
  if (isSubTreeNode(node)) {
    return "subtree";
  }

  return node.kind;
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

function renderDeleteSection(node) {
  const targetId = isSubTreeNode(node) ? node.attributes?.ID : undefined;
  const targetExists = targetId ? Boolean(findBehaviorTreeById(nodes, targetId)) : false;

  if (isSubTreeNode(node)) {
    return `
      <h3>Delete</h3>
      <div class="info-box">
        This removes the SubTree reference. If the referenced BehaviorTree exists, it and nested referenced BehaviorTrees can be removed too.
      </div>
      <button id="delete-node-and-referenced-tree-button" class="attr-apply-button">
        ${
          targetExists
            ? "Delete SubTree and referenced BehaviorTrees"
            : "Delete SubTree reference"
        }
      </button>
    `;
  }

  return `
    <h3>Delete</h3>
    <div class="info-box">
      You can also press Delete while the graph node is selected.
    </div>
    <button id="delete-node-button" class="attr-apply-button">
      Delete selected node
    </button>
  `;
}

function renderAddBehaviorTreeSection(node) {
  if (!isSubTreeNode(node)) {
    return "";
  }

  const targetId = node.attributes?.ID ?? "";
  const targetExists = targetId ? Boolean(findBehaviorTreeById(nodes, targetId)) : false;

  if (!targetId) {
    return `
      <h3>Add referenced BehaviorTree</h3>
      <div class="info-box">
        Set the SubTree ID first. The ID is used as the referenced BehaviorTree ID.
      </div>
    `;
  }

  if (targetExists) {
    return `
      <h3>Add referenced BehaviorTree</h3>
      <div class="info-box">
        Referenced BehaviorTree "${escapeHtml(targetId)}" already exists.
      </div>
    `;
  }

  return `
    <h3>Add referenced BehaviorTree</h3>
    <div class="info-box">
      This will create a new top-level BehaviorTree with ID "${escapeHtml(targetId)}".
    </div>
    <input
      id="new-behavior-tree-id"
      class="attr-input"
      value="${escapeHtml(targetId)}"
      placeholder="BehaviorTree ID"
    />
    <button id="add-behavior-tree-button" class="attr-apply-button">
      Add BehaviorTree
    </button>
  `;
}

function renderAddChildSection(node, childLimit) {
  if (!childLimit.canAdd) {
    return `
      <h3>Add child node</h3>
      <div class="info-box">
        ${escapeHtml(childLimit.reason)}
      </div>
    `;
  }

  return `
    <h3>Add child node</h3>
    <div class="info-box">
      ${escapeHtml(childLimit.reason)}
    </div>

    <label for="new-child-kind"><strong>Node category</strong></label>
    <select id="new-child-kind" class="attr-input">
      <option value="control">Control</option>
      <option value="decorator">Decorator</option>
      <option value="subtree">SubTree</option>
      <option value="condition">Condition</option>
      <option value="action">Action</option>
      <option value="custom">Custom / unknown</option>
    </select>

    <label for="new-child-known-type"><strong>Known node type</strong></label>
    <select id="new-child-known-type" class="attr-input" size="8"></select>

    <label for="new-child-custom-type"><strong>Custom node tag</strong></label>
    <input
      id="new-child-custom-type"
      class="attr-input"
      placeholder="custom XML tag"
      style="display: none;"
    />

    <div id="new-child-definition-preview"></div>

    <button id="add-child-button" class="attr-apply-button">Add child</button>
  `;
}

function getChildLimitInfo(node) {
  const childCount = node.children?.length ?? 0;

  if (node.tag === "BehaviorTree") {
    return {
      max: 1,
      canAdd: childCount < 1,
      reason:
        childCount < 1
          ? "BehaviorTree can have one root child."
          : "BehaviorTree already has its single root child."
    };
  }

  if (isSubTreeNode(node)) {
    return {
      max: 0,
      canAdd: false,
      reason: "SubTree nodes reference another BehaviorTree and do not have inline children."
    };
  }

  if (node.kind === "decorator") {
    return {
      max: 1,
      canAdd: childCount < 1,
      reason:
        childCount < 1
          ? "Decorator nodes can have one child."
          : "Decorator node already has its single child."
    };
  }

  if (node.kind === "control") {
    return {
      max: Infinity,
      canAdd: true,
      reason: "Control nodes can have multiple children."
    };
  }

  if (node.kind === "action") {
    return {
      max: 0,
      canAdd: false,
      reason: "Action nodes are leaf nodes and cannot have children."
    };
  }

  if (node.kind === "condition") {
    return {
      max: 0,
      canAdd: false,
      reason: "Condition nodes are leaf nodes and cannot have children."
    };
  }

  return {
    max: 0,
    canAdd: false,
    reason: "This node type cannot have children."
  };
}

function getDefinitionsByKind(kind) {
  if (kind === "subtree") {
    return treeNodeDefinitions
      .filter((definition) => isSubTreeDefinition(definition))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  return treeNodeDefinitions
    .filter((definition) => definition.kind === kind)
    .filter((definition) => definition.id !== "BehaviorTree")
    .filter((definition) => !isSubTreeDefinition(definition))
    .sort((left, right) => left.id.localeCompare(right.id));
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

function renderChildPortRow(port) {
  return `
    <tr>
      <td class="attr-name">
        ${escapeHtml(port.name)}
        <div class="attr-port-direction">${escapeHtml(port.direction)}</div>
      </td>
      <td>
        <input
          class="attr-input new-child-port-input"
          data-port-name="${escapeHtml(port.name)}"
          placeholder="${allowEmptyAttributes ? "empty value allowed" : "empty value will be omitted"}"
        />
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

function attachDeleteHandlers(node) {
  const deleteButton = document.getElementById("delete-node-button");
  const deleteWithTreeButton = document.getElementById(
    "delete-node-and-referenced-tree-button"
  );

  if (deleteButton) {
    deleteButton.addEventListener("click", () => {
      requestDeleteNode(node, false);
    });
  }

  if (deleteWithTreeButton) {
    deleteWithTreeButton.addEventListener("click", () => {
      requestDeleteNode(
        node,
        isSubTreeNode(node) &&
          node.attributes?.ID &&
          Boolean(findBehaviorTreeById(nodes, node.attributes.ID))
      );
    });
  }
}

function requestDeleteNode(node, deleteReferencedBehaviorTree) {
  const pathToDelete = node.source?.path;

  if (!pathToDelete) {
    return;
  }

  vscode.postMessage({
    type: "deleteNode",
    path: pathToDelete,
    deleteReferencedBehaviorTree: Boolean(deleteReferencedBehaviorTree)
  });

  applyLocalNodeDelete(
    pathToDelete,
    Boolean(deleteReferencedBehaviorTree),
    node
  );

  renderTree();
}

function attachAddBehaviorTreeHandlers(node) {
  const button = document.getElementById("add-behavior-tree-button");
  const input = document.getElementById("new-behavior-tree-id");

  if (!button || !input) {
    return;
  }

  button.addEventListener("click", () => {
    const behaviorTreeId = input.value.trim();

    if (!behaviorTreeId) {
      return;
    }

    if (!isValidXmlName(behaviorTreeId)) {
      input.setCustomValidity("Invalid XML ID.");
      input.reportValidity();
      return;
    }

    applyLocalImportedBehaviorTreeChainInsert(node, behaviorTreeId, true);

    vscode.postMessage({
      type: "addBehaviorTree",
      referencePath: node.source.path,
      behaviorTreeId
    });

    renderTree();
  });
}

function attachAddChildHandlers(parentNode) {
  const kindSelect = document.getElementById("new-child-kind");
  const knownTypeSelect = document.getElementById("new-child-known-type");
  const customTypeInput = document.getElementById("new-child-custom-type");
  const addButton = document.getElementById("add-child-button");
  const definitionPreview = document.getElementById("new-child-definition-preview");

  if (
    !kindSelect ||
    !knownTypeSelect ||
    !customTypeInput ||
    !addButton ||
    !definitionPreview
  ) {
    return;
  }

  function populateKnownTypeSelect() {
    const kind = kindSelect.value;

    knownTypeSelect.innerHTML = "";

    if (kind === "custom") {
      knownTypeSelect.style.display = "none";
      customTypeInput.style.display = "block";
      updateDefinitionPreview();
      return;
    }

    knownTypeSelect.style.display = "block";
    customTypeInput.style.display = "none";

    const definitions = getDefinitionsByKind(kind);

    for (const definition of definitions) {
      const option = document.createElement("option");
      option.value = definition.id;
      option.textContent = definition.id;
      option.dataset.nodeTag = definition.id;
      knownTypeSelect.appendChild(option);
    }

    if (kind === "subtree") {
      for (const behaviorTree of importedBehaviorTrees) {
        const option = document.createElement("option");
        option.value = `imported:${behaviorTree.id}`;
        option.textContent = `SubTree: ${behaviorTree.id}`;
        option.title = behaviorTree.source ?? "";
        option.dataset.nodeTag = "SubTree";
        option.dataset.templateId = behaviorTree.id;
        knownTypeSelect.appendChild(option);
      }
    }

    if (definitions.length > 0) {
      knownTypeSelect.value = definitions[0].id;
    }

    updateDefinitionPreview();
  }

  function getSelectedTagName() {
    if (kindSelect.value === "custom") {
      return customTypeInput.value.trim();
    }

    return (
      getSelectedKnownTypeOption()?.dataset.nodeTag?.trim() ??
      knownTypeSelect.value.trim()
    );
  }

  function getSelectedKnownTypeOption() {
    return knownTypeSelect.selectedOptions?.[0];
  }

  function updateDefinitionPreview() {
    const tagName = getSelectedTagName();

    if (!tagName) {
      definitionPreview.innerHTML = "";
      return;
    }

    const definition = findDefinitionById(tagName);

    if (!definition) {
      definitionPreview.innerHTML = `
        <div class="warning-box">
          Unknown node type. It will be inserted as a custom XML node without predefined attributes.
        </div>
      `;
      return;
    }

    if (definition.ports.length === 0) {
      definitionPreview.innerHTML = `
        <div class="info-box">
          Known ${escapeHtml(getDefinitionDisplayCategory(definition))} node with no defined attributes.
        </div>
      `;
      applySelectedSubtreeTemplateToIdInput();
      return;
    }

    definitionPreview.innerHTML = `
      ${renderSelectedSubtreeTemplatePreview()}
      <h3>New child attributes</h3>
      <table class="attr-table">
        ${definition.ports.map((port) => renderChildPortRow(port)).join("")}
      </table>
    `;

    applySelectedSubtreeTemplateToIdInput();
  }

  function renderSelectedSubtreeTemplatePreview() {
    const behaviorTree = getSelectedImportedBehaviorTree();

    if (!behaviorTree) {
      return "";
    }

    return `
      <div class="info-box">
        Imported BehaviorTree "${escapeHtml(behaviorTree.id)}" selected. ${
          includeFullBehaviorTree
            ? "The full referenced BehaviorTree XML will be inserted if it is not already in this XML."
            : "Only the SubTree reference will be inserted."
        }
      </div>
    `;
  }

  function applySelectedSubtreeTemplateToIdInput() {
    if (kindSelect.value !== "subtree") {
      return;
    }

    const behaviorTree = getSelectedImportedBehaviorTree();

    if (!behaviorTree) {
      return;
    }

    const idInput = document.querySelector(
      '.new-child-port-input[data-port-name="ID"]'
    );

    if (idInput) {
      idInput.value = behaviorTree.id;
    }

    const autoremapInput = document.querySelector(
      '.new-child-port-input[data-port-name="_autoremap"]'
    );

    if (autoremapInput && !autoremapInput.value) {
      autoremapInput.value = "true";
    }
  }

  function getSelectedImportedBehaviorTree() {
    const selectedId = getSelectedKnownTypeOption()?.dataset.templateId;

    if (!selectedId) {
      return undefined;
    }

    return importedBehaviorTrees.find((tree) => tree.id === selectedId);
  }

  kindSelect.addEventListener("change", populateKnownTypeSelect);
  knownTypeSelect.addEventListener("change", updateDefinitionPreview);
  customTypeInput.addEventListener("input", updateDefinitionPreview);

  addButton.addEventListener("click", () => {
    const childLimit = getChildLimitInfo(parentNode);

    if (!childLimit.canAdd) {
      definitionPreview.innerHTML = `
        <div class="warning-box">
          ${escapeHtml(childLimit.reason)}
        </div>
      `;
      return;
    }

    const tagName = getSelectedTagName();

    if (!tagName) {
      return;
    }

    if (!isValidXmlName(tagName)) {
      definitionPreview.innerHTML = `
        <div class="warning-box">
          Invalid XML tag name.
        </div>
      `;
      return;
    }

    const definition = findDefinitionById(tagName);
    const attributes = {};

    for (const input of document.querySelectorAll(".new-child-port-input")) {
      const portName = input.getAttribute("data-port-name");

      if (!portName) {
        continue;
      }

      const value = input.value;

      if (value.trim().length === 0 && !allowEmptyAttributes) {
        continue;
      }

      attributes[portName] = value;
    }

    const newChild = applyLocalChildNodeInsert(
      parentNode,
      tagName,
      attributes,
      definition
    );

    vscode.postMessage({
      type: "addChildNode",
      parentPath: parentNode.source.path,
      tagName,
      attributes
    });

    const subtreeId = attributes.ID?.trim();
    const shouldCreateReferencedBehaviorTree =
      includeFullBehaviorTree &&
      isSubTreeTagName(tagName) &&
      subtreeId &&
      !findBehaviorTreeById(nodes, subtreeId);

    if (shouldCreateReferencedBehaviorTree) {
      applyLocalImportedBehaviorTreeChainInsert(parentNode, subtreeId, false);
    }

    selectedNodePath = newChild.source.path;
    selectedNodeId = newChild.id;

    renderTree();
  });

  populateKnownTypeSelect();
}

function getDefinitionDisplayCategory(definition) {
  if (isSubTreeDefinition(definition)) {
    return "subtree";
  }

  return definition.kind;
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

function applyLocalChildNodeInsert(parentNode, tagName, attributes, definition) {
  const matchingParents = findAllNodesByPath(nodes, parentNode.source?.path);
  let newChild = undefined;

  for (const matchingParent of matchingParents) {
    const childPath = [
      ...matchingParent.source.path,
      matchingParent.children.length
    ];

    const childNode = createLocalChildNode(
      tagName,
      attributes,
      definition,
      childPath
    );

    matchingParent.children.push(childNode);

    if (matchingParent.source?.startTag) {
      matchingParent.source.startTag = matchingParent.source.startTag.replace(
        /\/\s*>$/,
        ">"
      );
    }

    if (!newChild) {
      newChild = childNode;
    }
  }

  if (!newChild) {
    const childPath = [...parentNode.source.path, parentNode.children.length];

    newChild = createLocalChildNode(
      tagName,
      attributes,
      definition,
      childPath
    );

    parentNode.children.push(newChild);
  }

  return newChild;
}

function applyLocalNodeDelete(pathToDelete, deleteReferencedBehaviorTree, nodeToDelete) {
  const referencedIds =
    deleteReferencedBehaviorTree && isSubTreeNode(nodeToDelete)
      ? collectReferencedBehaviorTreeIdsForDelete(nodes, nodeToDelete)
      : [];

  removeNodeByPath(nodes, pathToDelete);

  for (const referencedId of referencedIds) {
    removeBehaviorTreeById(nodes, referencedId);
  }

  refreshRootPaths();

  const parentPath = pathToDelete.length > 1 ? pathToDelete.slice(0, -1) : undefined;
  const nextSelectedNode =
    findNodeByPathInForest(nodes, parentPath) ??
    findNodeByPathInForest(nodes, activeRootPath) ??
    findPreferredTopRoot(nodes);

  selectedNodePath = nextSelectedNode?.source?.path;
  selectedNodeId = nextSelectedNode?.id;
  activeRootPath =
    findRootContainingPath(nodes, selectedNodePath)?.source?.path ??
    findPreferredTopRoot(nodes)?.source?.path;
}

function applyLocalNodeMove(pathToMove, targetIndex) {
  if (!Array.isArray(pathToMove) || pathToMove.length < 2) {
    return undefined;
  }

  const parentPath = pathToMove.slice(0, -1);
  const sourceIndex = pathToMove[pathToMove.length - 1];
  const parent = findNodeByPathInForest(nodes, parentPath);

  if (!parent || !Array.isArray(parent.children)) {
    return undefined;
  }

  if (
    sourceIndex < 0 ||
    sourceIndex >= parent.children.length ||
    parent.children.length <= 1
  ) {
    return undefined;
  }

  const clampedTargetIndex = clamp(
    targetIndex,
    0,
    parent.children.length - 1
  );

  if (clampedTargetIndex === sourceIndex) {
    return pathToMove;
  }

  const [movedNode] = parent.children.splice(sourceIndex, 1);
  const insertionIndex = clamp(clampedTargetIndex, 0, parent.children.length);

  parent.children.splice(insertionIndex, 0, movedNode);
  refreshRootPaths();

  return [
    ...parentPath,
    insertionIndex
  ];
}

function collectReferencedBehaviorTreeIdsForDelete(roots, nodeToDelete) {
  const referencedId = getReferencedBehaviorTreeId(nodeToDelete);

  if (!referencedId) {
    return [];
  }

  const collectedIds = [];
  const visitedIds = new Set();

  collectReferencedBehaviorTreeIdsRecursive(
    roots,
    referencedId,
    visitedIds,
    collectedIds
  );

  return collectedIds;
}

function collectReferencedBehaviorTreeIdsRecursive(
  roots,
  behaviorTreeId,
  visitedIds,
  collectedIds
) {
  if (visitedIds.has(behaviorTreeId)) {
    return;
  }

  visitedIds.add(behaviorTreeId);
  collectedIds.push(behaviorTreeId);

  const behaviorTree = findBehaviorTreeById(roots, behaviorTreeId);

  if (!behaviorTree) {
    return;
  }

  collectNestedReferencedBehaviorTreeIds(
    roots,
    behaviorTree,
    visitedIds,
    collectedIds
  );
}

function collectNestedReferencedBehaviorTreeIds(
  roots,
  node,
  visitedIds,
  collectedIds
) {
  const referencedId = getReferencedBehaviorTreeId(node);

  if (referencedId) {
    collectReferencedBehaviorTreeIdsRecursive(
      roots,
      referencedId,
      visitedIds,
      collectedIds
    );
  }

  for (const child of node.children ?? []) {
    collectNestedReferencedBehaviorTreeIds(
      roots,
      child,
      visitedIds,
      collectedIds
    );
  }
}

function getReferencedBehaviorTreeId(node) {
  if (!isSubTreeNode(node)) {
    return undefined;
  }

  const id = node.attributes?.ID?.trim();

  return id || undefined;
}

function removeNodeByPath(roots, path) {
  if (!path || path.length === 0) {
    return false;
  }

  if (path.length === 1) {
    roots.splice(path[0], 1);
    return true;
  }

  const parentPath = path.slice(0, -1);
  const childIndex = path[path.length - 1];
  const parent = findNodeByPathInForest(roots, parentPath);

  if (!parent || !Array.isArray(parent.children)) {
    return false;
  }

  parent.children.splice(childIndex, 1);
  return true;
}

function removeBehaviorTreeById(roots, behaviorTreeId) {
  const index = roots.findIndex((node) => {
    return node.tag === "BehaviorTree" && node.attributes?.ID === behaviorTreeId;
  });

  if (index >= 0) {
    roots.splice(index, 1);
  }
}

function applyLocalImportedBehaviorTreeChainInsert(
  referenceNode,
  behaviorTreeId,
  makeActive,
  visitedIds = new Set()
) {
  if (visitedIds.has(behaviorTreeId)) {
    return findBehaviorTreeById(nodes, behaviorTreeId);
  }

  visitedIds.add(behaviorTreeId);

  const importedBehaviorTree = findImportedBehaviorTreeById(behaviorTreeId);
  const insertedTree = applyLocalBehaviorTreeInsert(
    referenceNode,
    behaviorTreeId,
    makeActive,
    importedBehaviorTree?.tree
  );

  if (!importedBehaviorTree?.tree) {
    return insertedTree;
  }

  for (const nestedBehaviorTreeId of collectReferencedBehaviorTreeIdsFromTree(
    importedBehaviorTree.tree
  )) {
    if (
      !findImportedBehaviorTreeById(nestedBehaviorTreeId) ||
      findBehaviorTreeById(nodes, nestedBehaviorTreeId)
    ) {
      continue;
    }

    applyLocalImportedBehaviorTreeChainInsert(
      referenceNode,
      nestedBehaviorTreeId,
      false,
      visitedIds
    );
  }

  return insertedTree;
}

function collectReferencedBehaviorTreeIdsFromTree(tree) {
  const referencedIds = [];
  const visitedIds = new Set();

  collectReferencedBehaviorTreeIdsFromTreeNode(
    tree,
    referencedIds,
    visitedIds
  );

  return referencedIds;
}

function collectReferencedBehaviorTreeIdsFromTreeNode(
  node,
  referencedIds,
  visitedIds
) {
  const referencedId = getReferencedBehaviorTreeId(node);

  if (referencedId && !visitedIds.has(referencedId)) {
    visitedIds.add(referencedId);
    referencedIds.push(referencedId);
  }

  for (const child of node.children ?? []) {
    collectReferencedBehaviorTreeIdsFromTreeNode(
      child,
      referencedIds,
      visitedIds
    );
  }
}

function applyLocalBehaviorTreeInsert(
  referenceNode,
  behaviorTreeId,
  makeActive,
  templateTree = undefined
) {
  const existing = findBehaviorTreeById(nodes, behaviorTreeId);

  if (existing) {
    if (makeActive) {
      selectedNodePath = existing.source?.path;
      selectedNodeId = existing.id;
      activeRootPath = existing.source?.path;
    }

    return existing;
  }

  const referenceRoot = findRootContainingPath(nodes, referenceNode.source?.path);
  const rootIndex = referenceRoot ? nodes.indexOf(referenceRoot) : nodes.length - 1;
  const insertIndex = rootIndex >= 0 ? rootIndex + 1 : nodes.length;

  const newTree = templateTree
    ? cloneImportedBehaviorTreeNode(templateTree, behaviorTreeId, [insertIndex])
    : createLocalBehaviorTreeNode(behaviorTreeId, [insertIndex]);

  nodes.splice(insertIndex, 0, newTree);

  refreshRootPaths();

  if (makeActive) {
    selectedNodePath = newTree.source.path;
    selectedNodeId = newTree.id;
    activeRootPath = newTree.source.path;
  }

  return newTree;
}

function cloneImportedBehaviorTreeNode(templateNode, behaviorTreeId, path) {
  const clonedNode = cloneImportedTreeNodeRecursive(templateNode, path);

  clonedNode.attributes = {
    ...(clonedNode.attributes ?? {}),
    ID: behaviorTreeId
  };
  clonedNode.name = behaviorTreeId;
  clonedNode.source.startTag = setAttributeInOpenTag(
    clonedNode.source.startTag,
    "ID",
    behaviorTreeId
  );

  return clonedNode;
}

function cloneImportedTreeNodeRecursive(templateNode, path) {
  localNodeCounter += 1;

  const clonedNode = {
    id: `local-node-${localNodeCounter}`,
    tag: templateNode.tag,
    kind: templateNode.kind,
    name: templateNode.name,
    attributes: {
      ...(templateNode.attributes ?? {})
    },
    children: [],
    source: {
      path,
      startOffset: -1,
      endOpenTagOffset: -1,
      line: -1,
      column: -1,
      startTag: templateNode.source?.startTag ?? buildSelfClosingStartTag(
        templateNode.tag,
        templateNode.attributes ?? {}
      )
    },
    definitionKnown: templateNode.definitionKnown,
    definition: templateNode.definition
  };

  clonedNode.children = (templateNode.children ?? []).map((child, index) =>
    cloneImportedTreeNodeRecursive(child, [...path, index])
  );

  return clonedNode;
}

function createLocalChildNode(tagName, attributes, definition, path) {
  localNodeCounter += 1;

  return {
    id: `local-node-${localNodeCounter}`,
    tag: tagName,
    kind: definition?.kind ?? "action",
    name: attributes.name ?? attributes.ID,
    attributes: {
      ...attributes
    },
    children: [],
    source: {
      path,
      startOffset: -1,
      endOpenTagOffset: -1,
      line: -1,
      column: -1,
      startTag: buildSelfClosingStartTag(tagName, attributes)
    },
    definitionKnown: Boolean(definition),
    definition
  };
}

function createLocalBehaviorTreeNode(behaviorTreeId, path) {
  localNodeCounter += 1;

  const definition = findDefinitionById("BehaviorTree") ?? {
    id: "BehaviorTree",
    kind: "control",
    ports: [{ name: "ID", direction: "input" }],
    source: "builtin"
  };

  return {
    id: `local-node-${localNodeCounter}`,
    tag: "BehaviorTree",
    kind: "control",
    name: behaviorTreeId,
    attributes: {
      ID: behaviorTreeId
    },
    children: [],
    source: {
      path,
      startOffset: -1,
      endOpenTagOffset: -1,
      line: -1,
      column: -1,
      startTag: `<BehaviorTree ID="${encodeXmlAttribute(behaviorTreeId, '"')}">`
    },
    definitionKnown: true,
    definition
  };
}

function buildSelfClosingStartTag(tagName, attributes) {
  const serializedAttributes = Object.entries(attributes)
    .map(([name, value]) => {
      return ` ${name}="${encodeXmlAttribute(value, '"')}"`;
    })
    .join("");

  return `<${tagName}${serializedAttributes}/>`;
}

function findDefinitionById(id) {
  return treeNodeDefinitions.find((definition) => definition.id === id);
}

function findImportedBehaviorTreeById(id) {
  return importedBehaviorTrees.find((tree) => tree.id === id);
}

function isValidXmlName(value) {
  return /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value);
}

function findRootContainingPath(roots, path) {
  if (!path) {
    return undefined;
  }

  return roots.find((root) => {
    return isPathPrefix(root.source?.path, path);
  });
}

function isPathPrefix(prefix, path) {
  if (!Array.isArray(prefix) || !Array.isArray(path)) {
    return false;
  }

  if (prefix.length > path.length) {
    return false;
  }

  return prefix.every((value, index) => value === path[index]);
}

function refreshRootPaths() {
  const wrapperPrefix = getBehaviorTreeWrapperPrefix();

  for (let i = 0; i < nodes.length; i += 1) {
    const rootPath = wrapperPrefix
      ? [...wrapperPrefix, i]
      : [i];

    updatePathRecursive(nodes[i], rootPath);
  }
}

function getBehaviorTreeWrapperPrefix() {
  const firstPath = nodes[0]?.source?.path;

  if (!Array.isArray(firstPath) || firstPath.length <= 1) {
    return undefined;
  }

  return firstPath.slice(0, -1);
}

function updatePathRecursive(node, path) {
  if (node.source) {
    node.source.path = path;
  }

  for (let i = 0; i < (node.children ?? []).length; i += 1) {
    updatePathRecursive(node.children[i], [...path, i]);
  }
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

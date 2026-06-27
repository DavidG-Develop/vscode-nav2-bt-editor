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
let copiedNode = undefined;
let clipboardMode = "copy";
let clipboardWarning = undefined;

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

const DRAG_SUBTREE_OPEN_DELAY_MS = 1000;

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
let nodeGroupsByPath = new Map();
let dropZoneElements = [];
let nodeDragState = undefined;
let suppressNextNodeClick = false;
let suppressNextNodeClickTimer = undefined;
let dragSubTreeOpenTimer = undefined;
let dragSubTreeOpenPathKey = undefined;
let dragNavigationPendingGroup = undefined;

initializeActiveRoot();
attachGlobalKeyboardHandlers();
attachExtensionMessageHandlers();

function initializeActiveRoot() {
  if (!openOnlyOneBehaviorTree) {
    const preferredRoot = findPreferredTopRoot(nodes);
    activeRootPath = preferredRoot?.source?.path ?? nodes[0]?.source?.path;
    return;
  }

  if (selectedNodePath) {
    const selectedRoot = findRootContainingPath(nodes, selectedNodePath);

    if (selectedRoot) {
      activeRootPath = selectedRoot.source?.path;
      return;
    }
  }

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
    if (isTextEditingElement(document.activeElement)) {
      return;
    }

    const selectedNode = findNodeByPathInForest(nodes, selectedNodePath);

    if (!selectedNode) {
      return;
    }

    const key = event.key.toLowerCase();
    const modifierPressed = event.ctrlKey || event.metaKey;

    if (modifierPressed && key === "c") {
      event.preventDefault();
      copySelectedNode(selectedNode);
      return;
    }

    if (modifierPressed && key === "x") {
      event.preventDefault();
      cutSelectedNode(selectedNode);
      return;
    }

    if (modifierPressed && key === "v") {
      event.preventDefault();
      pasteCopiedNodeInto(selectedNode);
      return;
    }

    if (event.key !== "Delete" && event.key !== "Backspace") {
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

function attachExtensionMessageHandlers() {
  window.addEventListener("message", (event) => {
    const message = event.data;

    if (message?.type === "sourceMetadataUpdated") {
      applyParsedSourceMetadataUpdate(message.nodes);
      return;
    }

    if (message?.type === "documentSynced") {
      applyParsedDocumentSync(
        message.nodes,
        message.selectedPath,
        Boolean(message.refit)
      );
      return;
    }

    if (message?.type === "xmlNodeSelected") {
      applyXmlNodeSelection(message.path);
    }
  });
}

function applyXmlNodeSelection(path) {
  if (!Array.isArray(path)) {
    return;
  }

  const node = findNodeByPathInForest(nodes, path);

  if (!node) {
    return;
  }

  selectedNodePath = path;
  selectedNodeId = undefined;

  updateActiveRootAfterSelection(selectedNodePath);

  renderDetails(node);
  renderTree();

  requestAnimationFrame(() => {
    const selectedNode = findNodeByPathInForest(currentLayoutRoots, selectedNodePath);

    if (selectedNode) {
      centerOnNode(selectedNode);
    }
  });
}

function applyParsedDocumentSync(parsedNodes, nextSelectedPath, refit) {
  if (!Array.isArray(parsedNodes)) {
    return;
  }

  nodes.splice(0, nodes.length, ...parsedNodes);

  selectedNodePath = Array.isArray(nextSelectedPath)
    ? nextSelectedPath
    : undefined;
  selectedNodeId = undefined;

  updateActiveRootAfterSelection(selectedNodePath);

  expandedSubTreeKeys = pruneUnreachableExpandedSubTrees();
  renderTree();

  if (refit) {
    requestAnimationFrame(() => {
      applyPostTreeChangeView();
    });
  }
}

function updateActiveRootAfterSelection(path) {
  if (!openOnlyOneBehaviorTree) {
    const preferredRoot = findPreferredTopRoot(nodes);
    activeRootPath = preferredRoot?.source?.path ?? nodes[0]?.source?.path;
    return;
  }

  const selectedRoot = findRootContainingPath(nodes, path);

  if (selectedRoot) {
    activeRootPath = selectedRoot.source?.path;
  } else if (!findNodeByPathInForest(nodes, activeRootPath)) {
    activeRootPath = findPreferredTopRoot(nodes)?.source?.path;
  }
}

function applyParsedSourceMetadataUpdate(parsedNodes) {
  if (!Array.isArray(parsedNodes)) {
    return;
  }

  for (const parsedNode of parsedNodes) {
    mergeParsedNodeMetadata(parsedNode);
  }

  const selectedNode = findNodeByPathInForest(nodes, selectedNodePath);

  if (selectedNode) {
    renderDetails(selectedNode);
  }
}

function mergeParsedNodeMetadata(parsedNode) {
  const path = parsedNode?.source?.path;

  if (!Array.isArray(path)) {
    return;
  }

  const node = findNodeByPathInForest(nodes, path);

  if (node) {
    updateNodeMetadata(node, parsedNode);
  }

  for (const child of parsedNode.children ?? []) {
    mergeParsedNodeMetadata(child);
  }
}

function updateNodeMetadata(node, parsedNode) {
  node.source = parsedNode.source;
  node.attributes = parsedNode.attributes;
  node.name = parsedNode.name;
  node.kind = parsedNode.kind;
  node.definitionKnown = parsedNode.definitionKnown;
  node.definition = parsedNode.definition;
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
  nodeGroupsByPath = new Map();
  dropZoneElements = [];

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

  const pathKey = getPathKey(node.source?.path);

  if (pathKey) {
    nodeGroupsByPath.set(pathKey, group);
  }

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
      if (suppressNextNodeClickTimer !== undefined) {
        window.clearTimeout(suppressNextNodeClickTimer);
        suppressNextNodeClickTimer = undefined;
      }
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

  return node.source.startOffset >= 0;
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
    captureGroup: group,
    isGhost: false,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    currentClientX: event.clientX,
    currentClientY: event.clientY,
    startNodeX: node.x,
    startNodeY: node.y,
    dropTargetPath: undefined,
    dropTargetGroup: undefined,
    dropZone: undefined,
    hasMoved: false
  };

  window.addEventListener("pointermove", handleNodeDragMove, true);
  window.addEventListener("pointerup", finishNodeDrag, true);
  window.addEventListener("pointercancel", cancelNodeDrag, true);
}

function handleNodeDragMove(event) {
  if (!nodeDragState || event.pointerId !== nodeDragState.pointerId) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const movedPastThreshold =
    Math.abs(event.clientX - nodeDragState.startClientX) > 4 ||
    Math.abs(event.clientY - nodeDragState.startClientY) > 4;

  if (!nodeDragState.hasMoved && movedPastThreshold) {
    nodeDragState.hasMoved = true;
    updateSubTreeHintTextsForDrag(true);
    renderDragDropZones(nodeDragState.node);
  }

  const isPanningDuringDrag = nodeDragState.hasMoved && isDragPanEvent(event);

  if (isPanningDuringDrag) {
    const panDx = event.clientX - nodeDragState.currentClientX;
    const panDy = event.clientY - nodeDragState.currentClientY;

    viewState.x += panDx;
    viewState.y += panDy;
    nodeDragState.startClientX += panDx;
    nodeDragState.startClientY += panDy;
    applyTransform();
  }

  nodeDragState.currentClientX = event.clientX;
  nodeDragState.currentClientY = event.clientY;

  if (!nodeDragState.hasMoved) {
    return;
  }

  const dx = (event.clientX - nodeDragState.startClientX) / viewState.scale;
  const dy = (event.clientY - nodeDragState.startClientY) / viewState.scale;

  positionDraggedNode(event.clientX, event.clientY, dx, dy);

  updateNodeDragDropTarget(event.clientX, event.clientY);

  if (isPanningDuringDrag) {
    clearDragSubTreeHover();
  } else {
    updateDragTreeNavigationHover(event.clientX, event.clientY);
  }
}

function isDragPanEvent(event) {
  return event.altKey || (event.buttons & 4) !== 0;
}

function finishNodeDrag(event) {
  if (!nodeDragState || event.pointerId !== nodeDragState.pointerId) {
    return;
  }

  const dragState = nodeDragState;

  if (!dragState.hasMoved) {
    cleanupNodeDrag(event.pointerId);
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const originalPath = [...(dragState.node.source?.path ?? [])];
  const dropTargetPath = dragState.dropTargetPath
    ? [...dragState.dropTargetPath]
    : undefined;
  const dropInsertionIndex = dragState.dropZone
    ? getDropInsertionIndex(
      dragState.dropZone.parentNode,
      dragState.node,
      clientPointToContentPoint(event.clientX, event.clientY)
    )
    : undefined;

  cleanupNodeDrag(event.pointerId);

  suppressImmediateDragClick();

  if (dropTargetPath) {
    if (pathsEqual(originalPath.slice(0, -1), dropTargetPath)) {
      const targetIndex = getReorderTargetIndex(
        dragState.node,
        dragState.startNodeX + (event.clientX - dragState.startClientX) / viewState.scale
      );

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
      return;
    }

    selectedNodePath = undefined;
    selectedNodeId = undefined;

    vscode.postMessage({
      type: "pasteNode",
      sourcePath: originalPath,
      parentPath: dropTargetPath,
      targetIndex: dropInsertionIndex,
      move: true
    });

    renderTree();
    return;
  }

  renderTree();
}

function cancelNodeDrag(event) {
  if (!nodeDragState || event.pointerId !== nodeDragState.pointerId) {
    return;
  }

  cleanupNodeDrag(event.pointerId);
  renderTree();
}

function suppressImmediateDragClick() {
  suppressNextNodeClick = true;

  if (suppressNextNodeClickTimer !== undefined) {
    window.clearTimeout(suppressNextNodeClickTimer);
  }

  suppressNextNodeClickTimer = window.setTimeout(() => {
    suppressNextNodeClick = false;
    suppressNextNodeClickTimer = undefined;
  }, 0);
}

function positionDraggedNode(clientX, clientY, dx, dy) {
  if (!nodeDragState?.group) {
    return;
  }

  if (nodeDragState.isGhost) {
    const point = clientPointToContentPoint(clientX, clientY);
    nodeDragState.group.setAttribute(
      "transform",
      `translate(${point.x - nodeDragState.node.x} ${point.y - nodeDragState.node.y})`
    );
    return;
  }

  nodeDragState.group.setAttribute(
    "transform",
    `translate(${dx} ${dy})`
  );
}

function updateDragTreeNavigationHover(clientX, clientY) {
  if (!nodeDragState?.hasMoved) {
    clearDragSubTreeHover();
    return;
  }

  const contentPoint = clientPointToContentPoint(clientX, clientY);

  if (!openOnlyOneBehaviorTree) {
    updateInlineDragSubTreeHover(contentPoint);
    return;
  }

  const hoverRoot = findBehaviorTreeNodeAtPoint(contentPoint);

  if (
    hoverRoot &&
    rootNavigationStack.length > 0 &&
    pathsEqual(hoverRoot.source?.path, activeRootPath)
  ) {
    scheduleDragTreeNavigation(
      `up:${getPathKey(hoverRoot.source?.path)}`,
      hoverRoot.source?.path,
      () => openParentTreeDuringDrag()
    );
    return;
  }

  const hoverNode = findSubTreeNodeAtPoint(contentPoint);
  const hoverPath = hoverNode?.source?.path;
  const sourcePath = nodeDragState.node.source?.path;
  const hoverKey = getPathKey(hoverPath);

  if (
    !hoverNode ||
    !hoverKey ||
    pathsEqual(hoverPath, sourcePath) ||
    !canOpenSubTreeDuringDrag(nodeDragState.node, hoverNode)
  ) {
    clearDragSubTreeHover();
    return;
  }

  scheduleDragTreeNavigation(
    `down:${hoverKey}`,
    hoverPath,
    () => openSubTreeTargetDuringDrag(hoverNode)
  );
}

function updateInlineDragSubTreeHover(contentPoint) {
  const hoverNode = findSubTreeNodeAtPoint(contentPoint);
  const hoverPath = hoverNode?.source?.path;
  const hoverKey = getPathKey(hoverPath);
  const subTreeKey = hoverNode?.subTreeKey ?? getSubTreeExpansionKey(hoverNode);

  if (
    !hoverNode ||
    !hoverKey ||
    !subTreeKey ||
    pathsEqual(hoverPath, nodeDragState.node.source?.path) ||
    expandedSubTreeKeys.has(subTreeKey) ||
    !canExpandInlineSubTreeDuringDrag(nodeDragState.node, hoverNode)
  ) {
    clearDragSubTreeHover();
    return;
  }

  scheduleDragTreeNavigation(
    `inline:${hoverKey}`,
    hoverPath,
    () => expandInlineSubTreeDuringDrag(hoverNode)
  );
}

function scheduleDragTreeNavigation(key, targetPath, navigate) {
  if (key === dragSubTreeOpenPathKey) {
    return;
  }

  clearDragSubTreeHover();
  dragSubTreeOpenPathKey = key;
  dragNavigationPendingGroup = nodeGroupsByPath.get(getPathKey(targetPath));
  dragNavigationPendingGroup?.classList.add("drag-navigation-pending");
  dragSubTreeOpenTimer = window.setTimeout(navigate, DRAG_SUBTREE_OPEN_DELAY_MS);
}

function clearDragSubTreeHover() {
  if (dragSubTreeOpenTimer !== undefined) {
    window.clearTimeout(dragSubTreeOpenTimer);
  }

  dragNavigationPendingGroup?.classList.remove("drag-navigation-pending");
  dragNavigationPendingGroup = undefined;
  dragSubTreeOpenTimer = undefined;
  dragSubTreeOpenPathKey = undefined;
}

function canOpenSubTreeDuringDrag(sourceNode, subTreeNode) {
  const targetId = subTreeNode.attributes?.ID;
  const targetTree = targetId ? findBehaviorTreeById(nodes, targetId) : undefined;

  if (!targetTree || pathsEqual(targetTree.source?.path, activeRootPath)) {
    return false;
  }

  return !containsSubTreeReferenceCycle(sourceNode, targetTree);
}

function canExpandInlineSubTreeDuringDrag(sourceNode, subTreeNode) {
  const targetId = subTreeNode.attributes?.ID;
  const targetTree = targetId ? findBehaviorTreeById(nodes, targetId) : undefined;

  if (!targetTree) {
    return false;
  }

  return !containsSubTreeReferenceCycle(sourceNode, targetTree);
}

function openSubTreeTargetDuringDrag(subTreeNode) {
  if (!nodeDragState?.hasMoved || !canOpenSubTreeDuringDrag(nodeDragState.node, subTreeNode)) {
    clearDragSubTreeHover();
    return;
  }

  const targetTree = findBehaviorTreeById(nodes, subTreeNode.attributes?.ID);

  if (!targetTree) {
    clearDragSubTreeHover();
    return;
  }

  navigateToRootDuringDrag(targetTree, true);
}

function expandInlineSubTreeDuringDrag(subTreeNode) {
  const subTreeKey = subTreeNode.subTreeKey ?? getSubTreeExpansionKey(subTreeNode);

  if (
    !nodeDragState?.hasMoved ||
    !subTreeKey ||
    expandedSubTreeKeys.has(subTreeKey) ||
    !canExpandInlineSubTreeDuringDrag(nodeDragState.node, subTreeNode)
  ) {
    clearDragSubTreeHover();
    return;
  }

  const ghost = nodeDragState.group?.cloneNode(true);
  const clientX = nodeDragState.currentClientX;
  const clientY = nodeDragState.currentClientY;

  clearDragSubTreeHover();
  updateSubTreeHintTextsForDrag(false);
  clearNodeDragDropTarget();

  expandedSubTreeKeys.add(subTreeKey);
  renderTree();

  if (ghost && currentViewportGroup) {
    ghost.classList.add("drag-ghost");
    ghost.classList.remove("drop-target");
    ghost.classList.remove("drag-navigation-pending");
    ghost.setAttribute("pointer-events", "none");
    currentViewportGroup.appendChild(ghost);
    nodeDragState.group = ghost;
    nodeDragState.isGhost = true;
  }

  renderDragDropZones(nodeDragState.node);
  positionDraggedNode(clientX, clientY, 0, 0);
  updateNodeDragDropTarget(clientX, clientY);
}

function openParentTreeDuringDrag() {
  if (!nodeDragState?.hasMoved || rootNavigationStack.length === 0) {
    clearDragSubTreeHover();
    return;
  }

  const previousRootPath = rootNavigationStack[rootNavigationStack.length - 1];
  const previousRoot = findNodeByPathInForest(nodes, previousRootPath);

  if (!previousRoot) {
    clearDragSubTreeHover();
    return;
  }

  rootNavigationStack.pop();
  navigateToRootDuringDrag(previousRoot, false);
}

function navigateToRootDuringDrag(targetRoot, pushCurrentRoot) {
  if (!nodeDragState?.hasMoved || !targetRoot?.source?.path) {
    clearDragSubTreeHover();
    return;
  }

  const currentRoot = findNodeByPathInForest(nodes, activeRootPath);
  const ghost = nodeDragState.group?.cloneNode(true);
  const clientX = nodeDragState.currentClientX;
  const clientY = nodeDragState.currentClientY;

  clearDragSubTreeHover();
  clearNodeDragDropTarget();

  if (
    pushCurrentRoot &&
    currentRoot?.source?.path &&
    !pathsEqual(currentRoot.source.path, targetRoot.source.path)
  ) {
    rootNavigationStack.push(currentRoot.source.path);
  }

  activeRootPath = targetRoot.source.path;
  selectedNodeId = undefined;
  selectedNodePath = targetRoot.source.path;

  renderTree();

  if (ghost && currentViewportGroup) {
    ghost.classList.add("drag-ghost");
    ghost.classList.remove("drop-target");
    ghost.setAttribute("pointer-events", "none");
    currentViewportGroup.appendChild(ghost);
    nodeDragState.group = ghost;
    nodeDragState.isGhost = true;
  }

  renderDragDropZones(nodeDragState.node);
  positionDraggedNode(clientX, clientY, 0, 0);
  updateNodeDragDropTarget(clientX, clientY);
}

function findSubTreeNodeAtPoint(point) {
  const matches = [];

  for (const root of currentLayoutRoots) {
    collectSubTreeNodesAtPoint(root, point, matches);
  }

  return matches[matches.length - 1];
}

function findBehaviorTreeNodeAtPoint(point) {
  const matches = [];

  for (const root of currentLayoutRoots) {
    collectBehaviorTreeNodesAtPoint(root, point, matches);
  }

  return matches[matches.length - 1];
}

function collectSubTreeNodesAtPoint(node, point, matches) {
  if (isSubTreeNode(node) && isPointInsideNodeBox(point, node)) {
    matches.push(node);
  }

  for (const child of node.children ?? []) {
    collectSubTreeNodesAtPoint(child, point, matches);
  }
}

function collectBehaviorTreeNodesAtPoint(node, point, matches) {
  if (node.tag === "BehaviorTree" && isPointInsideNodeBox(point, node)) {
    matches.push(node);
  }

  for (const child of node.children ?? []) {
    collectBehaviorTreeNodesAtPoint(child, point, matches);
  }
}

function isPointInsideNodeBox(point, node) {
  return (
    point.x >= node.x - node.width / 2 &&
    point.x <= node.x + node.width / 2 &&
    point.y >= node.y - node.height / 2 &&
    point.y <= node.y + node.height / 2
  );
}

function cleanupNodeDrag(pointerId) {
  if (!nodeDragState) {
    return;
  }

  clearDragSubTreeHover();
  clearNodeDragDropTarget();

  window.removeEventListener("pointermove", handleNodeDragMove, true);
  window.removeEventListener("pointerup", finishNodeDrag, true);
  window.removeEventListener("pointercancel", cancelNodeDrag, true);

  if (nodeDragState.group) {
    nodeDragState.group.classList.remove("drag-valid");
    nodeDragState.group.classList.remove("drag-invalid");
    nodeDragState.group.classList.remove("drag-ghost");
    nodeDragState.group.style.cursor = canMoveNode(nodeDragState.node)
      ? "grab"
      : "pointer";

    if (nodeDragState.isGhost) {
      nodeDragState.group.remove();
    }
  }

  try {
    nodeDragState.captureGroup?.releasePointerCapture(pointerId);
  } catch {
    // Pointer capture may already be released by the webview.
  }

  nodeDragState = undefined;
  clearDragDropZones();
}

function updateNodeDragDropTarget(clientX, clientY) {
  if (!nodeDragState) {
    return;
  }

  const contentPoint = clientPointToContentPoint(clientX, clientY);
  const targetZone = findDropZoneAtPoint(contentPoint);
  const targetPath = targetZone?.parentPath;

  if (pathsEqual(targetPath, nodeDragState.dropTargetPath)) {
    return;
  }

  clearNodeDragDropTarget();

  if (!targetPath) {
    return;
  }

  const targetGroup = nodeGroupsByPath.get(getPathKey(targetPath));

  if (!targetGroup) {
    return;
  }

  targetGroup.classList.add("drop-target");
  targetZone?.element.classList.add("active");
  nodeDragState.group.classList.add("drag-valid");
  nodeDragState.group.classList.remove("drag-invalid");
  nodeDragState.dropTargetPath = targetPath;
  nodeDragState.dropTargetGroup = targetGroup;
  nodeDragState.dropZone = targetZone;
}

function clearNodeDragDropTarget() {
  nodeDragState?.dropZone?.element.classList.remove("active");

  if (!nodeDragState?.dropTargetGroup) {
    if (nodeDragState?.hasMoved) {
      nodeDragState.group.classList.remove("drag-valid");
      nodeDragState.group.classList.add("drag-invalid");
    }
    return;
  }

  nodeDragState.dropTargetGroup.classList.remove("drop-target");
  nodeDragState.dropTargetPath = undefined;
  nodeDragState.dropTargetGroup = undefined;
  nodeDragState.dropZone = undefined;
  nodeDragState.group.classList.remove("drag-valid");
  nodeDragState.group.classList.add("drag-invalid");
}

function clientPointToContentPoint(clientX, clientY) {
  const rect = currentSvg?.getBoundingClientRect();

  if (!rect) {
    return {
      x: 0,
      y: 0
    };
  }

  return {
    x: (clientX - rect.left - viewState.x) / viewState.scale,
    y: (clientY - rect.top - viewState.y) / viewState.scale
  };
}

function renderDragDropZones(sourceNode) {
  clearDragDropZones();

  if (!currentViewportGroup) {
    return;
  }

  const zonesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  zonesGroup.setAttribute("class", "drop-zones");
  currentViewportGroup.insertBefore(zonesGroup, currentViewportGroup.firstChild);

  for (const root of currentLayoutRoots) {
    collectDropZones(root, sourceNode, zonesGroup);
  }
}

function collectDropZones(node, sourceNode, zonesGroup) {
  if (canUseParentDropZone(sourceNode, node)) {
    const zone = createDropZoneForParent(node, sourceNode);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");

    rect.setAttribute("x", String(zone.x));
    rect.setAttribute("y", String(zone.y));
    rect.setAttribute("width", String(zone.width));
    rect.setAttribute("height", String(zone.height));
    rect.setAttribute("class", "drop-zone");

    zonesGroup.appendChild(rect);

    dropZoneElements.push({
      ...zone,
      parentPath: node.source.path,
      parentNode: node,
      element: rect
    });
  }

  for (const child of node.children ?? []) {
    collectDropZones(child, sourceNode, zonesGroup);
  }
}

function clearDragDropZones() {
  for (const zone of dropZoneElements) {
    zone.element.remove();
  }

  dropZoneElements = [];
  document.querySelectorAll(".drop-zones").forEach((element) => element.remove());
}

function findDropZoneAtPoint(point) {
  return dropZoneElements
    .filter((zone) => isPointInsideBox(point, zone))
    .sort((left, right) =>
      (right.parentPath?.length ?? 0) - (left.parentPath?.length ?? 0)
    )[0];
}

function createDropZoneForParent(parentNode, sourceNode) {
  const bounds = getDropZoneContentBounds(parentNode, sourceNode);
  const paddingX = Math.max(28, STYLE.horizontalGap / 2);
  const paddingY = Math.max(28, STYLE.verticalGap / 2);

  return {
    x: bounds.minX - paddingX,
    y: bounds.minY - paddingY,
    width: bounds.maxX - bounds.minX + paddingX * 2,
    height: bounds.maxY - bounds.minY + paddingY * 2
  };
}

function getDropZoneContentBounds(parentNode, sourceNode) {
  const childNodes = (parentNode.children ?? []).filter(
    (child) => !pathsEqual(child.source?.path, sourceNode.source?.path)
  );

  const bounds = {
    minX: parentNode.x - parentNode.width / 2,
    minY: parentNode.y - parentNode.height / 2,
    maxX: parentNode.x + parentNode.width / 2,
    maxY: parentNode.y + parentNode.height / 2
  };

  for (const child of childNodes) {
    bounds.minX = Math.min(bounds.minX, child.x - child.width / 2);
    bounds.minY = Math.min(bounds.minY, child.y - child.height / 2);
    bounds.maxX = Math.max(bounds.maxX, child.x + child.width / 2);
    bounds.maxY = Math.max(bounds.maxY, child.y + child.height / 2);
  }

  if (childNodes.length === 0) {
    const childSlotTop = parentNode.y + parentNode.height / 2 + STYLE.verticalGap;
    const childSlotHeight = 64;
    const childSlotHalfWidth = Math.max(parentNode.width / 2, 96);

    bounds.minX = Math.min(bounds.minX, parentNode.x - childSlotHalfWidth);
    bounds.maxX = Math.max(bounds.maxX, parentNode.x + childSlotHalfWidth);
    bounds.maxY = Math.max(bounds.maxY, childSlotTop + childSlotHeight);
  }

  return bounds;
}

function canUseParentDropZone(sourceNode, parentNode) {
  const sourcePath = sourceNode.source?.path;
  const parentPath = parentNode.source?.path;

  if (!Array.isArray(sourcePath) || !Array.isArray(parentPath)) {
    return false;
  }

  if (isPathPrefix(sourcePath, parentPath)) {
    return false;
  }

  const childLimit = getChildLimitInfo(parentNode);

  if (!childLimit.canAdd && !pathsEqual(sourcePath.slice(0, -1), parentPath)) {
    return false;
  }

  return !containsSubTreeReferenceCycle(sourceNode, parentNode);
}

function isPointInsideBox(point, box) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
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

function getDropInsertionIndex(parentNode, sourceNode, dropPoint) {
  if (!parentNode || !sourceNode || !dropPoint) {
    return undefined;
  }

  const childNodes = (parentNode.children ?? []).filter(
    (child) => !pathsEqual(child.source?.path, sourceNode.source?.path)
  );

  if (childNodes.length === 0) {
    return 0;
  }

  const orderedChildren = [...childNodes].sort((left, right) => left.x - right.x);

  for (let index = 0; index < orderedChildren.length; index += 1) {
    if (dropPoint.x < orderedChildren[index].x) {
      return index;
    }
  }

  return orderedChildren.length;
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

  const defaultText = getSubTreeHintText(node, false);
  const dragText = getSubTreeHintText(node, true);

  hint.dataset.defaultText = defaultText;
  hint.dataset.dragText = dragText;
  hint.textContent = nodeDragState?.hasMoved ? dragText : defaultText;

  group.appendChild(hint);
}

function getSubTreeHintText(node, dragging) {
  if (
    openOnlyOneBehaviorTree &&
    node.attributes?.ID &&
    findBehaviorTreeById(nodes, node.attributes.ID)
  ) {
    return dragging ? "hover to enter" : "double-click to enter";
  }

  if (node.inlineExpanded) {
    return "double-click to close";
  }

  if (node.inlineCycle) {
    return "cycle blocked";
  }

  if (node.attributes?.ID && findBehaviorTreeById(nodes, node.attributes.ID)) {
    return dragging ? "hover to open" : "double-click to expand";
  }

  return "subtree target missing";
}

function updateSubTreeHintTextsForDrag(dragging) {
  document.querySelectorAll(".bt-text-hint").forEach((hint) => {
    hint.textContent = dragging
      ? hint.dataset.dragText ?? hint.textContent
      : hint.dataset.defaultText ?? hint.textContent;
  });
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
              ${escapeHtml(formatSourceLocation(source))}
            </p>
            <pre class="xml-preview">${escapeHtml(source.startTag)}</pre>
            <button
              id="reveal-node-button"
              title="Move keyboard focus and cursor to this XML line"
            >
              Send cursor to XML line
            </button>
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
    ${renderChangeTypeSection(node)}
    ${renderCopyPasteSection(node, childLimit)}
    ${renderDeleteSection(node)}
    ${renderAddBehaviorTreeSection(node)}
    ${renderAddChildSection(node, childLimit)}
  `;

  const revealButton = document.getElementById("reveal-node-button");

  if (revealButton && source) {
    revealButton.addEventListener("click", () => {
      vscode.postMessage({
        type: "revealNode",
        path: node.source?.path,
        startOffset: source.startOffset
      });
    });
  }

  attachAttributeHandlers(node);
  attachChangeTypeHandlers(node);
  attachCopyPasteHandlers(node);
  attachDeleteHandlers(node);
  attachAddBehaviorTreeHandlers(node);
  attachAddChildHandlers(node);
}

function formatSourceLocation(source) {
  const startLine = source.line + 1;
  const column = source.column + 1;
  const lineSpan = (source.startTag.match(/\n/g) ?? []).length;

  if (lineSpan === 0) {
    return `Line ${startLine}, column ${column}`;
  }

  return `Lines ${startLine}-${startLine + lineSpan}, column ${column}`;
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

function renderChangeTypeSection(node) {
  if (!canChangeNodeType(node)) {
    return `
      <h3>Change type</h3>
      <div class="info-box">
        ${escapeHtml(getChangeTypeUnavailableReason(node))}
      </div>
    `;
  }

  const definitions = getCompatibleTypeDefinitions(node);

  if (definitions.length === 0) {
    return `
      <h3>Change type</h3>
      <div class="info-box">
        No compatible alternative node types are available.
      </div>
    `;
  }

  return `
    <h3>Change type</h3>
    <div class="info-box">
      Change this ${escapeHtml(getDisplayCategory(node))} to another compatible type. Position and children are preserved.
    </div>
    <label for="change-node-type-select" class="field-label"><strong>Compatible node type</strong></label>
    <select id="change-node-type-select" class="attr-input change-type-select" size="8">
      ${definitions
        .map((definition) => `
          <option value="${escapeHtml(definition.id)}">
            ${escapeHtml(definition.id)}
          </option>
        `)
        .join("")}
    </select>
    <div id="change-node-type-preview"></div>
    <button id="change-node-type-button" class="attr-apply-button">
      Change node type
    </button>
  `;
}

function canChangeNodeType(node) {
  if (!Array.isArray(node.source?.path) || node.source.startOffset < 0) {
    return false;
  }

  if (node.tag === "BehaviorTree") {
    return false;
  }

  const childCount = node.children?.length ?? 0;

  if ((node.kind === "action" || node.kind === "condition") && childCount > 0) {
    return false;
  }

  if (node.kind === "decorator" && childCount > 1) {
    return false;
  }

  if (isSubTreeNode(node)) {
    return false;
  }

  return true;
}

function getChangeTypeUnavailableReason(node) {
  if (!Array.isArray(node.source?.path) || node.source.startOffset < 0) {
    return "Node type can be changed after the node has been parsed from XML.";
  }

  if (node.tag === "BehaviorTree") {
    return "BehaviorTree root nodes cannot be changed to another type.";
  }

  const childCount = node.children?.length ?? 0;

  if ((node.kind === "action" || node.kind === "condition") && childCount > 0) {
    return "Leaf nodes with children cannot be changed to another leaf type.";
  }

  if (node.kind === "decorator" && childCount > 1) {
    return "Decorator nodes with more than one child cannot be changed to another decorator.";
  }

  if (isSubTreeNode(node)) {
    return "SubTree nodes cannot be changed with this control.";
  }

  return "This node type cannot be changed.";
}

function getCompatibleTypeDefinitions(node) {
  const category = getChangeTypeCategory(node);

  if (!category) {
    return [];
  }

  return getDefinitionsByKind(category)
    .filter((definition) => definition.id !== node.tag);
}

function getChangeTypeCategory(node) {
  if (
    node.kind === "control" ||
    node.kind === "decorator" ||
    node.kind === "condition" ||
    node.kind === "action"
  ) {
    return node.kind;
  }

  return undefined;
}

function getAllowedAttributesForDefinition(definition) {
  return (definition?.ports ?? []).map((port) => port.name);
}

function renderCopyPasteSection(node, childLimit) {
  const canCopy = canCopyNode(node);
  const canPaste = canPasteClipboardInto(node, childLimit);
  const copiedLabel = copiedNode
    ? `${clipboardMode === "cut" ? "Cut" : "Copied"} ${copiedNode.tag}${copiedNode.name ? `: ${copiedNode.name}` : ""}`
    : "No node copied.";
  const pasteHint = copiedNode
    ? canPaste
      ? `Paste ${clipboardMode === "cut" ? "cut" : "copied"} ${copiedNode.tag} as the last child of this node.`
      : getPasteUnavailableReason(node, childLimit)
    : "Copy or cut a node first, then select a parent that can accept another child.";

  return `
    <h3>Copy / cut / paste</h3>
    <div class="info-box">
      Copied: ${escapeHtml(copiedLabel)}
    </div>
    ${
      clipboardWarning
        ? `
          <div class="warning-box">
            ${escapeHtml(clipboardWarning)}
          </div>
        `
        : ""
    }
    ${
      canCopy
        ? `
          <button id="copy-node-button" class="attr-apply-button">
            Copy selected node
          </button>
          <button id="cut-node-button" class="attr-apply-button">
            Cut selected node
          </button>
        `
        : `
          <div class="info-box">
            ${escapeHtml(getCopyUnavailableReason(node))}
          </div>
        `
    }
    <button
      id="paste-node-button"
      class="attr-apply-button"
      title="${escapeHtml(pasteHint)}"
    >
      Paste as child
    </button>
  `;
}

function canPasteClipboardInto(node, childLimit) {
  if (!copiedNode || !childLimit.canAdd) {
    return false;
  }

  if (
    clipboardMode === "cut" &&
    isPathPrefix(copiedNode.source?.path, node.source?.path)
  ) {
    return false;
  }

  if (containsCutSubTreeReferenceToTargetBehaviorTree(copiedNode, node)) {
    return false;
  }

  return true;
}

function getPasteUnavailableReason(node, childLimit) {
  if (!copiedNode) {
    return "Copy or cut a node first, then select a parent that can accept another child.";
  }

  if (!childLimit.canAdd) {
    return childLimit.reason;
  }

  if (
    !Array.isArray(copiedNode.source?.path) ||
    !Array.isArray(node.source?.path)
  ) {
    return "Paste is not available until both nodes have been reparsed from XML.";
  }

  if (
    clipboardMode === "cut" &&
    isPathPrefix(copiedNode?.source?.path, node.source?.path)
  ) {
    return "A cut node cannot be pasted into itself or one of its children.";
  }

  if (containsCutSubTreeReferenceToTargetBehaviorTree(copiedNode, node)) {
    return "This paste would create a recursive SubTree reference.";
  }

  return "Paste is not available for this node.";
}

function showClipboardWarning(node, reason) {
  clipboardWarning = reason;
  renderDetails(node);
}

function containsCutSubTreeReferenceToTargetBehaviorTree(
  sourceNode,
  targetParentNode
) {
  if (
    clipboardMode !== "cut" ||
    !sourceNode ||
    !targetParentNode
  ) {
    return false;
  }

  return containsSubTreeReferenceCycle(sourceNode, targetParentNode);
}

function containsSubTreeReferenceCycle(sourceNode, targetParentNode) {
  if (!sourceNode || !targetParentNode) {
    return false;
  }

  const targetRoot = findRootContainingPath(
    nodes,
    targetParentNode.source?.path
  );
  const targetTreeId =
    targetRoot?.tag === "BehaviorTree"
      ? targetRoot.attributes?.ID?.trim()
      : undefined;

  if (!targetTreeId) {
    return false;
  }

  return collectReachableSubTreeReferences(sourceNode).has(targetTreeId);
}

function collectReachableSubTreeReferences(node) {
  const reachableIds = new Set();
  const idsToVisit = collectDirectSubTreeReferences(node);

  for (const id of idsToVisit) {
    collectReachableSubTreeReferenceRecursive(id, reachableIds);
  }

  return reachableIds;
}

function collectReachableSubTreeReferenceRecursive(behaviorTreeId, reachableIds) {
  if (reachableIds.has(behaviorTreeId)) {
    return;
  }

  reachableIds.add(behaviorTreeId);

  const behaviorTree = findBehaviorTreeById(nodes, behaviorTreeId);

  if (!behaviorTree) {
    return;
  }

  for (const id of collectDirectSubTreeReferences(behaviorTree)) {
    collectReachableSubTreeReferenceRecursive(id, reachableIds);
  }
}

function collectDirectSubTreeReferences(node) {
  const references = new Set();

  collectDirectSubTreeReferencesRecursive(node, references);

  return references;
}

function collectDirectSubTreeReferencesRecursive(node, references) {
  if (
    isSubTreeNode(node) &&
    node.attributes?.ID?.trim()
  ) {
    references.add(node.attributes.ID.trim());
  }

  for (const child of node.children ?? []) {
    collectDirectSubTreeReferencesRecursive(child, references);
  }
}

function renderDeleteSection(node) {
  const targetId = isSubTreeNode(node) ? node.attributes?.ID : undefined;
  const targetExists = targetId ? Boolean(findBehaviorTreeById(nodes, targetId)) : false;

  if (isSubTreeNode(node)) {
    return `
      <h3>Delete</h3>
      <div class="info-box">
        This removes the SubTree reference. Referenced BehaviorTrees will be removed only when no remaining SubTree call uses them.
      </div>
      <button id="delete-node-and-referenced-tree-button" class="attr-apply-button">
        ${
          targetExists
            ? "Delete SubTree and unused referenced BehaviorTrees"
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
      This will create an empty top-level BehaviorTree with ID "${escapeHtml(targetId)}". Open it and add the first child node inside it.
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

function attachChangeTypeHandlers(node) {
  const select = document.getElementById("change-node-type-select");
  const button = document.getElementById("change-node-type-button");
  const preview = document.getElementById("change-node-type-preview");

  if (!select || !button || !preview) {
    return;
  }

  if (!findDefinitionById(select.value) && select.options.length > 0) {
    select.value = select.options[0].value;
  }

  const updatePreview = () => {
    const definition = findDefinitionById(select.value);

    if (!definition) {
      preview.innerHTML = `
        <div class="warning-box">
          Selected node type is no longer available.
        </div>
      `;
      button.disabled = true;
      return;
    }

    const allowedAttributes = new Set(getAllowedAttributesForDefinition(definition));
    const attributeEntries = Object.entries(node.attributes ?? {});
    const keptAttributes = attributeEntries
      .filter(([name]) => allowedAttributes.has(name))
      .map(([name]) => name);
    const droppedAttributes = attributeEntries
      .filter(([name]) => !allowedAttributes.has(name))
      .map(([name]) => name);

    preview.innerHTML = `
      <div class="info-box">
        Keeps ${escapeHtml(formatAttributeList(keptAttributes))}. Drops ${escapeHtml(formatAttributeList(droppedAttributes))}.
      </div>
    `;
    button.disabled = false;
  };

  select.addEventListener("change", updatePreview);
  button.addEventListener("click", () => {
    const definition = findDefinitionById(select.value);

    if (!definition) {
      return;
    }

    vscode.postMessage({
      type: "changeNodeType",
      path: node.source.path,
      tagName: definition.id,
      allowedAttributes: getAllowedAttributesForDefinition(definition)
    });
  });

  updatePreview();
}

function formatAttributeList(attributeNames) {
  return attributeNames.length > 0
    ? attributeNames.join(", ")
    : "none";
}

function attachCopyPasteHandlers(node) {
  const copyButton = document.getElementById("copy-node-button");
  const cutButton = document.getElementById("cut-node-button");
  const pasteButton = document.getElementById("paste-node-button");

  if (copyButton) {
    copyButton.addEventListener("click", () => {
      copySelectedNode(node);
    });
  }

  if (cutButton) {
    cutButton.addEventListener("click", () => {
      cutSelectedNode(node);
    });
  }

  if (pasteButton) {
    pasteButton.addEventListener("click", () => {
      pasteCopiedNodeInto(node);
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

function copySelectedNode(node) {
  if (!canCopyNode(node)) {
    showClipboardWarning(node, getCopyUnavailableReason(node));
    return false;
  }

  const sourceNode = findNodeByPathInForest(nodes, node.source?.path) ?? node;

  copiedNode = cloneNodeForClipboard(sourceNode);
  clipboardMode = "copy";
  clipboardWarning = undefined;
  renderDetails(node);
  return true;
}

function cutSelectedNode(node) {
  if (!canCopyNode(node)) {
    showClipboardWarning(node, getCopyUnavailableReason(node));
    return false;
  }

  const sourceNode = findNodeByPathInForest(nodes, node.source?.path) ?? node;

  copiedNode = cloneNodeForClipboard(sourceNode);
  clipboardMode = "cut";
  clipboardWarning = undefined;
  renderDetails(node);
  return true;
}

function pasteCopiedNodeInto(parentNode) {
  const childLimit = getChildLimitInfo(parentNode);

  if (!copiedNode) {
    showClipboardWarning(
      parentNode,
      getPasteUnavailableReason(parentNode, childLimit)
    );
    return false;
  }

  const sourcePath = copiedNode.source?.path;
  const parentPath = parentNode.source?.path;

  if (!Array.isArray(sourcePath) || !Array.isArray(parentPath)) {
    showClipboardWarning(
      parentNode,
      getPasteUnavailableReason(parentNode, childLimit)
    );
    return false;
  }

  if (!childLimit.canAdd) {
    showClipboardWarning(
      parentNode,
      getPasteUnavailableReason(parentNode, childLimit)
    );
    return false;
  }

  if (
    clipboardMode === "cut" &&
    isPathPrefix(sourcePath, parentPath)
  ) {
    showClipboardWarning(
      parentNode,
      getPasteUnavailableReason(parentNode, childLimit)
    );
    return false;
  }

  if (containsCutSubTreeReferenceToTargetBehaviorTree(copiedNode, parentNode)) {
    showClipboardWarning(
      parentNode,
      getPasteUnavailableReason(parentNode, childLimit)
    );
    return false;
  }

  if (clipboardMode === "cut") {
    vscode.postMessage({
      type: "pasteNode",
      sourcePath,
      parentPath,
      move: true
    });

    copiedNode = undefined;
    clipboardMode = "copy";
    clipboardWarning = undefined;
    renderDetails(parentNode);
    return true;
  }

  const newChild = applyLocalCopiedNodePaste(parentNode, copiedNode);

  if (!newChild) {
    showClipboardWarning(parentNode, "Paste could not be applied.");
    return false;
  }

  vscode.postMessage({
    type: "pasteNode",
    sourcePath,
    parentPath,
    move: false
  });

  selectedNodePath = newChild.source.path;
  selectedNodeId = newChild.id;
  clipboardWarning = undefined;

  renderDetails(newChild);
  renderTree();
  return true;
}

function canCopyNode(node) {
  return (
    node?.tag !== "BehaviorTree" &&
    Array.isArray(node?.source?.path) &&
    node.source.startOffset >= 0
  );
}

function getCopyUnavailableReason(node) {
  if (node?.tag === "BehaviorTree") {
    return "BehaviorTree root nodes are not copied as child nodes. Select the tree root child instead.";
  }

  return "This node has not been reparsed yet. Wait for the XML refresh before copying it.";
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

    const currentRoot = findNodeByPathInForest(nodes, activeRootPath);

    if (currentRoot?.source?.path) {
      rootNavigationStack.push(currentRoot.source.path);
    }

    applyLocalImportedBehaviorTreeChainInsert(node, behaviorTreeId, true);

    vscode.postMessage({
      type: "addBehaviorTree",
      referencePath: node.source.path,
      behaviorTreeId
    });

    handleTreeStructureChange();
    renderTree();

    requestAnimationFrame(() => {
      applyPostTreeChangeView();
    });
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
        ${renderSubtreeInsertPreview()}
        <div class="info-box">
          Known ${escapeHtml(getDefinitionDisplayCategory(definition))} node with no defined attributes.
        </div>
      `;
      applySelectedSubtreeTemplateToIdInput();
      return;
    }

    definitionPreview.innerHTML = `
      ${renderSubtreeInsertPreview()}
      <h3>New child attributes</h3>
      <table class="attr-table">
        ${definition.ports.map((port) => renderChildPortRow(port)).join("")}
      </table>
    `;

    applySelectedSubtreeTemplateToIdInput();
  }

  function renderSubtreeInsertPreview() {
    if (kindSelect.value !== "subtree" || !isSubTreeTagName(getSelectedTagName())) {
      return "";
    }

    const behaviorTree = getSelectedImportedBehaviorTree();
    const selectedTemplateText = behaviorTree
      ? `Imported BehaviorTree "${escapeHtml(behaviorTree.id)}" selected. `
      : "";
    const insertModeText = includeFullBehaviorTree
      ? "The referenced BehaviorTree XML will be inserted if it is not already in this XML."
      : "Only the SubTree reference will be inserted. No BehaviorTree block will be created.";

    return `
      <div class="info-box">
        ${selectedTemplateText}${insertModeText}
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

function applyLocalCopiedNodePaste(parentNode, templateNode) {
  const matchingParents = findAllNodesByPath(nodes, parentNode.source?.path);
  let newChild = undefined;

  for (const matchingParent of matchingParents) {
    const childPath = [
      ...matchingParent.source.path,
      matchingParent.children.length
    ];
    const childNode = cloneCopiedNodeForPaste(templateNode, childPath);

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

    newChild = cloneCopiedNodeForPaste(templateNode, childPath);
    parentNode.children.push(newChild);
  }

  refreshRootPaths();
  return newChild;
}

function applyLocalNodeDelete(pathToDelete, deleteReferencedBehaviorTree, nodeToDelete) {
  const referencedIds =
    deleteReferencedBehaviorTree && isSubTreeNode(nodeToDelete)
      ? collectReferencedBehaviorTreeIdsForDelete(nodes, nodeToDelete)
      : [];

  removeNodeByPath(nodes, pathToDelete);

  for (const referencedId of referencedIds) {
    if (hasSubTreeReferenceToBehaviorTree(nodes, referencedId)) {
      continue;
    }

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

function hasSubTreeReferenceToBehaviorTree(roots, behaviorTreeId) {
  for (const root of roots) {
    if (hasSubTreeReferenceToBehaviorTreeRecursive(root, behaviorTreeId)) {
      return true;
    }
  }

  return false;
}

function hasSubTreeReferenceToBehaviorTreeRecursive(node, behaviorTreeId) {
  if (isSubTreeNode(node) && node.attributes?.ID === behaviorTreeId) {
    return true;
  }

  for (const child of node.children ?? []) {
    if (hasSubTreeReferenceToBehaviorTreeRecursive(child, behaviorTreeId)) {
      return true;
    }
  }

  return false;
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
  const insertIndex = getBehaviorTreeWrapperPrefix()
    ? nodes.length
    : rootIndex >= 0 ? rootIndex + 1 : nodes.length;

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

function cloneNodeForClipboard(node) {
  return cloneNodeForClipboardRecursive(node);
}

function cloneNodeForClipboardRecursive(node) {
  return {
    id: node.id,
    tag: node.tag,
    kind: node.kind,
    name: node.name,
    attributes: {
      ...(node.attributes ?? {})
    },
    children: isSubTreeNode(node)
      ? []
      : (node.children ?? []).map(cloneNodeForClipboardRecursive),
    source: {
      ...(node.source ?? {}),
      path: [...(node.source?.path ?? [])]
    },
    definitionKnown: node.definitionKnown,
    definition: node.definition
  };
}

function cloneCopiedNodeForPaste(templateNode, path) {
  localNodeCounter += 1;

  const attributes = {
    ...(templateNode.attributes ?? {})
  };

  if (attributes.name) {
    attributes.name = `${attributes.name}_copy`;
  }

  const clonedNode = {
    id: `local-node-${localNodeCounter}`,
    tag: templateNode.tag,
    kind: templateNode.kind,
    name: attributes.name ?? attributes.ID,
    attributes,
    children: [],
    source: {
      path,
      startOffset: -1,
      endOpenTagOffset: -1,
      line: -1,
      column: -1,
      startTag: buildStartTagForCopiedNode(templateNode, attributes)
    },
    definitionKnown: templateNode.definitionKnown,
    definition: templateNode.definition
  };

  clonedNode.children = (templateNode.children ?? []).map((child, index) =>
    cloneCopiedChildNodeForPaste(child, [...path, index])
  );

  return clonedNode;
}

function cloneCopiedChildNodeForPaste(templateNode, path) {
  localNodeCounter += 1;

  const attributes = {
    ...(templateNode.attributes ?? {})
  };

  const clonedNode = {
    id: `local-node-${localNodeCounter}`,
    tag: templateNode.tag,
    kind: templateNode.kind,
    name: attributes.name ?? attributes.ID,
    attributes,
    children: [],
    source: {
      path,
      startOffset: -1,
      endOpenTagOffset: -1,
      line: -1,
      column: -1,
      startTag: buildStartTagForCopiedNode(templateNode, attributes)
    },
    definitionKnown: templateNode.definitionKnown,
    definition: templateNode.definition
  };

  clonedNode.children = (templateNode.children ?? []).map((child, index) =>
    cloneCopiedChildNodeForPaste(child, [...path, index])
  );

  return clonedNode;
}

function buildStartTagForCopiedNode(templateNode, attributes) {
  const startTag = templateNode.source?.startTag;

  if (!startTag) {
    return buildSelfClosingStartTag(templateNode.tag, attributes);
  }

  let updatedStartTag = startTag;

  for (const [name, value] of Object.entries(attributes)) {
    updatedStartTag = setAttributeInOpenTag(updatedStartTag, name, value);
  }

  return updatedStartTag;
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

function getPathKey(path) {
  return Array.isArray(path) ? path.join("/") : undefined;
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

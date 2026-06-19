import { BUILTIN_NODE_DEFINITIONS } from "./builtin_node_definitions";

export type BtNodeKind = "control" | "decorator" | "condition" | "action";

export type TreeNodePortDirection = "input" | "output" | "inout";

export type TreeNodePort = {
  name: string;
  direction: TreeNodePortDirection;
};

export type TreeNodeDefinitionSource = "builtin" | "imported" | "xml";

export type TreeNodeDefinition = {
  id: string;
  kind: BtNodeKind;
  ports: TreeNodePort[];
  source: TreeNodeDefinitionSource;
};

export type TreeNodeDefinitionMap = Record<string, TreeNodeDefinition>;

export type BehaviorTreeTemplate = {
  id: string;
  xmlText: string;
  source: string;
};

export type BehaviorTreeTemplateMap = Record<string, BehaviorTreeTemplate>;

export type BtNodeSource = {
  path: number[];
  startOffset: number;
  endOpenTagOffset: number;
  line: number;
  column: number;
  startTag: string;
};

export type BtNode = {
  id: string;
  tag: string;
  kind: BtNodeKind;
  name?: string;
  attributes: Record<string, string>;
  children: BtNode[];
  source: BtNodeSource;
  definitionKnown: boolean;
  definition?: TreeNodeDefinition;
};

export type InsertXmlChildNodeResult = {
  xmlText: string;
  childPath: number[];
};

export type InsertBehaviorTreeResult = {
  xmlText: string;
  behaviorTreePath: number[];
};

export type DeleteXmlNodeResult = {
  xmlText: string;
  deletedPath: number[];
};

export type MoveXmlNodeResult = {
  xmlText: string;
  movedPath: number[];
};

type InternalXmlNode = Omit<
  BtNode,
  "kind" | "children" | "definitionKnown" | "definition"
> & {
  kind?: BtNodeKind;
  parent?: InternalXmlNode;
  children: InternalXmlNode[];
  closeTag?: {
    startOffset: number;
    endOffset: number;
  };
};

type TreeNodeModelCatalog = Map<string, TreeNodeDefinition>;

let nextId = 0;

function inputPorts(...names: string[]): TreeNodePort[] {
  return names.map((name) => {
    return {
      name,
      direction: "input"
    };
  });
}

function withCommonPorts(
  nodeId: string,
  ports: TreeNodePort[]
): TreeNodePort[] {
  if (nodeId === "BehaviorTree") {
    return ensurePorts(ports, inputPorts("ID"));
  }

  if (nodeId === "SubTree" || nodeId === "SubTreePlus") {
    return ensurePorts(ports, inputPorts("ID", "_autoremap"));
  }

  return ensurePorts(ports, inputPorts("name"));
}

function ensurePorts(
  ports: TreeNodePort[],
  requiredPorts: TreeNodePort[]
): TreeNodePort[] {
  const existingNames = new Set(ports.map((port) => port.name));
  const missingPorts = requiredPorts.filter(
    (port) => !existingNames.has(port.name)
  );

  return [
    ...missingPorts,
    ...ports
  ];
}

function makeId(): string {
  nextId += 1;
  return `bt-node-${nextId}`;
}

export function parseBehaviorTreeXml(
  xmlText: string,
  externalDefinitions: TreeNodeDefinitionMap = {}
): BtNode[] {
  nextId = 0;

  const roots = scanXml(xmlText);
  const modelCatalog = buildTreeNodesModelCatalog(roots, externalDefinitions);

  const behaviorTrees: InternalXmlNode[] = [];

  for (const root of roots) {
    collectBehaviorTrees(root, behaviorTrees);
  }

  const outputRoots = behaviorTrees.length > 0 ? behaviorTrees : roots;

  if (behaviorTrees.length > 0) {
    validateBehaviorTreeXmlNodes(outputRoots, modelCatalog);
  }

  return outputRoots.map((node) => stripInternalFields(node, modelCatalog));
}

export function getTreeNodeDefinitionCatalog(
  xmlText: string,
  externalDefinitions: TreeNodeDefinitionMap = {}
): TreeNodeDefinition[] {
  const roots = scanXml(xmlText);
  const modelCatalog = buildTreeNodesModelCatalog(roots, externalDefinitions);

  return Array.from(modelCatalog.values()).sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}

export function parseTreeNodeDefinitionsFromXml(
  xmlText: string,
  source: TreeNodeDefinitionSource = "xml"
): TreeNodeDefinitionMap {
  const roots = scanXml(xmlText);
  const catalog = new Map<string, TreeNodeDefinition>();

  for (const root of roots) {
    collectTreeNodesModelEntries(root, catalog, source);
  }

  return Object.fromEntries(catalog.entries());
}

export function parseBehaviorTreeTemplatesFromXml(
  xmlText: string,
  source: string
): BehaviorTreeTemplateMap {
  const roots = scanXml(xmlText);
  const behaviorTrees: InternalXmlNode[] = [];
  const templates = new Map<string, BehaviorTreeTemplate>();

  for (const root of roots) {
    collectBehaviorTrees(root, behaviorTrees);
  }

  for (const behaviorTree of behaviorTrees) {
    const id = behaviorTree.attributes["ID"]?.trim();

    if (!id || !behaviorTree.closeTag) {
      continue;
    }

    templates.set(id, {
      id,
      source,
      xmlText: xmlText.slice(
        behaviorTree.source.startOffset,
        behaviorTree.closeTag.endOffset
      )
    });
  }

  return Object.fromEntries(templates.entries());
}

export function updateXmlAttributeByPath(
  xmlText: string,
  path: number[],
  attributeName: string,
  attributeValue: string | undefined
): string {
  const roots = scanXml(xmlText);
  const target = findNodeByPath(roots, path);

  if (!target) {
    throw new Error(`Could not find XML node at path [${path.join(", ")}].`);
  }

  const start = target.source.startOffset;
  const end = target.source.endOpenTagOffset;
  const openTag = xmlText.slice(start, end);

  const updatedOpenTag =
    attributeValue === undefined
      ? removeAttributeFromOpenTag(openTag, attributeName)
      : setAttributeInOpenTag(openTag, attributeName, attributeValue);

  return removeBlankXmlLines(
    xmlText.slice(0, start) + updatedOpenTag + xmlText.slice(end)
  );
}

export function insertXmlChildNodeByPath(
  xmlText: string,
  parentPath: number[],
  childTagName: string,
  attributes: Record<string, string>
): InsertXmlChildNodeResult {
  validateXmlName(childTagName, "node tag");

  for (const attributeName of Object.keys(attributes)) {
    validateXmlName(attributeName, "attribute name");
  }

  const roots = scanXml(xmlText);
  const parent = findNodeByPath(roots, parentPath);

  if (!parent) {
    throw new Error(
      `Could not find XML parent node at path [${parentPath.join(", ")}].`
    );
  }

  const childPath = [...parent.source.path, parent.children.length];
  const parentIndent = getLineIndentAtOffset(xmlText, parent.source.startOffset);
  const childIndent = `${parentIndent}  `;
  const childXml = buildSelfClosingTag(childTagName, attributes);

  const parentOpenTag = xmlText.slice(
    parent.source.startOffset,
    parent.source.endOpenTagOffset
  );

  if (isSelfClosingOpenTag(parentOpenTag)) {
    const expandedParentOpenTag = parentOpenTag.replace(/\/\s*>$/, ">");
    const replacement = [
      expandedParentOpenTag,
      `\n${childIndent}${childXml}`,
      `\n${parentIndent}</${parent.tag}>`
    ].join("");

    return {
      xmlText: removeBlankXmlLines(
        xmlText.slice(0, parent.source.startOffset) +
        replacement +
        xmlText.slice(parent.source.endOpenTagOffset)
      ),
      childPath
    };
  }

  if (!parent.closeTag) {
    throw new Error(`Could not find closing tag for <${parent.tag}>.`);
  }

  const insertion = `\n${childIndent}${childXml}\n${parentIndent}`;

  return {
    xmlText: removeBlankXmlLines(
      xmlText.slice(0, parent.closeTag.startOffset) +
      insertion +
      xmlText.slice(parent.closeTag.startOffset)
    ),
    childPath
  };
}

export function insertBehaviorTreeAfterPath(
  xmlText: string,
  referencePath: number[],
  behaviorTreeId: string
): InsertBehaviorTreeResult {
  validateXmlName(behaviorTreeId, "BehaviorTree ID");

  const behaviorTreeXml = [
    `<BehaviorTree ID="${encodeXmlAttribute(behaviorTreeId, '"')}">`,
    "</BehaviorTree>"
  ].join("\n");

  return insertBehaviorTreeXmlAfterPath(
    xmlText,
    referencePath,
    behaviorTreeXml
  );
}

export function insertBehaviorTreeXmlAfterPath(
  xmlText: string,
  referencePath: number[],
  behaviorTreeXml: string
): InsertBehaviorTreeResult {
  const template = parseSingleBehaviorTreeTemplate(behaviorTreeXml);
  validateXmlName(template.id, "BehaviorTree ID");

  const roots = scanXml(xmlText);
  const reference = findNodeByPath(roots, referencePath);

  if (!reference) {
    throw new Error(
      `Could not find reference XML node at path [${referencePath.join(", ")}].`
    );
  }

  if (findBehaviorTreeById(roots, template.id)) {
    throw new Error(`BehaviorTree with ID "${template.id}" already exists.`);
  }

  const referenceTree = findNearestBehaviorTree(reference) ?? reference;
  const documentRoot = getTopRootNode(referenceTree);

  const treeIndent = getLineIndentAtOffset(
    xmlText,
    referenceTree.source.startOffset
  );

  if (documentRoot && documentRoot !== referenceTree && documentRoot.closeTag) {
    const insertBeforeOffset = documentRoot.closeTag.startOffset;
    const insertion = `${formatBehaviorTreeXmlForInsert(
      template.xmlText,
      treeIndent
    )}\n`;

    const needsLeadingNewline =
      insertBeforeOffset > 0 && xmlText[insertBeforeOffset - 1] !== "\n";

    const finalInsertion = `${needsLeadingNewline ? "\n" : ""}${insertion}`;

    const behaviorTreePath = [
      ...documentRoot.source.path,
      documentRoot.children.length
    ];

    return {
      xmlText: removeBlankXmlLines(
        xmlText.slice(0, insertBeforeOffset) +
        finalInsertion +
        xmlText.slice(insertBeforeOffset)
      ),
      behaviorTreePath
    };
  }

  const insertAfterOffset =
    referenceTree.closeTag?.endOffset ?? referenceTree.source.endOpenTagOffset;

  const insertion = `\n${formatBehaviorTreeXmlForInsert(
    template.xmlText,
    treeIndent
  )}`;

  const behaviorTreePath = getInsertedRootSiblingPath(roots, referenceTree);

  return {
    xmlText: removeBlankXmlLines(
      xmlText.slice(0, insertAfterOffset) +
      insertion +
      xmlText.slice(insertAfterOffset)
    ),
    behaviorTreePath
  };
}

export function deleteXmlNodeByPath(
  xmlText: string,
  path: number[]
): DeleteXmlNodeResult {
  const roots = scanXml(xmlText);
  const target = findNodeByPath(roots, path);

  if (!target) {
    throw new Error(`Could not find XML node at path [${path.join(", ")}].`);
  }

  const range = getNodeDeletionRange(xmlText, target);

  return {
    xmlText: removeBlankXmlLines(
      xmlText.slice(0, range.start) + xmlText.slice(range.end)
    ),
    deletedPath: target.source.path
  };
}

export function deleteBehaviorTreeById(
  xmlText: string,
  behaviorTreeId: string
): DeleteXmlNodeResult {
  const roots = scanXml(xmlText);
  const target = findBehaviorTreeById(roots, behaviorTreeId);

  if (!target) {
    throw new Error(`Could not find BehaviorTree with ID "${behaviorTreeId}".`);
  }

  const range = getNodeDeletionRange(xmlText, target);

  return {
    xmlText: removeBlankXmlLines(
      xmlText.slice(0, range.start) + xmlText.slice(range.end)
    ),
    deletedPath: target.source.path
  };
}

export function moveXmlNodeByPath(
  xmlText: string,
  path: number[],
  targetIndex: number
): MoveXmlNodeResult {
  if (path.length < 2) {
    throw new Error("Root XML nodes cannot be reordered from the editor.");
  }

  const roots = scanXml(xmlText);
  const target = findNodeByPath(roots, path);

  if (!target) {
    throw new Error(`Could not find XML node at path [${path.join(", ")}].`);
  }

  const parent = target.parent;

  if (!parent) {
    throw new Error("Root XML nodes cannot be reordered from the editor.");
  }

  const sourceIndex = parent.children.indexOf(target);

  if (sourceIndex < 0) {
    throw new Error(`Could not find XML node at path [${path.join(", ")}].`);
  }

  const clampedTargetIndex = clampIndex(targetIndex, 0, parent.children.length - 1);

  if (clampedTargetIndex === sourceIndex) {
    return {
      xmlText,
      movedPath: target.source.path
    };
  }

  const remainingSiblings = parent.children.filter((child) => child !== target);
  const insertionIndex = clampIndex(
    clampedTargetIndex,
    0,
    remainingSiblings.length
  );
  const targetRange = getNodeDeletionRange(xmlText, target);
  const movingXml = xmlText.slice(targetRange.start, targetRange.end);
  const isAppendingBeforeParentCloseTag =
    insertionIndex >= remainingSiblings.length;
  const normalizedMovingXml = isAppendingBeforeParentCloseTag
    ? ensureTrailingLineEnding(movingXml, xmlText)
    : movingXml;
  const insertionOffsetBeforeRemoval =
    !isAppendingBeforeParentCloseTag
      ? getNodeDeletionRange(xmlText, remainingSiblings[insertionIndex]).start
      : parent.closeTag
        ? getLineStartAtOffset(xmlText, parent.closeTag.startOffset)
        : parent.source.endOpenTagOffset;
  const xmlWithoutTarget =
    xmlText.slice(0, targetRange.start) + xmlText.slice(targetRange.end);
  const removedLength = targetRange.end - targetRange.start;
  const insertionOffset =
    insertionOffsetBeforeRemoval > targetRange.start
      ? insertionOffsetBeforeRemoval - removedLength
      : insertionOffsetBeforeRemoval;

  return {
    xmlText: removeBlankXmlLines(
      xmlWithoutTarget.slice(0, insertionOffset) +
      normalizedMovingXml +
      xmlWithoutTarget.slice(insertionOffset)
    ),
    movedPath: [
      ...parent.source.path,
      insertionIndex
    ]
  };
}

function clampIndex(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ensureTrailingLineEnding(value: string, xmlText: string): string {
  if (/\r?\n$/.test(value)) {
    return value;
  }

  return `${value}${xmlText.includes("\r\n") ? "\r\n" : "\n"}`;
}

function getLineStartAtOffset(text: string, offset: number): number {
  return text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function getNodeDeletionRange(
  xmlText: string,
  node: InternalXmlNode
): { start: number; end: number } {
  const nodeStart = node.source.startOffset;
  const nodeEnd = node.closeTag?.endOffset ?? node.source.endOpenTagOffset;

  const lineStart = xmlText.lastIndexOf("\n", Math.max(0, nodeStart - 1)) + 1;
  const nextLineBreak = xmlText.indexOf("\n", nodeEnd);
  const lineEnd = nextLineBreak >= 0 ? nextLineBreak : xmlText.length;

  const beforeNodeOnLine = xmlText.slice(lineStart, nodeStart);
  const afterNodeOnLine = xmlText.slice(nodeEnd, lineEnd);

  if (/^[\t ]*$/.test(beforeNodeOnLine) && /^[\t ]*$/.test(afterNodeOnLine)) {
    if (lineStart > 0) {
      return {
        start: lineStart - 1,
        end: lineEnd
      };
    }

    return {
      start: lineStart,
      end: nextLineBreak >= 0 ? lineEnd + 1 : lineEnd
    };
  }

  return {
    start: nodeStart,
    end: nodeEnd
  };
}

function getInsertedRootSiblingPath(
  roots: InternalXmlNode[],
  referenceTree: InternalXmlNode
): number[] {
  const topRoot = getTopRootNode(referenceTree);
  const rootIndex = roots.indexOf(topRoot);

  if (rootIndex < 0) {
    return [roots.length];
  }

  return [rootIndex + 1];
}

function getTopRootNode(node: InternalXmlNode): InternalXmlNode {
  let current = node;

  while (current.parent) {
    current = current.parent;
  }

  return current;
}

function findNearestBehaviorTree(
  node: InternalXmlNode
): InternalXmlNode | undefined {
  let current: InternalXmlNode | undefined = node;

  while (current) {
    if (current.tag === "BehaviorTree") {
      return current;
    }

    current = current.parent;
  }

  return undefined;
}

function findBehaviorTreeById(
  roots: InternalXmlNode[],
  id: string
): InternalXmlNode | undefined {
  for (const root of roots) {
    const result = findBehaviorTreeByIdRecursive(root, id);

    if (result) {
      return result;
    }
  }

  return undefined;
}

function findBehaviorTreeByIdRecursive(
  node: InternalXmlNode,
  id: string
): InternalXmlNode | undefined {
  if (node.tag === "BehaviorTree" && node.attributes["ID"] === id) {
    return node;
  }

  for (const child of node.children) {
    const result = findBehaviorTreeByIdRecursive(child, id);

    if (result) {
      return result;
    }
  }

  return undefined;
}

function parseSingleBehaviorTreeTemplate(
  behaviorTreeXml: string
): BehaviorTreeTemplate {
  const roots = scanXml(behaviorTreeXml);
  const behaviorTrees: InternalXmlNode[] = [];

  for (const root of roots) {
    collectBehaviorTrees(root, behaviorTrees);
  }

  const behaviorTree = behaviorTrees[0];
  const id = behaviorTree?.attributes["ID"]?.trim();

  if (!behaviorTree || !id || !behaviorTree.closeTag) {
    throw new Error("Imported subtree XML does not contain a complete BehaviorTree with an ID.");
  }

  return {
    id,
    source: "imported",
    xmlText: behaviorTreeXml.slice(
      behaviorTree.source.startOffset,
      behaviorTree.closeTag.endOffset
    )
  };
}

function formatBehaviorTreeXmlForInsert(
  behaviorTreeXml: string,
  indent: string
): string {
  const normalizedXml = removeBlankXmlLines(behaviorTreeXml.trim());
  const lines = normalizedXml.split(/\r?\n/);
  const commonIndent = getCommonLineIndent(lines);

  return lines
    .map((line) => `${indent}${line.slice(commonIndent.length)}`)
    .join("\n");
}

function getCommonLineIndent(lines: string[]): string {
  const nonBlankLines = lines.filter((line) => !/^[\t ]*$/.test(line));

  if (nonBlankLines.length === 0) {
    return "";
  }

  let commonIndent = getLeadingWhitespace(nonBlankLines[0]);

  for (const line of nonBlankLines.slice(1)) {
    const lineIndent = getLeadingWhitespace(line);
    let index = 0;

    while (
      index < commonIndent.length &&
      index < lineIndent.length &&
      commonIndent[index] === lineIndent[index]
    ) {
      index += 1;
    }

    commonIndent = commonIndent.slice(0, index);
  }

  return commonIndent;
}

function getLeadingWhitespace(line: string): string {
  const match = /^[\t ]*/.exec(line);
  return match?.[0] ?? "";
}

function buildTreeNodesModelCatalog(
  roots: InternalXmlNode[],
  externalDefinitions: TreeNodeDefinitionMap
): TreeNodeModelCatalog {
  const catalog: TreeNodeModelCatalog = new Map();

  addBuiltinDefinitions(catalog);

  for (const definition of Object.values(externalDefinitions)) {
    catalog.set(definition.id, {
      ...definition,
      source: "imported",
      ports: withCommonPorts(definition.id, definition.ports ?? [])
    });
  }

  for (const root of roots) {
    collectTreeNodesModelEntries(root, catalog, "xml");
  }

  return catalog;
}

function addBuiltinDefinitions(catalog: TreeNodeModelCatalog): void {
  for (const definition of BUILTIN_NODE_DEFINITIONS) {
    catalog.set(definition.id, definition);
  }
}

function collectTreeNodesModelEntries(
  node: InternalXmlNode,
  catalog: TreeNodeModelCatalog,
  source: TreeNodeDefinitionSource
): void {
  if (node.tag === "TreeNodesModel") {
    for (const child of node.children) {
      const kind = modelTagToKind(child.tag);
      const id = child.attributes["ID"];

      if (kind && id) {
        catalog.set(id, {
          id,
          kind,
          source,
          ports: withCommonPorts(id, collectPorts(child))
        });
      }
    }

    return;
  }

  for (const child of node.children) {
    collectTreeNodesModelEntries(child, catalog, source);
  }
}

function collectPorts(node: InternalXmlNode): TreeNodePort[] {
  const ports: TreeNodePort[] = [];

  for (const child of node.children) {
    const direction = portTagToDirection(child.tag);
    const name = child.attributes["name"];

    if (!direction || !name) {
      continue;
    }

    ports.push({
      name,
      direction
    });
  }

  return ports;
}

function portTagToDirection(tag: string): TreeNodePortDirection | undefined {
  const normalized = tag.toLowerCase();

  if (normalized === "input_port" || normalized === "inputport") {
    return "input";
  }

  if (normalized === "output_port" || normalized === "outputport") {
    return "output";
  }

  if (normalized === "inout_port" || normalized === "inoutport") {
    return "inout";
  }

  return undefined;
}

function modelTagToKind(tag: string): BtNodeKind | undefined {
  if (tag === "Control") {
    return "control";
  }

  if (tag === "Decorator") {
    return "decorator";
  }

  if (tag === "Condition") {
    return "condition";
  }

  if (tag === "Action") {
    return "action";
  }

  return undefined;
}

function stripInternalFields(
  node: InternalXmlNode,
  modelCatalog: TreeNodeModelCatalog
): BtNode {
  const definition = modelCatalog.get(node.tag);
  const kind = definition?.kind ?? "action";

  return {
    id: node.id,
    tag: node.tag,
    kind,
    name: node.name,
    attributes: node.attributes,
    source: node.source,
    definitionKnown: Boolean(definition),
    definition,
    children: node.children.map((child) =>
      stripInternalFields(child, modelCatalog)
    )
  };
}

function validateBehaviorTreeXmlNodes(
  nodes: InternalXmlNode[],
  modelCatalog: TreeNodeModelCatalog
): void {
  for (const node of nodes) {
    validateBehaviorTreeXmlNode(node, modelCatalog);
  }
}

function validateBehaviorTreeXmlNode(
  node: InternalXmlNode,
  modelCatalog: TreeNodeModelCatalog
): void {
  const openTag = node.source.startTag;

  if (!isSelfClosingOpenTag(openTag) && !node.closeTag) {
    throw new Error(
      `Malformed XML at ${formatXmlLocation(node)}: <${node.tag}> is missing a closing tag or "/>".`
    );
  }

  const definition = modelCatalog.get(node.tag);
  const kind = definition?.kind;
  const isLeafNode = kind === "action" || kind === "condition";
  const isSubTreeLeaf = node.tag === "SubTree" || node.tag === "SubTreePlus";

  if ((isLeafNode || isSubTreeLeaf) && node.children.length > 0) {
    const expectedForm = isSelfClosingOpenTag(openTag)
      ? "no child BehaviorTree nodes"
      : 'a self-closing tag like "<' + node.tag + ' .../>"';

    throw new Error(
      `Invalid BehaviorTree XML at ${formatXmlLocation(node)}: <${node.tag}> is a leaf node and cannot contain child nodes. Use ${expectedForm}.`
    );
  }

  for (const child of node.children) {
    validateBehaviorTreeXmlNode(child, modelCatalog);
  }
}

function formatXmlLocation(node: InternalXmlNode): string {
  return `line ${node.source.line + 1}, column ${node.source.column + 1}`;
}

function collectBehaviorTrees(
  node: InternalXmlNode,
  output: InternalXmlNode[]
): void {
  if (node.tag === "BehaviorTree") {
    output.push(node);
    return;
  }

  for (const child of node.children) {
    collectBehaviorTrees(child, output);
  }
}

function scanXml(xmlText: string): InternalXmlNode[] {
  const roots: InternalXmlNode[] = [];
  const stack: InternalXmlNode[] = [];
  let index = 0;

  while (index < xmlText.length) {
    const openIndex = xmlText.indexOf("<", index);

    if (openIndex < 0) {
      break;
    }

    if (xmlText.startsWith("<!--", openIndex)) {
      const closeIndex = xmlText.indexOf("-->", openIndex + 4);
      index = closeIndex < 0 ? xmlText.length : closeIndex + 3;
      continue;
    }

    if (xmlText.startsWith("<![CDATA[", openIndex)) {
      const closeIndex = xmlText.indexOf("]]>", openIndex + 9);
      index = closeIndex < 0 ? xmlText.length : closeIndex + 3;
      continue;
    }

    if (xmlText.startsWith("<?", openIndex)) {
      const closeIndex = xmlText.indexOf("?>", openIndex + 2);
      index = closeIndex < 0 ? xmlText.length : closeIndex + 2;
      continue;
    }

    if (xmlText.startsWith("</", openIndex)) {
      const closeIndex = xmlText.indexOf(">", openIndex + 2);
      const location = offsetToLineColumn(xmlText, openIndex);

      if (closeIndex < 0) {
        throw new Error(
          `Malformed XML at line ${location.line + 1}, column ${location.column + 1}: closing tag is missing ">".`
        );
      }

      const closingTagText = xmlText.slice(
        openIndex,
        closeIndex + 1
      );
      const closingTagName = extractClosingTagName(closingTagText);

      if (closingTagName) {
        for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex -= 1) {
          const candidate = stack[stackIndex];

          if (candidate.tag !== closingTagName) {
            continue;
          }

          candidate.closeTag = {
            startOffset: openIndex,
            endOffset: closeIndex + 1
          };

          stack.length = stackIndex;
          break;
        }
      } else {
        stack.pop();
      }

      index = closeIndex + 1;
      continue;
    }

    if (xmlText.startsWith("<!", openIndex)) {
      const closeIndex = xmlText.indexOf(">", openIndex + 2);
      index = closeIndex < 0 ? xmlText.length : closeIndex + 1;
      continue;
    }

    const closeIndex = findOpenTagEnd(xmlText, openIndex);

    if (closeIndex < 0) {
      const location = offsetToLineColumn(xmlText, openIndex);

      throw new Error(
        `Malformed XML at line ${location.line + 1}, column ${location.column + 1}: opening tag is missing ">".`
      );
    }

    const openTag = xmlText.slice(openIndex, closeIndex + 1);
    const tag = extractTagName(openTag);

    if (!tag) {
      index = closeIndex + 1;
      continue;
    }

    const attributes = extractAttributes(openTag);
    const parent = stack[stack.length - 1];

    const siblingIndex = parent ? parent.children.length : roots.length;
    const path = parent ? [...parent.source.path, siblingIndex] : [siblingIndex];
    const location = offsetToLineColumn(xmlText, openIndex);

    const node: InternalXmlNode = {
      id: makeId(),
      tag,
      name: attributes["name"] ?? attributes["ID"],
      attributes,
      children: [],
      source: {
        path,
        startOffset: openIndex,
        endOpenTagOffset: closeIndex + 1,
        line: location.line,
        column: location.column,
        startTag: openTag
      },
      parent
    };

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }

    if (!isSelfClosingOpenTag(openTag)) {
      stack.push(node);
    }

    index = closeIndex + 1;
  }

  return roots;
}

function findNodeByPath(
  nodes: InternalXmlNode[],
  path: number[]
): InternalXmlNode | undefined {
  const exactMatch = findNodeByExactPath(nodes, path);

  if (exactMatch) {
    return exactMatch;
  }

  return findNodeByBehaviorTreeForestPath(nodes, path);
}

function findNodeByExactPath(
  nodes: InternalXmlNode[],
  path: number[]
): InternalXmlNode | undefined {
  let currentLevel = nodes;
  let currentNode: InternalXmlNode | undefined;

  for (const index of path) {
    currentNode = currentLevel[index];

    if (!currentNode) {
      return undefined;
    }

    currentLevel = currentNode.children;
  }

  return currentNode;
}

function findNodeByBehaviorTreeForestPath(
  nodes: InternalXmlNode[],
  path: number[]
): InternalXmlNode | undefined {
  if (path.length === 0) {
    return undefined;
  }

  const behaviorTrees: InternalXmlNode[] = [];

  for (const root of nodes) {
    collectBehaviorTrees(root, behaviorTrees);
  }

  const behaviorTreeRoot = behaviorTrees[path[0]];

  if (!behaviorTreeRoot) {
    return undefined;
  }

  const realXmlPath = [
    ...behaviorTreeRoot.source.path,
    ...path.slice(1)
  ];

  return findNodeByExactPath(nodes, realXmlPath);
}

function findOpenTagEnd(xmlText: string, startOffset: number): number {
  let quote: string | undefined;

  for (let i = startOffset + 1; i < xmlText.length; i += 1) {
    const char = xmlText[i];

    if (quote) {
      if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "<") {
      return -1;
    }

    if (char === ">") {
      return i;
    }
  }

  return -1;
}

function extractTagName(openTag: string): string | undefined {
  const match = /^<\s*([^\s/>]+)/.exec(openTag);
  return match?.[1];
}

function extractClosingTagName(closeTag: string): string | undefined {
  const match = /^<\/\s*([^\s>]+)/.exec(closeTag);
  return match?.[1];
}

function extractAttributes(openTag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributeRegex = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

  for (const match of openTag.matchAll(attributeRegex)) {
    const name = match[1];
    const value = match[3] ?? match[4] ?? "";
    attributes[name] = decodeXmlAttribute(value);
  }

  return attributes;
}

function buildSelfClosingTag(
  tagName: string,
  attributes: Record<string, string>
): string {
  const serializedAttributes = Object.entries(attributes)
    .map(([name, value]) => {
      return ` ${name}="${encodeXmlAttribute(value, '"')}"`;
    })
    .join("");

  return `<${tagName}${serializedAttributes}/>`;
}

function validateXmlName(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value)) {
    throw new Error(`Invalid XML ${label}: ${value}`);
  }
}

function getLineIndentAtOffset(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const linePrefix = text.slice(lineStart, offset);
  const match = /^[\t ]*/.exec(linePrefix);

  return match?.[0] ?? "";
}

function isSelfClosingOpenTag(openTag: string): boolean {
  return /\/\s*>$/.test(openTag);
}

function removeBlankXmlLines(xmlText: string): string {
  const lineEnding = xmlText.includes("\r\n") ? "\r\n" : "\n";
  const hasTrailingLineEnding = xmlText.endsWith("\n");
  const lines = xmlText.split(/\r?\n/);

  if (hasTrailingLineEnding) {
    lines.pop();
  }

  const nonBlankLines = lines.filter((line) => !/^[\t ]*$/.test(line));

  return [
    nonBlankLines.join(lineEnding),
    hasTrailingLineEnding ? lineEnding : ""
  ].join("");
}

function setAttributeInOpenTag(
  openTag: string,
  attributeName: string,
  attributeValue: string
): string {
  const escapedName = escapeRegex(attributeName);
  const attributeRegex = new RegExp(
    `(\\s${escapedName}\\s*=\\s*)(["'])([\\s\\S]*?)(\\2)`
  );

  const existing = attributeRegex.exec(openTag);

  if (existing) {
    const quote = existing[2];
    const encodedForExistingQuote = encodeXmlAttribute(attributeValue, quote);

    return openTag.replace(
      attributeRegex,
      `$1${quote}${encodedForExistingQuote}${quote}`
    );
  }

  const encodedValue = encodeXmlAttribute(attributeValue, '"');
  const insertText = ` ${attributeName}="${encodedValue}"`;

  if (/\/\s*>$/.test(openTag)) {
    return openTag.replace(/\/\s*>$/, `${insertText}/>`);
  }

  return openTag.replace(/\s*>$/, `${insertText}>`);
}

function removeAttributeFromOpenTag(
  openTag: string,
  attributeName: string
): string {
  const escapedName = escapeRegex(attributeName);
  const attributeRegex = new RegExp(
    `\\s${escapedName}\\s*=\\s*(["'])[\\s\\S]*?\\1`
  );

  return openTag.replace(attributeRegex, "");
}

function encodeXmlAttribute(value: string, quote: string): string {
  let encoded = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  if (quote === '"') {
    encoded = encoded.replace(/"/g, "&quot;");
  }

  if (quote === "'") {
    encoded = encoded.replace(/'/g, "&apos;");
  }

  return encoded;
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function offsetToLineColumn(
  text: string,
  offset: number
): { line: number; column: number } {
  let line = 0;
  let column = 0;

  for (let i = 0; i < offset; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

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

type InternalXmlNode = Omit<
  BtNode,
  "kind" | "children" | "definitionKnown" | "definition"
> & {
  kind?: BtNodeKind;
  parent?: InternalXmlNode;
  children: InternalXmlNode[];
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

  return outputRoots.map((node) => stripInternalFields(node, modelCatalog));
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

  return xmlText.slice(0, start) + updatedOpenTag + xmlText.slice(end);
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
  if (tag === "input_port") {
    return "input";
  }

  if (tag === "output_port") {
    return "output";
  }

  if (tag === "inout_port") {
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

      if (stack.length > 0) {
        stack.pop();
      }

      index = closeIndex < 0 ? xmlText.length : closeIndex + 1;
      continue;
    }

    if (xmlText.startsWith("<!", openIndex)) {
      const closeIndex = xmlText.indexOf(">", openIndex + 2);
      index = closeIndex < 0 ? xmlText.length : closeIndex + 1;
      continue;
    }

    const closeIndex = findOpenTagEnd(xmlText, openIndex);

    if (closeIndex < 0) {
      break;
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

function isSelfClosingOpenTag(openTag: string): boolean {
  return /\/\s*>$/.test(openTag);
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
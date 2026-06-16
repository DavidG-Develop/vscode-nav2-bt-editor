export type BtNodeKind = "control" | "decorator" | "condition" | "action";

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
};

type InternalXmlNode = Omit<BtNode, "kind" | "children"> & {
  kind?: BtNodeKind;
  parent?: InternalXmlNode;
  children: InternalXmlNode[];
};

type TreeNodeModelCatalog = Map<string, BtNodeKind>;

const BUILTIN_CONTROL_NODES = new Set([
  // XML / wrapper nodes
  "BehaviorTree",

  // BehaviorTree.CPP controls
  "Sequence",
  "AsyncSequence",
  "SequenceStar",
  "SequenceWithMemory",
  "ReactiveSequence",
  "Fallback",
  "AsyncFallback",
  "Selector",
  "ReactiveFallback",
  "Parallel",
  "ParallelAll",
  "IfThenElse",
  "WhileDoElse",
  "Switch2",
  "Switch3",
  "Switch4",
  "Switch5",
  "Switch6",

  // Nav2 controls
  "PipelineSequence",
  "RecoveryNode",
  "RoundRobin",
  "NonblockingSequence",
  "PersistentSequence",
  "PauseResumeController"
]);

const BUILTIN_DECORATOR_NODES = new Set([
  // BehaviorTree.CPP decorators
  "Inverter",
  "ForceSuccess",
  "ForceFailure",
  "Repeat",
  "RetryUntilSuccessful",
  "RetryUntilSuccesful",
  "KeepRunningUntilFailure",
  "Delay",
  "Timeout",
  "RunOnce",
  "Precondition",
  "SubTree",
  "SubTreePlus",

  // Nav2 decorators
  "RateController",
  "DistanceController",
  "SpeedController",
  "GoalUpdater",
  "GoalUpdatedController",
  "SingleTrigger",
  "PathLongerOnApproach"
]);

const BUILTIN_CONDITION_NODES = new Set([
  // Common / BehaviorTree.CPP-ish conditions
  "AlwaysSuccess",
  "AlwaysFailure",
  "ScriptCondition",

  // Nav2 conditions
  "AreErrorCodesPresent",
  "ArePosesNear",
  "DistanceTraveled",
  "GloballyUpdatedGoal",
  "GoalReached",
  "GoalUpdated",
  "InitialPoseReceived",
  "IsBatteryCharging",
  "IsBatteryLow",
  "IsGoalNearby",
  "IsPathValid",
  "IsStuck",
  "IsWithinPathTrackingBounds",
  "PathExpiringTimer",
  "TimeExpired",
  "TransformAvailable",
  "WouldAControllerRecoveryHelp",
  "WouldAPlannerRecoveryHelp",
  "WouldARouteRecoveryHelp",
  "WouldASmootherRecoveryHelp"
]);

const BUILTIN_ACTION_NODES = new Set([
  // BehaviorTree.CPP common test/simple actions
  "AlwaysSuccess",
  "AlwaysFailure",
  "SetBlackboard",
  "UnsetBlackboard",
  "Script",
  "Sleep",

  // Nav2 actions / services / selector nodes
  "AppendGoalPoseToGoals",
  "AssistedTeleop",
  "CancelAssistedTeleop",
  "AssistedTeleopCancel",
  "BackUp",
  "CancelBackUp",
  "BackUpCancel",
  "ClearEntireCostmap",
  "ClearCostmapAroundRobot",
  "ClearCostmapExceptRegion",
  "ComputeAndTrackRoute",
  "CancelComputeAndTrackRoute",
  "ComputeAndTrackRouteCancel",
  "ComputePathThroughPoses",
  "ComputePathToPose",
  "ComputeRoute",
  "ConcatenatePaths",
  "CancelControl",
  "ControllerCancel",
  "ControllerSelector",
  "DriveOnHeading",
  "CancelDriveOnHeading",
  "DriveOnHeadingCancel",
  "ExtractRouteNodesAsGoals",
  "FollowPath",
  "FollowObject",
  "GetCurrentPose",
  "GetNextFewGoals",
  "GetPoseFromPath",
  "GoalCheckerSelector",
  "NavigateThroughPoses",
  "NavigateToPose",
  "PlannerSelector",
  "ProgressCheckerSelector",
  "ReinitializeGlobalLocalization",
  "RemoveInCollisionGoals",
  "RemovePassedGoals",
  "SmoothPath",
  "SmootherSelector",
  "Spin",
  "CancelSpin",
  "SpinCancel",
  "TruncatePath",
  "TruncatePathLocal",
  "Wait",
  "CancelWait",
  "WaitCancel"
]);

let nextId = 0;

function makeId(): string {
  nextId += 1;
  return `bt-node-${nextId}`;
}

export function parseBehaviorTreeXml(xmlText: string): BtNode[] {
  nextId = 0;

  const roots = scanXml(xmlText);
  const modelCatalog = buildTreeNodesModelCatalog(roots);

  const behaviorTrees: InternalXmlNode[] = [];

  for (const root of roots) {
    collectBehaviorTrees(root, behaviorTrees);
  }

  const outputRoots = behaviorTrees.length > 0 ? behaviorTrees : roots;

  return outputRoots.map((node) => stripInternalFields(node, modelCatalog));
}

export function updateXmlAttributeByPath(
  xmlText: string,
  path: number[],
  attributeName: string,
  attributeValue: string
): string {
  const roots = scanXml(xmlText);
  const target = findNodeByPath(roots, path);

  if (!target) {
    throw new Error(`Could not find XML node at path [${path.join(", ")}].`);
  }

  const start = target.source.startOffset;
  const end = target.source.endOpenTagOffset;
  const openTag = xmlText.slice(start, end);

  const updatedOpenTag = setAttributeInOpenTag(
    openTag,
    attributeName,
    attributeValue
  );

  return xmlText.slice(0, start) + updatedOpenTag + xmlText.slice(end);
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

function buildTreeNodesModelCatalog(
  roots: InternalXmlNode[]
): TreeNodeModelCatalog {
  const catalog: TreeNodeModelCatalog = new Map();

  for (const root of roots) {
    collectTreeNodesModelEntries(root, catalog);
  }

  return catalog;
}

function collectTreeNodesModelEntries(
  node: InternalXmlNode,
  catalog: TreeNodeModelCatalog
): void {
  if (node.tag === "TreeNodesModel") {
    for (const child of node.children) {
      const kind = modelTagToKind(child.tag);
      const id = child.attributes["ID"];

      if (kind && id) {
        catalog.set(id, kind);
      }
    }

    return;
  }

  for (const child of node.children) {
    collectTreeNodesModelEntries(child, catalog);
  }
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
  return {
    id: node.id,
    tag: node.tag,
    kind: getNodeKind(node.tag, modelCatalog),
    name: node.name,
    attributes: node.attributes,
    source: node.source,
    children: node.children.map((child) =>
      stripInternalFields(child, modelCatalog)
    )
  };
}

function getNodeKind(
  tag: string,
  modelCatalog: TreeNodeModelCatalog
): BtNodeKind {
  const modelKind = modelCatalog.get(tag);

  if (modelKind) {
    return modelKind;
  }

  if (BUILTIN_CONTROL_NODES.has(tag)) {
    return "control";
  }

  if (BUILTIN_DECORATOR_NODES.has(tag)) {
    return "decorator";
  }

  if (BUILTIN_CONDITION_NODES.has(tag)) {
    return "condition";
  }

  if (BUILTIN_ACTION_NODES.has(tag)) {
    return "action";
  }

  return "action";
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
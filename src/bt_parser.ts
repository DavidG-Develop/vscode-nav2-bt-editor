import { XMLParser } from "fast-xml-parser";

export type BtNode = {
  id: string;
  tag: string;
  name?: string;
  attributes: Record<string, string>;
  children: BtNode[];
};

type RawXmlNode = Record<string, unknown>;

let nextId = 0;

function makeId(): string {
  nextId += 1;
  return `bt-node-${nextId}`;
}

function isObject(value: unknown): value is RawXmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function extractAttributes(raw: RawXmlNode): Record<string, string> {
  const attributes: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith("@_")) {
      continue;
    }

    attributes[key.substring(2)] = String(value);
  }

  return attributes;
}

function parseElement(tag: string, raw: unknown): BtNode[] {
  const rawElements = normalizeToArray(raw);
  const nodes: BtNode[] = [];

  for (const rawElement of rawElements) {
    if (!isObject(rawElement)) {
      continue;
    }

    const attributes = extractAttributes(rawElement);
    const children: BtNode[] = [];

    for (const [childTag, childValue] of Object.entries(rawElement)) {
      if (childTag.startsWith("@_")) {
        continue;
      }

      children.push(...parseElement(childTag, childValue));
    }

    nodes.push({
      id: makeId(),
      tag,
      name: attributes["name"] ?? attributes["ID"],
      attributes,
      children
    });
  }

  return nodes;
}

export function parseBehaviorTreeXml(xmlText: string): BtNode[] {
  nextId = 0;

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true
  });

  const parsed = parser.parse(xmlText);
  const root = parsed["root"] ?? parsed;

  if (!isObject(root)) {
    return [];
  }

  const behaviorTreeRaw = root["BehaviorTree"];

  if (behaviorTreeRaw !== undefined) {
    return parseElement("BehaviorTree", behaviorTreeRaw);
  }

  const nodes: BtNode[] = [];

  for (const [tag, value] of Object.entries(root)) {
    nodes.push(...parseElement(tag, value));
  }

  return nodes;
}

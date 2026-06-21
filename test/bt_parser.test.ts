import assert = require("node:assert/strict");
import test = require("node:test");
import {
  deleteXmlNodeByPath,
  hasSubTreeReferenceToBehaviorTree,
  insertXmlNodeCopyByPath,
  insertXmlChildNodeByPath,
  moveXmlNodeByPath,
  parseBehaviorTreeXml
} from "../src/bt_parser";

function parseFirstTree(xmlText: string) {
  const trees = parseBehaviorTreeXml(xmlText);
  assert.equal(trees.length, 1);
  return trees[0];
}

test("rejects mismatched closing tags", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <Sequence>",
    "    <AlwaysSuccess/>",
    "  </Fallback>",
    "</BehaviorTree>"
  ].join("\n");

  assert.throws(
    () => parseBehaviorTreeXml(xmlText),
    /expected closing tag <\/Sequence> before <\/Fallback>/
  );
});

test("rejects closing tags without an opening tag", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <AlwaysSuccess/>",
    "</BehaviorTree>",
    "</Unexpected>"
  ].join("\n");

  assert.throws(
    () => parseBehaviorTreeXml(xmlText),
    /closing tag <\/Unexpected> has no matching opening tag/
  );
});

test("rejects opening tags that run into the next node", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <Sequence>",
    "    <AlwaysSuccess/",
    "    <AlwaysFailure/>",
    "  </Sequence>",
    "</BehaviorTree>"
  ].join("\n");

  assert.throws(
    () => parseBehaviorTreeXml(xmlText),
    /opening tag is missing ">" before the next "<"/
  );
});

test("rejects unquoted attribute values", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <AlwaysSuccess custom_attr=value/>",
    "</BehaviorTree>"
  ].join("\n");

  assert.throws(
    () => parseBehaviorTreeXml(xmlText),
    /attribute "custom_attr" value must be quoted/
  );
});

test("rejects mismatched attribute quotes", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <AlwaysSuccess custom_attr='value\"/>",
    "</BehaviorTree>"
  ].join("\n");

  assert.throws(
    () => parseBehaviorTreeXml(xmlText),
    /attribute value is missing closing ' quote/
  );
});

test("keeps unknown but well-formed attributes", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    '  <AlwaysSuccess custom_attr="value"/>',
    "</BehaviorTree>"
  ].join("\n");

  const tree = parseFirstTree(xmlText);

  assert.equal(tree.children[0].attributes.custom_attr, "value");
});

test("moves a leaf to the end without joining the parent closing tag", () => {
  const xmlText = [
    "<root>",
    '  <BehaviorTree ID="MainTree">',
    "    <Sequence>",
    '      <CloseDoor door_id="{door_id}"/>',
    "      <AlignToDock/>",
    "      <CancelSpin/>",
    "    </Sequence>",
    "  </BehaviorTree>",
    "</root>",
    ""
  ].join("\n");
  const tree = parseFirstTree(xmlText);
  const sequence = tree.children[0];
  const closeDoor = sequence.children[0];

  const result = moveXmlNodeByPath(xmlText, closeDoor.source.path, 2);

  assert.equal(
    result.xmlText,
    [
      "<root>",
      '  <BehaviorTree ID="MainTree">',
      "    <Sequence>",
      "      <AlignToDock/>",
      "      <CancelSpin/>",
      '      <CloseDoor door_id="{door_id}"/>',
      "    </Sequence>",
      "  </BehaviorTree>",
      "</root>",
      ""
    ].join("\n")
  );
  assert.doesNotMatch(result.xmlText, /\/><\/Sequence>/);
});

test("expands a self-closing parent without adding blank lines", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <Sequence/>",
    "</BehaviorTree>"
  ].join("\n");
  const tree = parseFirstTree(xmlText);
  const sequence = tree.children[0];

  const result = insertXmlChildNodeByPath(
    xmlText,
    sequence.source.path,
    "AlwaysSuccess",
    {}
  );

  assert.doesNotMatch(result.xmlText, /\n[ \t]*\n/);
  assert.match(result.xmlText, /<Sequence>\n    <AlwaysSuccess\/>\n  <\/Sequence>/);
});

test("copies a named node as the last child with a copy suffix", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <Sequence>",
    '    <CloseDoor name="door" door_id="{door_id}"/>',
    "    <AlwaysSuccess/>",
    "  </Sequence>",
    "</BehaviorTree>"
  ].join("\n");
  const tree = parseFirstTree(xmlText);
  const sequence = tree.children[0];
  const closeDoor = sequence.children[0];

  const result = insertXmlNodeCopyByPath(
    xmlText,
    closeDoor.source.path,
    sequence.source.path
  );

  assert.equal(
    result.xmlText,
    [
      '<BehaviorTree ID="MainTree">',
      "  <Sequence>",
      '    <CloseDoor name="door" door_id="{door_id}"/>',
      "    <AlwaysSuccess/>",
      '    <CloseDoor name="door_copy" door_id="{door_id}"/>',
      "  </Sequence>",
      "</BehaviorTree>"
    ].join("\n")
  );
  assert.deepEqual(result.copiedPath, [...sequence.source.path, 2]);
});

test("copies a nested node subtree with target indentation", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <Sequence>",
    '    <Fallback name="recover">',
    "      <AlwaysFailure/>",
    "      <AlwaysSuccess/>",
    "    </Fallback>",
    "  </Sequence>",
    "</BehaviorTree>"
  ].join("\n");
  const tree = parseFirstTree(xmlText);
  const sequence = tree.children[0];
  const fallback = sequence.children[0];

  const result = insertXmlNodeCopyByPath(
    xmlText,
    fallback.source.path,
    sequence.source.path
  );

  assert.equal(
    result.xmlText,
    [
      '<BehaviorTree ID="MainTree">',
      "  <Sequence>",
      '    <Fallback name="recover">',
      "      <AlwaysFailure/>",
      "      <AlwaysSuccess/>",
      "    </Fallback>",
      '    <Fallback name="recover_copy">',
      "      <AlwaysFailure/>",
      "      <AlwaysSuccess/>",
      "    </Fallback>",
      "  </Sequence>",
      "</BehaviorTree>"
    ].join("\n")
  );
  assert.doesNotMatch(result.xmlText, /\n[ \t]*\n/);
});

test("keeps subtree implementation while another call references it", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <Sequence>",
    '    <SubTree ID="InitTree" _autoremap="true"/>',
    '    <SubTree ID="InitTree" _autoremap="true"/>',
    "  </Sequence>",
    "</BehaviorTree>",
    '<BehaviorTree ID="InitTree">',
    "  <AlwaysSuccess/>",
    "</BehaviorTree>"
  ].join("\n");
  const trees = parseBehaviorTreeXml(xmlText);
  assert.equal(trees.length, 2);
  const tree = trees[0];
  const sequence = tree.children[0];
  const firstSubTree = sequence.children[0];

  const afterFirstDelete = deleteXmlNodeByPath(
    xmlText,
    firstSubTree.source.path
  ).xmlText;

  assert.equal(
    hasSubTreeReferenceToBehaviorTree(afterFirstDelete, "InitTree"),
    true
  );

  const reparsedTrees = parseBehaviorTreeXml(afterFirstDelete);
  assert.equal(reparsedTrees.length, 2);
  const reparsedTree = reparsedTrees[0];
  const remainingSubTree = reparsedTree.children[0].children[0];
  const afterSecondDelete = deleteXmlNodeByPath(
    afterFirstDelete,
    remainingSubTree.source.path
  ).xmlText;

  assert.equal(
    hasSubTreeReferenceToBehaviorTree(afterSecondDelete, "InitTree"),
    false
  );
});

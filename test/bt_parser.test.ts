import assert = require("node:assert/strict");
import test = require("node:test");
import {
  deleteXmlNodeByPath,
  hasSubTreeReferenceToBehaviorTree,
  insertXmlNodeCopyByPath,
  insertXmlChildNodeByPath,
  moveXmlNodeToParentByPath,
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

test("copies a subtree call without duplicating its implementation", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <Sequence>",
    '    <SubTree ID="InitTree" _autoremap="true"/>',
    "  </Sequence>",
    "</BehaviorTree>",
    '<BehaviorTree ID="InitTree">',
    "  <AlwaysSuccess/>",
    "</BehaviorTree>"
  ].join("\n");
  const trees = parseBehaviorTreeXml(xmlText);
  assert.equal(trees.length, 2);
  const sequence = trees[0].children[0];
  const subTree = sequence.children[0];

  const result = insertXmlNodeCopyByPath(
    xmlText,
    subTree.source.path,
    sequence.source.path
  );

  assert.match(
    result.xmlText,
    /<SubTree ID="InitTree" _autoremap="true"\/>\n    <SubTree ID="InitTree" _autoremap="true"\/>/
  );
  assert.equal(
    result.xmlText.match(/<BehaviorTree ID="InitTree">/g)?.length,
    1
  );
});

test("cuts a node into another parent without renaming it", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <Sequence>",
    '    <CloseDoor name="door" door_id="{door_id}"/>',
    "    <Fallback>",
    "      <AlwaysFailure/>",
    "    </Fallback>",
    "  </Sequence>",
    "</BehaviorTree>"
  ].join("\n");
  const tree = parseFirstTree(xmlText);
  const sequence = tree.children[0];
  const closeDoor = sequence.children[0];
  const fallback = sequence.children[1];

  const result = moveXmlNodeToParentByPath(
    xmlText,
    closeDoor.source.path,
    fallback.source.path
  );

  assert.equal(
    result.xmlText,
    [
      '<BehaviorTree ID="MainTree">',
      "  <Sequence>",
      "    <Fallback>",
      "      <AlwaysFailure/>",
      '      <CloseDoor name="door" door_id="{door_id}"/>',
      "    </Fallback>",
      "  </Sequence>",
      "</BehaviorTree>"
    ].join("\n")
  );
  assert.doesNotMatch(result.xmlText, /door_copy/);
});

test("cuts a child to the end of the same parent", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <Sequence>",
    '    <CloseDoor name="door" door_id="{door_id}"/>',
    "    <AlignToDock/>",
    "    <CancelSpin/>",
    "  </Sequence>",
    "</BehaviorTree>"
  ].join("\n");
  const tree = parseFirstTree(xmlText);
  const sequence = tree.children[0];
  const closeDoor = sequence.children[0];

  const result = moveXmlNodeToParentByPath(
    xmlText,
    closeDoor.source.path,
    sequence.source.path
  );

  assert.equal(
    result.xmlText,
    [
      '<BehaviorTree ID="MainTree">',
      "  <Sequence>",
      "    <AlignToDock/>",
      "    <CancelSpin/>",
      '    <CloseDoor name="door" door_id="{door_id}"/>',
      "  </Sequence>",
      "</BehaviorTree>"
    ].join("\n")
  );
  assert.deepEqual(result.movedPath, [...sequence.source.path, 2]);
});

test("cuts a node from one BehaviorTree into another BehaviorTree", () => {
  const xmlText = [
    '<root main_tree_to_execute="MainTree">',
    '  <BehaviorTree ID="MainTree">',
    '    <Sequence name="MainMission">',
    '      <SubTree ID="NavigateMissionSubTree" _autoremap="true"/>',
    '      <NavigateThroughDoor door_id="{door_id}" goal="{goal}"/>',
    "    </Sequence>",
    "  </BehaviorTree>",
    '  <BehaviorTree ID="NavigateMissionSubTree">',
    '    <Sequence name="NavigateMission">',
    '      <ComputePathToPose goal="{goal}" path="{path}"/>',
    "    </Sequence>",
    "  </BehaviorTree>",
    "</root>"
  ].join("\n");
  const trees = parseBehaviorTreeXml(xmlText);
  assert.equal(trees.length, 2);
  const mainSequence = trees[0].children[0];
  const navigateThroughDoor = mainSequence.children[1];
  const navigateSequence = trees[1].children[0];

  const result = moveXmlNodeToParentByPath(
    xmlText,
    navigateThroughDoor.source.path,
    navigateSequence.source.path
  );

  assert.equal(
    result.xmlText,
    [
      '<root main_tree_to_execute="MainTree">',
      '  <BehaviorTree ID="MainTree">',
      '    <Sequence name="MainMission">',
      '      <SubTree ID="NavigateMissionSubTree" _autoremap="true"/>',
      "    </Sequence>",
      "  </BehaviorTree>",
      '  <BehaviorTree ID="NavigateMissionSubTree">',
      '    <Sequence name="NavigateMission">',
      '      <ComputePathToPose goal="{goal}" path="{path}"/>',
      '      <NavigateThroughDoor door_id="{door_id}" goal="{goal}"/>',
      "    </Sequence>",
      "  </BehaviorTree>",
      "</root>"
    ].join("\n")
  );
  assert.deepEqual(result.movedPath, [...navigateSequence.source.path, 1]);
});

test("rejects cutting a SubTree call into the BehaviorTree it references", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    "  <Sequence>",
    '    <SubTree ID="InitTree" _autoremap="true"/>',
    "  </Sequence>",
    "</BehaviorTree>",
    '<BehaviorTree ID="InitTree">',
    "  <Sequence>",
    "    <AlwaysSuccess/>",
    "  </Sequence>",
    "</BehaviorTree>"
  ].join("\n");
  const trees = parseBehaviorTreeXml(xmlText);
  assert.equal(trees.length, 2);
  const subTreeCall = trees[0].children[0].children[0];
  const referencedSequence = trees[1].children[0];

  assert.throws(
    () =>
      moveXmlNodeToParentByPath(
        xmlText,
        subTreeCall.source.path,
        referencedSequence.source.path
      ),
    /recursive SubTree reference/
  );
});

test("rejects cutting a parent containing a SubTree call into that referenced BehaviorTree", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    '  <Sequence name="MainMission">',
    '    <Fallback name="ParentWithSubTree">',
    '      <SubTree ID="InitTree" _autoremap="true"/>',
    "      <AlwaysFailure/>",
    "    </Fallback>",
    "  </Sequence>",
    "</BehaviorTree>",
    '<BehaviorTree ID="InitTree">',
    "  <Sequence>",
    "    <AlwaysSuccess/>",
    "  </Sequence>",
    "</BehaviorTree>"
  ].join("\n");
  const trees = parseBehaviorTreeXml(xmlText);
  assert.equal(trees.length, 2);
  const parentWithSubTree = trees[0].children[0].children[0];
  const referencedSequence = trees[1].children[0];

  assert.throws(
    () =>
      moveXmlNodeToParentByPath(
        xmlText,
        parentWithSubTree.source.path,
        referencedSequence.source.path
      ),
    /recursive SubTree reference/
  );
});

test("rejects cutting a parent into a BehaviorTree reachable through nested SubTree calls", () => {
  const xmlText = [
    '<BehaviorTree ID="MainTree">',
    '  <Sequence name="MainMission">',
    '    <Fallback name="ParentWithSubTree">',
    '      <SubTree ID="TreeA" _autoremap="true"/>',
    "      <AlwaysFailure/>",
    "    </Fallback>",
    "  </Sequence>",
    "</BehaviorTree>",
    '<BehaviorTree ID="TreeA">',
    "  <Sequence>",
    '    <SubTree ID="TreeB" _autoremap="true"/>',
    "  </Sequence>",
    "</BehaviorTree>",
    '<BehaviorTree ID="TreeB">',
    "  <Sequence>",
    "    <AlwaysSuccess/>",
    "  </Sequence>",
    "</BehaviorTree>"
  ].join("\n");
  const trees = parseBehaviorTreeXml(xmlText);
  assert.equal(trees.length, 3);
  const parentWithSubTree = trees[0].children[0].children[0];
  const nestedReferencedSequence = trees[2].children[0];

  assert.throws(
    () =>
      moveXmlNodeToParentByPath(
        xmlText,
        parentWithSubTree.source.path,
        nestedReferencedSequence.source.path
      ),
    /recursive SubTree reference/
  );
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

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("node:assert/strict");
const test = require("node:test");
const bt_parser_1 = require("../src/bt_parser");
function parseFirstTree(xmlText) {
    const trees = (0, bt_parser_1.parseBehaviorTreeXml)(xmlText);
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
    assert.throws(() => (0, bt_parser_1.parseBehaviorTreeXml)(xmlText), /expected closing tag <\/Sequence> before <\/Fallback>/);
});
test("rejects closing tags without an opening tag", () => {
    const xmlText = [
        '<BehaviorTree ID="MainTree">',
        "  <AlwaysSuccess/>",
        "</BehaviorTree>",
        "</Unexpected>"
    ].join("\n");
    assert.throws(() => (0, bt_parser_1.parseBehaviorTreeXml)(xmlText), /closing tag <\/Unexpected> has no matching opening tag/);
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
    assert.throws(() => (0, bt_parser_1.parseBehaviorTreeXml)(xmlText), /opening tag is missing ">" before the next "<"/);
});
test("rejects unquoted attribute values", () => {
    const xmlText = [
        '<BehaviorTree ID="MainTree">',
        "  <AlwaysSuccess custom_attr=value/>",
        "</BehaviorTree>"
    ].join("\n");
    assert.throws(() => (0, bt_parser_1.parseBehaviorTreeXml)(xmlText), /attribute "custom_attr" value must be quoted/);
});
test("rejects mismatched attribute quotes", () => {
    const xmlText = [
        '<BehaviorTree ID="MainTree">',
        "  <AlwaysSuccess custom_attr='value\"/>",
        "</BehaviorTree>"
    ].join("\n");
    assert.throws(() => (0, bt_parser_1.parseBehaviorTreeXml)(xmlText), /attribute value is missing closing ' quote/);
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
    const result = (0, bt_parser_1.moveXmlNodeByPath)(xmlText, closeDoor.source.path, 2);
    assert.equal(result.xmlText, [
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
    ].join("\n"));
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
    const result = (0, bt_parser_1.insertXmlChildNodeByPath)(xmlText, sequence.source.path, "AlwaysSuccess", {});
    assert.doesNotMatch(result.xmlText, /\n[ \t]*\n/);
    assert.match(result.xmlText, /<Sequence>\n    <AlwaysSuccess\/>\n  <\/Sequence>/);
});
//# sourceMappingURL=bt_parser.test.js.map
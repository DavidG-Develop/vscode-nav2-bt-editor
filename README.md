# Nav2 BT Preview

Nav2 BT Preview is a Visual Studio Code extension for viewing and editing ROS 2 Nav2 and BehaviorTree.CPP XML behavior trees.

It is intended for users who work with Nav2 behavior tree XML files, BehaviorTree.CPP XML files, custom behavior tree nodes, and `TreeNodesModel` node definition files.

## Features

- Preview BehaviorTree.CPP XML files as an interactive graph.
- Show BehaviorTree, Control, Decorator, Action, Condition, and SubTree nodes with distinct visual styles.
- Mark unknown node types directly in the graph.
- Show a warning in the side panel when a node definition is unknown.
- Edit XML attributes from the preview.
- For known nodes, show attributes/ports defined by the node definition.
- Only write non-empty known attributes back into the XML.
- Add custom attributes for unknown nodes.
- Add new child nodes to the XML tree.
- Import external `TreeNodesModel` XML files.
- Import external node definitions from URLs, including GitHub blob URLs.
- Remember imported node definitions between VS Code sessions.
- Remove selected imported node definitions without clearing everything.
- Navigate between separate BehaviorTree definitions.
- Expand and collapse SubTree nodes inline, depending on settings.
- Reveal the selected node in the XML editor.

## Installation

Install the extension from the Visual Studio Code Marketplace:

1. Open Visual Studio Code.
2. Open the Extensions view.
3. Search for `Nav2 BT Preview`.
4. Select the extension.
5. Click Install.

After installation, open a BehaviorTree.CPP XML file and run the preview command.

## Opening a preview

Open a behavior tree XML file and run:

```text
Nav2 BT Preview: Open Preview
```

You can run this from the Command Palette.

You can also right-click an XML file in the Explorer and select:

```text
Nav2 BT Preview: Open Preview
```

## Editing attributes

Click a node in the graph to open the node details panel.

For known nodes, the side panel shows the attributes/ports from the node definition. Fill in the values you want and apply the change. Empty fields are not written to the XML.

For unknown nodes, the side panel shows that the node definition is unknown. Unknown nodes allow manual custom attributes because the extension does not know the expected ports.

## Adding nodes

Click the parent node where you want to add a child.

Use the Add child node section in the details panel.

You can select a known node type or type a custom node name. If the node is known, the extension shows its defined attributes/ports. Non-empty values are written into the XML when the node is added.

If the node is unknown, it is inserted as a basic XML node. You can then select it and add custom attributes manually.

## Unknown nodes

A node is considered unknown when the extension cannot find a matching definition in:

- the current XML file's `TreeNodesModel`
- imported `TreeNodesModel` files
- the built-in BehaviorTree.CPP/Nav2 node catalog

Unknown nodes are marked in the graph and show a warning in the details panel.

To improve classification, import a node definition file.

## Importing node definitions

Many Nav2 and custom BehaviorTree.CPP projects define nodes in a `TreeNodesModel` XML file.

To import such a file, run:

```text
Nav2 BT Preview: Import TreeNodesModel XML File
```

To import from a URL, run:

```text
Nav2 BT Preview: Import TreeNodesModel XML from URL
```

GitHub blob URLs are converted to raw URLs automatically.

Imported definitions are stored by the extension and remembered across VS Code sessions.

If a node name exists both in the built-in catalog and imported definitions, the imported definition takes priority.

## Managing imported definitions

To remove selected imported definitions, run:

```text
Nav2 BT Preview: Remove Imported TreeNode Definition
```

This opens a list of all imported node definitions. Select one or more definitions to remove.

To clear all imported definitions, run:

```text
Nav2 BT Preview: Clear Imported TreeNodesModel Definitions
```

## SubTree navigation and expansion

By default, only one `BehaviorTree` is shown at a time.

Double-click a `SubTree` node to open the referenced `BehaviorTree`.

The toolbar contains:

```text
↑     Go one BehaviorTree up
Top   Go back to the top-level BehaviorTree
Fit   Fit the current graph into the preview
+     Zoom in
-     Zoom out
```

If inline subtree expansion is enabled, subtrees are closed by default. Double-click a `SubTree` to expand it inline. Double-click it again to collapse it.

Nested subtrees are not expanded automatically. Each subtree instance must be expanded manually.

## Settings

### `nav2BtPreview.autoSaveEdits`

Default:

```json
true
```

Automatically save the XML file after applying attribute edits from the preview.

When disabled, the editor buffer is updated but the file remains unsaved until you save it manually.

### `nav2BtPreview.openOnlyOneBehaviorTree`

Default:

```json
true
```

When enabled, only one `BehaviorTree` is shown at a time.

When disabled, `SubTree` nodes can be expanded inline in the same graph.

### `nav2BtPreview.autoFitOnTreeChange`

Default:

```json
true
```

When enabled, the graph view is automatically fitted after opening, closing, or navigating between behavior trees.

When disabled, subtree open and close operations keep the current zoom and pan unchanged.

## Commands

| Command | Description |
|---|---|
| `Nav2 BT Preview: Open Preview` | Open the behavior tree preview for the selected XML file. |
| `Nav2 BT Preview: Import TreeNodesModel XML File` | Import node definitions from a local XML file. |
| `Nav2 BT Preview: Import TreeNodesModel XML from URL` | Import node definitions from a URL. |
| `Nav2 BT Preview: Remove Imported TreeNode Definition` | Show imported definitions and remove selected entries. |
| `Nav2 BT Preview: Clear Imported TreeNodesModel Definitions` | Remove all imported node definitions. |

## Relationship to other projects

Nav2 BT Preview is an independent Visual Studio Code extension for BehaviorTree.CPP-style XML behavior trees, with a focus on ROS 2 and Nav2 workflows.

It is not affiliated with or endorsed by Groot, Groot2, BehaviorTree.CPP, Open Navigation LLC, or the Navigation2 project.

The extension does not bundle Groot, Groot2, BehaviorTree.CPP, or Nav2 source code. It uses a built-in catalog of common BehaviorTree.CPP and Nav2 node names and can import external `TreeNodesModel` XML files to improve visualization of custom nodes.

## License

See the repository `LICENSE` file.
# Nav2 Behavior Tree Editor for VS Code

Nav2 BT Editor is a Visual Studio Code extension for editing ROS 2 Nav2 and BehaviorTree.CPP XML behavior trees as an interactive graph.

It is built for developers who work directly with Nav2 BT XML files, custom BehaviorTree.CPP nodes, `TreeNodesModel` definitions, and reusable SubTree definitions.

## Install

Install **Nav2 BT Editor** from the Visual Studio Code Marketplace.

1. Open Visual Studio Code.
2. Open the Extensions view.
3. Search for `Nav2 BT Editor`.
4. Select the extension.
5. Click Install.

After installation, open a BehaviorTree.CPP XML file and run:

```text
Nav2 BT Editor: Open Editor
```

You can also right-click an XML file in the Explorer and select the same command.

## Demo

<!-- Add the recorded demo GIF at docs/nav2-bt-editor-demo.gif before publishing. Suggested capture: open a Nav2 BT XML file, move a child node before another child, edit an attribute, and add an imported SubTree. -->

![Nav2 BT Editor demo: moving nodes, editing attributes, and adding a SubTree](docs/nav2-bt-editor-demo.gif)

## What it does

- Renders BehaviorTree.CPP XML as an interactive tree graph.
- Edits node attributes and writes the changes back into the XML file.
- Adds new child nodes from known BehaviorTree.CPP/Nav2 node types or custom XML tag names.
- Reorders sibling nodes by dragging them in the graph and updates XML child order.
- Deletes nodes, including referenced nested BehaviorTree definitions when requested.
- Imports `TreeNodesModel` XML files from local files or URLs.
- Imports external `BehaviorTree` XML files as reusable SubTree templates.
- Inserts imported SubTrees either as a reference-only `<SubTree ID="..." _autoremap="true" />` node or with the full referenced `BehaviorTree` XML.
- Navigates between separate `BehaviorTree` definitions.
- Expands or collapses SubTree nodes inline when configured.
- Highlights unknown node types in the graph and details panel.
- Detects malformed XML structure that would otherwise make leaf nodes appear to have children.

The extension edits XML. It does not execute behavior trees, tick nodes, connect to ROS 2, or replace runtime validation in Nav2.

## BehaviorTree.CPP and Nav2 compatibility

The editor is XML-focused and is intended to work with common Nav2 behavior trees using BehaviorTree.CPP 3.8-style and 4.x-style XML.

Supported XML patterns include:

- `BehaviorTree` roots with `ID` attributes
- `root BTCPP_format="4"` metadata
- `SubTree` and `SubTreePlus`
- common BehaviorTree.CPP controls, decorators, actions, and conditions
- Nav2 BT plugin node names from the built-in catalog
- custom nodes imported from `TreeNodesModel`
- BehaviorTree.CPP 4.x scripting and pre/post-condition attributes as normal XML attributes

Version-specific runtime semantics are not enforced. Unknown tags and unknown attributes are preserved so custom Nav2 plugins and project-specific ports remain editable.

## Editing nodes

Click a node in the graph to open its details panel.

For known nodes, the panel shows attributes/ports from the built-in catalog, the current XML file's `TreeNodesModel`, and imported `TreeNodesModel` files. Non-empty values are written back to XML by default.

For unknown nodes, the editor allows manual custom attributes because it cannot know the expected ports.

## Adding nodes

Select a parent node and use the add-child controls in the details panel.

You can choose a known node type or type a custom tag name. Known nodes expose their configured ports. Unknown nodes are inserted as basic XML nodes and can be edited afterward.

When adding a `SubTree`, imported `BehaviorTree` templates appear in the SubTree list. Selecting one fills `ID` and `_autoremap="true"`.

By default, imported BehaviorTrees are inserted as a reference-only SubTree node:

```xml
<SubTree ID="InitTree" _autoremap="true" />
```

Enable `nav2BtEditor.includeFullBehaviorTree` if you want the editor to also copy the full referenced `BehaviorTree` XML into the current file.

## Moving nodes

Drag a node horizontally relative to its siblings to reorder it.

When the node is dropped before or after another child under the same parent, the XML child order is updated to match the graph order.

Root XML nodes cannot be reordered from the editor.

## Importing node definitions

Many Nav2 and custom BehaviorTree.CPP projects define node ports in a `TreeNodesModel` XML file.

Use:

```text
Nav2 BT Editor: Import TreeNodesModel XML File
```

or:

```text
Nav2 BT Editor: Import TreeNodesModel XML from URL
```

GitHub blob URLs are converted to raw URLs automatically.

Imported definitions are stored by VS Code and remembered across sessions. If a node name exists in both the built-in catalog and imported definitions, the imported definition takes priority.

## Importing SubTree templates

External `BehaviorTree` XML files can be imported and reused when adding `SubTree` nodes.

Use:

```text
Nav2 BT Editor: Import BehaviorTree XML as SubTree
```

or:

```text
Nav2 BT Editor: Import BehaviorTree XML as SubTree from URL
```

Each complete `BehaviorTree` with an `ID` is stored as a reusable template. Imported templates are remembered across VS Code sessions.

If `nav2BtEditor.includeFullBehaviorTree` is enabled and the selected template references other imported BehaviorTrees through nested SubTrees, those nested templates are inserted too.

## Managing imports

Use these commands to remove imported definitions without editing your source XML files:

```text
Nav2 BT Editor: Remove Imported TreeNode Definition
Nav2 BT Editor: Clear Imported TreeNodesModel Definitions
Nav2 BT Editor: Remove Imported BehaviorTree SubTree
Nav2 BT Editor: Clear Imported BehaviorTree SubTrees
```

## SubTree navigation

By default, the editor shows one `BehaviorTree` at a time.

Double-click a `SubTree` node to open the referenced `BehaviorTree` when that target exists in the current XML file. Missing or reference-only imported SubTrees do not show the double-click hint.

Toolbar controls:

```text
Up    Go one BehaviorTree up
Top   Go back to the top-level BehaviorTree
Fit   Fit the current graph into view
+     Zoom in
-     Zoom out
```

If inline SubTree expansion is enabled, double-clicking a SubTree expands or collapses it inside the current graph.

## Settings

### `nav2BtEditor.autoSaveEdits`

Default:

```json
true
```

Automatically save the XML file after applying edits from the graph.

When disabled, the editor buffer is updated but the file remains unsaved until you save it manually.

### `nav2BtEditor.allowEmptyAttributes`

Default:

```json
false
```

Allow empty XML attributes when applying edits. When disabled, empty attributes are removed from the XML.

### `nav2BtEditor.openOnlyOneBehaviorTree`

Default:

```json
true
```

Show only one `BehaviorTree` at a time. When disabled, SubTree nodes can be expanded inline.

### `nav2BtEditor.autoFitOnTreeChange`

Default:

```json
true
```

Automatically fit the graph view after opening, closing, or navigating between BehaviorTrees.

### `nav2BtEditor.includeFullBehaviorTree`

Default:

```json
false
```

When enabled, adding an imported BehaviorTree as a `SubTree` also inserts the full referenced `BehaviorTree` XML into the current file.

When disabled, only the `SubTree` reference is inserted. This is the default because it keeps the current file small and avoids silently duplicating imported tree definitions.

## Commands

| Command | Description |
|---|---|
| `Nav2 BT Editor: Open Editor` | Open the visual behavior tree editor for the selected XML file. |
| `Nav2 BT Editor: Import TreeNodesModel XML File` | Import node definitions from a local XML file. |
| `Nav2 BT Editor: Import TreeNodesModel XML from URL` | Import node definitions from a URL. |
| `Nav2 BT Editor: Import BehaviorTree XML as SubTree` | Import BehaviorTree definitions from a local XML file as SubTree templates. |
| `Nav2 BT Editor: Import BehaviorTree XML as SubTree from URL` | Import BehaviorTree definitions from a URL as SubTree templates. |
| `Nav2 BT Editor: Remove Imported TreeNode Definition` | Show imported definitions and remove selected entries. |
| `Nav2 BT Editor: Clear Imported TreeNodesModel Definitions` | Remove all imported node definitions. |
| `Nav2 BT Editor: Remove Imported BehaviorTree SubTree` | Show imported SubTree templates and remove selected entries. |
| `Nav2 BT Editor: Clear Imported BehaviorTree SubTrees` | Remove all imported SubTree templates. |

The extension command IDs use the `nav2-bt-editor.*` namespace, and settings use the `nav2BtEditor.*` namespace.

## Relationship to other projects

Nav2 BT Editor is an independent Visual Studio Code extension for BehaviorTree.CPP-style XML behavior trees, with a focus on ROS 2 and Nav2 workflows.

It is not affiliated with or endorsed by Groot, Groot2, BehaviorTree.CPP, Open Navigation LLC, or the Navigation2 project.

The extension does not bundle Groot, Groot2, BehaviorTree.CPP, or Nav2 source code. It uses a built-in catalog of common BehaviorTree.CPP and Nav2 node names and can import external `TreeNodesModel` XML files to improve visualization and editing of custom nodes.

## License

See the repository `LICENSE` file.

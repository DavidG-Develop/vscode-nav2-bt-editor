# Nav2 BT Preview

Nav2 BT Preview is a Visual Studio Code extension for previewing and lightly editing ROS 2 Nav2 and BehaviorTree.CPP XML behavior trees.

The extension renders behavior tree XML files as an interactive graph inside VS Code. It is intended for robotics developers working with Nav2 behavior trees, custom BehaviorTree.CPP nodes, and XML files containing `TreeNodesModel` definitions.

## Features

- Preview BehaviorTree.CPP-style XML files as an SVG graph.
- Show BehaviorTree, Control, Decorator, Action, and Condition nodes with different visual styles.
- Display node attributes in a side panel.
- Edit existing XML attributes directly from the preview.
- Add new XML attributes to nodes.
- Reveal the selected node in the XML editor.
- Parse `TreeNodesModel` sections inside the current XML file.
- Import external `TreeNodesModel` XML files and remember the imported node definitions.
- Import node definitions from a URL, including GitHub blob URLs.
- List and remove individual imported node definitions.
- Navigate between separate `BehaviorTree` definitions.
- Expand and collapse `SubTree` nodes inline when configured.
- Preserve or auto-fit the graph view depending on settings.

## Usage

Open an XML behavior tree file, then run:

```text
Nav2 BT Preview: Open Preview
```

You can run the command from the Command Palette or from the XML editor title/context menu.

Click a node in the graph to show its details. The side panel shows:

- node type
- node category
- node name, if available
- XML source preview
- editable attributes
- add-attribute controls

Click `Apply` after editing an attribute to update the XML file.

## Importing external node definitions

Many Nav2 behavior tree XML files use custom nodes whose category cannot be inferred from the node tag alone. For example, a custom XML node may look like this:

```xml
<IsDoorClosed door_id="{door_id}"/>
```

The node itself does not say whether it is an action, condition, decorator, or control node. That information is normally available in a `TreeNodesModel` XML file.

You can import such definitions with:

```text
Nav2 BT Preview: Import TreeNodesModel XML File
```

or:

```text
Nav2 BT Preview: Import TreeNodesModel XML from URL
```

For example, you can import a Nav2-style `nav2_tree_nodes.xml` file. GitHub blob URLs are converted to raw URLs automatically.

Imported definitions are stored in VS Code extension global storage and are remembered between sessions. Imported definitions take priority over the built-in hardcoded catalog.

To remove all imported definitions, run:

```text
Nav2 BT Preview: Clear Imported TreeNodesModel Definitions
```

To remove individual imported definitions, run:

```text
Nav2 BT Preview: Remove Imported TreeNode Definition
```

This opens a list of imported node definitions. Select one or more entries to remove them.

## SubTree behavior

By default, the extension shows only one `BehaviorTree` at a time.

When a graph contains a `SubTree` node, double-clicking the `SubTree` opens the referenced `BehaviorTree`. The previously open tree is closed. Use the toolbar buttons to navigate:

```text
↑   Go one BehaviorTree up
Top Go back to the top-level BehaviorTree
```

You can also configure the extension to allow inline subtree expansion.

## Settings

### `nav2BtPreview.autoSaveEdits`

Default:

```json
true
```

When enabled, XML files are saved automatically after applying attribute edits from the preview.

When disabled, the editor buffer is updated but the file remains unsaved until you save it manually.

### `nav2BtPreview.openOnlyOneBehaviorTree`

Default:

```json
true
```

When enabled, only one `BehaviorTree` is shown at a time. Double-clicking a `SubTree` opens the referenced tree.

When disabled, `SubTree` nodes can be expanded inline in the same graph. Subtrees are still closed by default. Double-click a `SubTree` to expand it, and double-click it again to collapse it.

Nested subtrees are not expanded automatically. Each subtree instance must be expanded manually.

### `nav2BtPreview.autoFitOnTreeChange`

Default:

```json
true
```

When enabled, the graph view is automatically fitted after opening, closing, or navigating between behavior trees.

When disabled, subtree open and close operations keep the current zoom and pan unchanged.

## Example settings

```json
{
  "nav2BtPreview.autoSaveEdits": true,
  "nav2BtPreview.openOnlyOneBehaviorTree": true,
  "nav2BtPreview.autoFitOnTreeChange": true
}
```

For inline subtree expansion without automatic zoom or pan changes:

```json
{
  "nav2BtPreview.openOnlyOneBehaviorTree": false,
  "nav2BtPreview.autoFitOnTreeChange": false
}
```

## Development

Install dependencies:

```bash
npm install
```

Compile:

```bash
npm run compile
```

Run the extension in the Extension Development Host:

```text
F5
```

Package the extension:

```bash
npm run package
```

## Project status

This extension is experimental and currently focused on previewing and simple XML attribute editing. It is not yet a full behavior tree editor.

Planned or possible future improvements include:

- drag-and-drop node editing
- adding and removing nodes
- better port visualization
- better subtree navigation breadcrumbs
- workspace-level custom node definition files
- validation against BehaviorTree.CPP XML schemas
- improved Nav2 node catalog coverage

## Relationship to other projects

This extension is an independent VS Code previewer for BehaviorTree.CPP-style XML behavior trees, with a focus on ROS 2 and Nav2 workflows.

It is not affiliated with or endorsed by Groot, Groot2, BehaviorTree.CPP, Open Navigation LLC, or the Navigation2 project.

The extension does not bundle Groot, Groot2, BehaviorTree.CPP, or Nav2 source code. It uses a built-in catalog of common BehaviorTree.CPP and Nav2 node names, and it can import external `TreeNodesModel` XML files to improve visualization of custom nodes.

## License

See the repository `LICENSE` file.
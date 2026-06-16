const nodes = window.initialBtNodes ?? [];

let selectedNodeId = undefined;

const treeContainer = document.getElementById("tree");
const detailsContainer = document.getElementById("details");

function renderTree() {
  treeContainer.innerHTML = "";

  if (nodes.length === 0) {
    treeContainer.textContent = "No BehaviorTree nodes found.";
    return;
  }

  for (const node of nodes) {
    treeContainer.appendChild(renderNode(node));
  }
}

function renderNode(node) {
  const wrapper = document.createElement("div");
  wrapper.className = "bt-node";

  const label = document.createElement("div");
  label.className = "bt-node-label";

  if (node.id === selectedNodeId) {
    label.classList.add("selected");
  }

  label.textContent = getNodeLabel(node);

  label.addEventListener("click", (event) => {
    event.stopPropagation();
    selectedNodeId = node.id;
    renderDetails(node);
    renderTree();
  });

  wrapper.appendChild(label);

  if (node.children && node.children.length > 0) {
    const children = document.createElement("div");
    children.className = "bt-node-children";

    for (const child of node.children) {
      children.appendChild(renderNode(child));
    }

    wrapper.appendChild(children);
  }

  return wrapper;
}

function getNodeLabel(node) {
  if (node.name && node.name !== node.tag) {
    return `${node.tag}: ${node.name}`;
  }

  return node.tag;
}

function renderDetails(node) {
  const attrs = node.attributes ?? {};

  const rows = Object.entries(attrs)
    .map(([key, value]) => {
      return `
        <tr>
          <td class="attr-name">${escapeHtml(key)}</td>
          <td>${escapeHtml(String(value))}</td>
        </tr>
      `;
    })
    .join("");

  detailsContainer.classList.remove("empty");

  detailsContainer.innerHTML = `
    <p><strong>Type:</strong> ${escapeHtml(node.tag)}</p>
    ${
      node.name
        ? `<p><strong>Name:</strong> ${escapeHtml(node.name)}</p>`
        : ""
    }

    <h3>Attributes</h3>
    ${
      rows.length > 0
        ? `<table class="attr-table">${rows}</table>`
        : `<p class="empty">No attributes on this node.</p>`
    }
  `;
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

renderTree();

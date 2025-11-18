let entitiesData = [];
let schemaData = null;
let currentView = "overview";
let selectedEntityType = null;
let hideNamespacePrefix = false;
let hasNamespace = false;

// File upload handlers
document
  .getElementById("schema-upload")
  .addEventListener("change", handleSchemaUpload);
document
  .getElementById("entities-upload")
  .addEventListener("change", handleEntitiesUpload);

function handleSchemaUpload(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;

      // Check file extension to determine format
      const isJsonFormat = file.name.endsWith('.json');

      if (isJsonFormat) {
        try {
          const jsonSchema = JSON.parse(content);
          parseJsonSchema(jsonSchema);
        } catch (error) {
          alert("Error parsing JSON schema: " + error.message);
          return;
        }
      } else {
        // Treat as Cedar schema format (.cedarschema)
        parseSchema(content);
      }

      updateView();
    };
    reader.readAsText(file);
  }
} function handleEntitiesUpload(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rawData = JSON.parse(e.target.result);
        entitiesData = normalizeEntities(rawData);
        updateView();
      } catch (error) {
        alert("Error parsing entities JSON: " + error.message);
      }
    };
    reader.readAsText(file);
  }
}

function normalizeEntities(entities) {
  // Normalize entities to handle both formats:
  // Format 1: { "uid": { "type": "...", "id": "..." }, ... }
  // Format 2: { "uid": { "__entity": { "type": "...", "id": "..." } }, ... }
  return entities.map(entity => {
    const normalizedEntity = { ...entity };

    // Normalize uid
    if (entity.uid && entity.uid.__entity) {
      normalizedEntity.uid = {
        type: entity.uid.__entity.type,
        id: entity.uid.__entity.id
      };
    }

    // Normalize parents
    if (entity.parents && Array.isArray(entity.parents)) {
      normalizedEntity.parents = entity.parents.map(parent => {
        if (parent.__entity) {
          return {
            type: parent.__entity.type,
            id: parent.__entity.id
          };
        }
        return parent;
      });
    }

    return normalizedEntity;
  });
}

function parseSchema(schemaText) {
  schemaData = {
    raw: schemaText,
    entities: [],
    actions: [],
  };

  // Check if schema has namespace declaration (e.g., "namespace MyApp { ... }")
  hasNamespace = /namespace\s+[\w:]+\s*{/.test(schemaText);

  // Parse entity declarations
  const entityMatches = schemaText.matchAll(
    /entity\s+([\w,\s]+)(?:\s+in\s+\[([\w,\s]+)\])?;/g
  );
  for (const match of entityMatches) {
    const entities = match[1].split(",").map((e) => e.trim());
    const parents = match[2]
      ? match[2].split(",").map((p) => p.trim())
      : [];
    entities.forEach((entity) => {
      schemaData.entities.push({
        name: entity,
        possibleParents: parents,
      });
    });
  }

  // Parse action declarations
  const actionMatches = schemaText.matchAll(
    /action\s+([\w,\s]+)\s+appliesTo\s*{([^}]+)}/gs
  );
  for (const match of actionMatches) {
    const actions = match[1].split(",").map((a) => a.trim());
    const appliesTo = match[2];

    const principalMatch = appliesTo.match(/principal:\s*\[([^\]]+)\]/);
    const resourceMatch = appliesTo.match(/resource:\s*\[([^\]]+)\]/);
    const contextMatch = appliesTo.match(/context:\s*{([^}]+)}/s);

    const actionInfo = {
      principals: principalMatch
        ? principalMatch[1].split(",").map((p) => p.trim())
        : [],
      resources: resourceMatch
        ? resourceMatch[1].split(",").map((r) => r.trim())
        : [],
      context: contextMatch ? contextMatch[1].trim() : "",
    };

    actions.forEach((action) => {
      schemaData.actions.push({ name: action, ...actionInfo });
    });
  }
}

function parseJsonSchema(schemaJson) {
  schemaData = {
    raw: JSON.stringify(schemaJson, null, 2),
    entities: [],
    actions: [],
  };

  // Check if schema has non-empty namespace
  hasNamespace = Object.keys(schemaJson).some(namespace => namespace !== "");

  // Iterate through all namespaces in the JSON schema
  for (const [namespace, namespaceContent] of Object.entries(schemaJson)) {
    // Parse entity types
    if (namespaceContent.entityTypes) {
      for (const [entityName, entityDef] of Object.entries(
        namespaceContent.entityTypes
      )) {
        const fullEntityName =
          namespace === "" ? entityName : `${namespace}::${entityName}`;
        schemaData.entities.push({
          name: fullEntityName,
          possibleParents: entityDef.memberOfTypes || [],
          shape: entityDef.shape || null,
        });
      }
    }

    // Parse actions
    if (namespaceContent.actions) {
      for (const [actionName, actionDef] of Object.entries(
        namespaceContent.actions
      )) {
        const fullActionName =
          namespace === ""
            ? `Action::"${actionName}"`
            : `${namespace}::Action::"${actionName}"`;

        const actionInfo = {
          name: fullActionName,
          principals: actionDef.appliesTo?.principalTypes || [],
          resources: actionDef.appliesTo?.resourceTypes || [],
          context: actionDef.appliesTo?.context
            ? JSON.stringify(actionDef.appliesTo.context, null, 2)
            : "",
          memberOf: actionDef.memberOf || [],
        };

        schemaData.actions.push(actionInfo);
      }
    }
  }
}

async function loadSampleData() {
  try {
    // Load schema (sample data uses .cedarschema format)
    const schemaResponse = await fetch("schema.cedarschema");
    const schemaText = await schemaResponse.text();
    parseSchema(schemaText);

    // Load entities
    const entitiesResponse = await fetch("entities.json");
    const rawEntities = await entitiesResponse.json();
    entitiesData = normalizeEntities(rawEntities);

    updateView();
  } catch (error) {
    alert("Error loading sample data: " + error.message);
  }
}

function stripNamespace(fullName) {
  if (!hideNamespacePrefix) return fullName;

  // Remove namespace prefix (e.g., "HealthCareApp::User" -> "User")
  // Also handles Action entities (e.g., "HealthCareApp::Action::\"create\"" -> "\"create\"")
  const parts = fullName.split('::');
  if (parts.length > 1) {
    // If it's an action, return the last part (the action name)
    if (parts.includes('Action')) {
      return parts[parts.length - 1];
    }
    // Otherwise return the last part (entity type)
    return parts[parts.length - 1];
  }
  return fullName;
}

function toggleNamespacePrefix() {
  const checkbox = document.getElementById('toggle-namespace-checkbox');
  hideNamespacePrefix = !checkbox.checked;
  updateView();
}

function switchView(view) {
  currentView = view;
  selectedEntityType = null;
  document
    .querySelectorAll(".view-btn")
    .forEach((btn) => btn.classList.remove("active"));
  event.target.classList.add("active");

  updateView();
}

function selectEntityType(type) {
  selectedEntityType = type;
  updateView();
}

function jumpToEntityType(type) {
  selectedEntityType = type;
  currentView = "by-type";
  document
    .querySelectorAll(".view-btn")
    .forEach((btn) => btn.classList.remove("active"));
  document.querySelectorAll(".view-btn").forEach((btn) => {
    if (btn.textContent.includes("By Entity Type")) {
      btn.classList.add("active");
    }
  });
  updateView();
}

function backToTypeSelection() {
  selectedEntityType = null;
  updateView();
}

function filterTypes() {
  const searchTerm = document
    .getElementById("type-search")
    .value.toLowerCase();
  document.querySelectorAll(".entity-type-btn").forEach((btn) => {
    const text = btn.textContent.toLowerCase();
    btn.style.display = text.includes(searchTerm) ? "block" : "none";
  });
}

function updateView() {
  const contentArea = document.getElementById("content-area");

  // Show/hide namespace toggle only if schema has a namespace
  const toggleSection = document.getElementById("namespace-toggle-section");
  if (toggleSection) {
    toggleSection.style.display = hasNamespace ? "block" : "none";
  }

  if (entitiesData.length === 0 && !schemaData) {
    contentArea.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📁</div>
                    <h2>No Data Loaded</h2>
                    <p>Upload your Cedar schema and entities files, or load the sample data to get started.</p>
                </div>
            `;
    return;
  }

  switch (currentView) {
    case "overview":
      renderOverview();
      break;
    case "by-type":
      renderByType();
      break;
    case "hierarchy":
      renderHierarchy();
      break;
    case "schema":
      renderSchema();
      break;
  }
}

function renderOverview() {
  const types = {};
  entitiesData.forEach((entity) => {
    const type = entity.uid.type;
    types[type] = (types[type] || 0) + 1;
  });

  const statsHtml = Object.entries(types)
    .map(
      ([type, count]) => `
                <div class="stat-card" onclick="jumpToEntityType('${type}')">
                    <div class="stat-number">${count}</div>
                    <div class="stat-label">${stripNamespace(type)}</div>
                </div>
            `
    )
    .join("");

  const totalEntities = entitiesData.length;
  const totalTypes = Object.keys(types).length;

  document.getElementById("content-area").innerHTML = `
            <h2 style="margin-bottom: 20px;">📊 Overview</h2>
            
            <div class="stats-grid">
                <div class="stat-card non-clickable">
                    <div class="stat-number">${totalEntities}</div>
                    <div class="stat-label">Total Entities</div>
                </div>
                <div class="stat-card non-clickable">
                    <div class="stat-number">${totalTypes}</div>
                    <div class="stat-label">Entity Types</div>
                </div>
                ${schemaData
      ? `
                    <div class="stat-card non-clickable">
                        <div class="stat-number">${schemaData.actions.length}</div>
                        <div class="stat-label">Actions</div>
                    </div>
                `
      : ""
    }
            </div>

            <h3 style="margin: 30px 0 15px 0;">Entity Distribution (click to view)</h3>
            <div class="stats-grid">
                ${statsHtml}
            </div>
        `;
}

function renderByType() {
  if (!selectedEntityType) {
    // Show entity type selector
    const types = {};
    entitiesData.forEach((entity) => {
      const type = entity.uid.type;
      types[type] = (types[type] || 0) + 1;
    });

    const typeButtonsHtml = Object.entries(types)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([type, count]) =>
          `<button class="entity-type-btn" onclick="selectEntityType('${type}')">${stripNamespace(type)} (${count})</button>`
      )
      .join("");

    document.getElementById("content-area").innerHTML = `
                <h2 style="margin-bottom: 20px;">🏷️ Select Entity Type</h2>
                <input
                  type="text"
                  class="search-box"
                  id="type-search"
                  placeholder="Search entity types..."
                  onkeyup="filterTypes()"
                />
                <div class="entity-type-list" id="entity-types-list">
                    ${typeButtonsHtml}
                </div>
            `;
    return;
  }

  const entities = entitiesData.filter(
    (e) => e.uid.type === selectedEntityType
  );

  const entitiesHtml = entities
    .map((entity) => renderEntityCard(entity))
    .join("");

  document.getElementById("content-area").innerHTML = `
            <div style="display: flex; align-items: center; margin-bottom: 20px;">
                <button onclick="backToTypeSelection()" style="background: #6c757d; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; margin-right: 15px; font-weight: 600;">← Back</button>
                <h2 style="margin: 0;">🏷️ ${stripNamespace(selectedEntityType)} (${entities.length})</h2>
            </div>
            ${entitiesHtml}
        `;
}

function formatAttributeValue(value) {
  // Handle entity references
  if (value && typeof value === 'object' && value.__entity) {
    return `<span class="entity-ref">🔗 ${stripNamespace(value.__entity.type)}::${value.__entity.id}</span>`;
  }

  // Handle sets
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(v => formatAttributeValue(v)).join(', ');
    return `[${items}]`;
  }

  // Handle records (nested objects)
  if (value && typeof value === 'object' && !value.__entity) {
    const entries = Object.entries(value)
      .map(([k, v]) => `${k}: ${formatAttributeValue(v)}`)
      .join(', ');
    return `{${entries}}`;
  }

  // Handle primitives
  return JSON.stringify(value);
}

function renderEntityCard(entity) {
  const parentsHtml =
    entity.parents && entity.parents.length > 0
      ? `<div class="section">
                <div class="section-title">👥 Parents</div>
                ${entity.parents
        .map(
          (p) => `<div class="list-item">${stripNamespace(p.type)}::${p.id}</div>`
        )
        .join("")}
               </div>`
      : "";

  const attrsHtml =
    entity.attrs && Object.keys(entity.attrs).length > 0
      ? `<div class="section">
                <div class="section-title">⚙️ Attributes</div>
                ${Object.entries(entity.attrs)
        .map(
          ([key, value]) =>
            `<div class="attr-item">
                        <span class="attr-key">${key}:</span>
                        <span class="attr-value">${formatAttributeValue(value)}</span>
                     </div>`
        )
        .join("")}
               </div>`
      : "";

  // Find children
  const children = entitiesData.filter(
    (e) =>
      e.parents &&
      e.parents.some(
        (p) => p.type === entity.uid.type && p.id === entity.uid.id
      )
  );

  const childrenHtml =
    children.length > 0
      ? `<div class="section">
                <div class="section-title">👶 Children</div>
                ${children
        .map(
          (c) =>
            `<div class="list-item">${stripNamespace(c.uid.type)}::${c.uid.id}</div>`
        )
        .join("")}
               </div>`
      : "";

  return `
            <div class="entity-card">
                <div class="entity-header">
                    <div class="entity-id">${entity.uid.id}</div>
                    <div class="entity-type-badge">${stripNamespace(entity.uid.type)}</div>
                </div>
                ${parentsHtml}
                ${childrenHtml}
                ${attrsHtml}
            </div>
        `;
}

function renderHierarchy() {
  const rootEntities = entitiesData.filter(
    (e) => !e.parents || e.parents.length === 0
  );

  const hierarchyHtml = rootEntities
    .map((entity) => renderHierarchyNode(entity))
    .join("");

  document.getElementById("content-area").innerHTML = `
            <h2 style="margin-bottom: 20px;">🌳 Entity Hierarchy</h2>
            <p style="margin-bottom: 20px; color: #6c757d;">Showing entities and their parent-child relationships</p>
            ${hierarchyHtml}
        `;
}

function renderHierarchyNode(entity, visited = new Set()) {
  const key = `${entity.uid.type}::${entity.uid.id}`;

  if (visited.has(key)) {
    return `<div class="tree-node">🔄 ${key} (circular reference)</div>`;
  }

  visited.add(key);

  const children = entitiesData.filter(
    (e) =>
      e.parents &&
      e.parents.some(
        (p) => p.type === entity.uid.type && p.id === entity.uid.id
      )
  );

  const hasChildren = children.length > 0;
  const nodeId = `node-${key.replace(/[^a-zA-Z0-9]/g, "-")}`;

  const childrenHtml =
    children.length > 0
      ? `<div class="tree-children" id="${nodeId}-children">
                ${children
        .map((c) => renderHierarchyNode(c, new Set(visited)))
        .join("")}
               </div>`
      : "";

  return `
            <div class="tree-node" onclick="toggleTreeNode(event, '${nodeId}')">
                <div class="tree-node-header">
                    ${hasChildren
      ? '<span class="tree-toggle">▼</span>'
      : '<span class="tree-toggle" style="visibility: hidden;">▼</span>'
    }
                    <span><strong>${stripNamespace(entity.uid.type)}::</strong>${entity.uid.id
    }</span>
                </div>
                ${childrenHtml}
            </div>
        `;
}

function toggleTreeNode(event, nodeId) {
  event.stopPropagation();
  const childrenEl = document.getElementById(`${nodeId}-children`);
  const toggleEl = event.currentTarget.querySelector(".tree-toggle");

  if (childrenEl) {
    childrenEl.classList.toggle("collapsed");
    toggleEl.classList.toggle("collapsed");
  }
}

function renderSchema() {
  if (!schemaData) {
    document.getElementById("content-area").innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📜</div>
                    <h2>No Schema Loaded</h2>
                    <p>Upload a Cedar schema file to view its structure.</p>
                </div>
            `;
    return;
  }

  const entitiesHtml = schemaData.entities
    .map(
      (e) => `
            <div class="list-item">
                <strong>${stripNamespace(e.name)}</strong>
                ${e.possibleParents.length > 0
          ? ` → can be in [${e.possibleParents.map(p => stripNamespace(p)).join(", ")}]`
          : ""
        }
            </div>
        `
    )
    .join("");

  const actionsHtml = schemaData.actions
    .map(
      (action) => `
            <div class="action-item">
                <div class="action-name">🎬 ${stripNamespace(action.name)}</div>
                <div class="action-detail"><strong>Principals:</strong> ${action.principals.map(p => stripNamespace(p)).join(
        ", "
      )}</div>
                <div class="action-detail"><strong>Resources:</strong> ${action.resources.map(r => stripNamespace(r)).join(
        ", "
      )}</div>
                ${action.context
          ? `<div class="action-detail"><strong>Context:</strong><div class="context-detail">${action.context}</div></div>`
          : ""
        }
            </div>
        `
    )
    .join("");

  document.getElementById("content-area").innerHTML = `
            <h2 style="margin-bottom: 20px;">📜 Schema Structure</h2>
            
            <div class="schema-section">
                <div class="schema-title">Entity Types (${schemaData.entities.length})</div>
                ${entitiesHtml}
            </div>

            <div class="schema-section">
                <div class="schema-title">Actions (${schemaData.actions.length})</div>
                ${actionsHtml}
            </div>

            <div class="schema-section">
                <div class="schema-title">Raw Schema</div>
                <pre>${schemaData.raw}</pre>
            </div>
        `;
}

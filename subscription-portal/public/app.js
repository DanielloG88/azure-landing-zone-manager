import { getDisplayProjectName } from "./projectName.js";

const $ = (sel) => document.querySelector(sel);
const SUMMARY_COLUMNS = ["project_name", "environment", "management_group_id", "location", "owner", "cost-center"];
const ACCESS_GROUP_ROLES = [
  {
    key: "owner",
    enabledField: "subOwnerGroupEnabled",
    nameField: "subOwnerGroupName",
    membersField: "subOwnerMembers",
    csvEnabledField: "sub_owner_group_enabled",
    csvNameField: "sub_owner_group_name",
    csvMembersField: "sub_owner_members"
  },
  {
    key: "contributor",
    enabledField: "subContributorGroupEnabled",
    nameField: "subContributorGroupName",
    membersField: "subContributorMembers",
    csvEnabledField: "sub_contributor_group_enabled",
    csvNameField: "sub_contributor_group_name",
    csvMembersField: "sub_contributor_members"
  },
  {
    key: "reader",
    enabledField: "subReaderGroupEnabled",
    nameField: "subReaderGroupName",
    membersField: "subReaderMembers",
    csvEnabledField: "sub_reader_group_enabled",
    csvNameField: "sub_reader_group_name",
    csvMembersField: "sub_reader_members"
  }
];
let appConfig = null;
const bearerAuthState = {
  client: null,
  settings: null,
  initPromise: null
};

function getBearerConfig(config) {
  const bearer = config?.auth?.bearer ?? {};
  const scopes = Array.isArray(bearer.scopes) ? bearer.scopes.filter(Boolean) : [];
  return {
    enabled: bearer.enabled === true,
    clientId: String(bearer.clientId ?? "").trim(),
    tenantId: String(bearer.tenantId ?? "").trim(),
    scopes
  };
}

async function initBearerAuth(config) {
  const settings = getBearerConfig(config);
  if (!settings.enabled) return null;

  if (!settings.clientId || !settings.tenantId || settings.scopes.length === 0) {
    throw new Error("Bearer auth enabled but missing clientId/tenantId/scopes.");
  }
  const msal = window.msal;
  if (!msal?.PublicClientApplication) {
    throw new Error("MSAL browser library not loaded.");
  }

  bearerAuthState.settings = settings;
  if (!bearerAuthState.initPromise) {
    bearerAuthState.initPromise = (async () => {
      const authority = `https://login.microsoftonline.com/${settings.tenantId}`;
      let authorityHost = "login.microsoftonline.com";
      try {
        authorityHost = new URL(authority).host;
      } catch {
        // Fall back to the default host if URL parsing fails.
      }
      bearerAuthState.client = new msal.PublicClientApplication({
        auth: {
          clientId: settings.clientId,
          authority,
          knownAuthorities: [authorityHost],
          redirectUri: new URL("./", window.location.href).href
        },
        cache: {
          cacheLocation: "localStorage",
          storeAuthStateInCookie: false
        }
      });

      const response = await bearerAuthState.client.handleRedirectPromise();
      if (response?.account) {
        bearerAuthState.client.setActiveAccount(response.account);
      }
    })();
  }

  await bearerAuthState.initPromise;
  return bearerAuthState.client;
}

async function getBearerToken(config) {
  const settings = getBearerConfig(config);
  if (!settings.enabled) return null;

  const client = await initBearerAuth(config);
  const account = client.getActiveAccount() || client.getAllAccounts()[0];

  if (!account) {
    await client.loginRedirect({ scopes: settings.scopes });
    return null;
  }

  try {
    const tokenResponse = await client.acquireTokenSilent({ scopes: settings.scopes, account });
    return tokenResponse.accessToken;
  } catch (err) {
    const msal = window.msal;
    const requiresInteraction =
      err instanceof msal.InteractionRequiredAuthError || err?.errorCode === "interaction_required";
    if (requiresInteraction) {
      await client.acquireTokenRedirect({ scopes: settings.scopes, account });
      return null;
    }
    throw err;
  }
}

function makeSubscriptionKey(projectName, environment) {
  const name = String(projectName ?? "").trim();
  if (!name) return "";
  const env = String(environment ?? "").trim();
  return `${name}||${env}`;
}

function formatSubscriptionLabel(projectName, environment) {
  const name = String(projectName ?? "").trim();
  const env = String(environment ?? "").trim();
  if (!env) return name;
  return `${name} (${env})`;
}

function getSummaryValue(row, col) {
  if (col === "project_name") return getDisplayProjectName(row);
  return row?.[col] ?? "";
}

function formatRowSubscriptionLabel(row) {
  return formatSubscriptionLabel(getDisplayProjectName(row), row?.environment ?? "");
}

function showResultIn(el, { ok, text, content }) {
  if (!el) return;
  el.hidden = false;
  el.className = `result ${ok ? "ok" : "err"}`;
  el.replaceChildren();
  if (content) {
    el.appendChild(content);
    return;
  }
  el.textContent = text ?? "";
}

function showResult({ ok, text, content }) {
  showResultIn($("#result"), { ok, text, content });
}

function showRemoveResult({ ok, text, content }) {
  showResultIn($("#removeResult"), { ok, text, content });
}

function showUpdateResult({ ok, text, content }) {
  showResultIn($("#updateResult"), { ok, text, content });
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildLocalPreviewPrefix(azdoStatus) {
  if (azdoStatus?.configured && azdoStatus.enabled === false) {
    return "Local preview: Azure DevOps configured but request submission disabled (PORTAL_AZDO_ENABLED=false).\n\n";
  }
  if (!azdoStatus?.configured && Array.isArray(azdoStatus?.missing) && azdoStatus.missing.length > 0) {
    return `Local mode: Azure DevOps not configured (missing: ${azdoStatus.missing.join(", ")}).\n\n`;
  }
  return "";
}

function csvFormatField(value) {
  const str = String(value ?? "");
  if (str.length === 0) return "";

  const needsQuotes = /[",\r\n]/.test(str) || /^\s|\s$/.test(str);
  if (!needsQuotes) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

function renderRainbowCsvLine(fields) {
  const frag = document.createDocumentFragment();
  const values = Array.isArray(fields) ? fields : [];

  for (let i = 0; i < values.length; i++) {
    const hue = (i * 137.508) % 360;
    const span = document.createElement("span");
    span.className = "csvField";
    span.style.backgroundColor = `hsla(${hue}, 85%, 60%, 0.16)`;
    span.style.borderColor = `hsla(${hue}, 85%, 60%, 0.32)`;
    span.textContent = csvFormatField(values[i]);
    frag.appendChild(span);

    if (i < values.length - 1) frag.appendChild(document.createTextNode(","));
  }

  return frag;
}

function renderRainbowCsvBatchPreview({ headers, rows }) {
  const container = document.createElement("div");

  const title = document.createElement("div");
  title.className = "csvPreviewTitle";
  title.textContent = "Dry run OK. These are the CSV rows that would be appended:";

  const wrap = document.createElement("div");
  wrap.className = "csvPreviewWrap";

  const pre = document.createElement("pre");
  pre.className = "csvPreview";
  pre.appendChild(renderRainbowCsvLine(headers));
  for (const row of rows ?? []) {
    pre.appendChild(document.createTextNode("\n"));
    pre.appendChild(renderRainbowCsvLine(row));
  }

  wrap.appendChild(pre);
  container.appendChild(title);
  container.appendChild(wrap);
  return container;
}

async function loadConfig() {
  const res = await fetch("./api/config");
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

function fillSelect(select, values, defaultValue) {
  select.innerHTML = "";
  for (const val of values) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    if (defaultValue && val === defaultValue) opt.selected = true;
    select.appendChild(opt);
  }
}

function readCheckbox(container, name) {
  return container?.querySelector(`[name="${name}"]`)?.checked === true;
}

function parseCsvBoolean(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return null;
}

function resolveAccessGroupEnabled(row, role) {
  const explicit = parseCsvBoolean(row?.[role.csvEnabledField]);
  if (explicit !== null) return explicit;
  return (
    String(row?.[role.csvNameField] ?? "").trim() !== "" || String(row?.[role.csvMembersField] ?? "").trim() !== ""
  );
}

function stripEnvironmentSuffix(projectName, environment) {
  const name = String(projectName ?? "").trim();
  const env = String(environment ?? "").trim();
  if (!name || !env) return name;
  const suffix = `-${env.toLowerCase()}`;
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(suffix) && lowerName.length > suffix.length) {
    return name.slice(0, name.length - suffix.length);
  }
  return name;
}

function normalizeGroupSegment(value, fallback) {
  const safe = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe || fallback;
}

function buildSuggestedGroupName({ projectName, environment, role }) {
  const project = normalizeGroupSegment(projectName, "project");
  const env = normalizeGroupSegment(environment, "env");
  return `Azure-SUB-${project}-${env}-${role}`;
}

function getSingleEnvironmentForGroupNaming(container) {
  if (!container) return "";
  const multiToggle = container.querySelector("[data-env-multi-toggle]");
  if (multiToggle?.checked) {
    const environments = getModuleEnvironments(container);
    return environments.length === 1 ? environments[0] : "";
  }
  return String(container.querySelector('[name="environment"]')?.value ?? "").trim();
}

function syncSuggestedGroupNameInput(input, suggestion) {
  if (!input) return;
  const previousSuggestion = String(input.dataset.suggestedValue ?? "").trim();
  const currentValue = String(input.value ?? "").trim();
  const autoManaged = input.dataset.autoManaged !== "0";
  const shouldSync = autoManaged || currentValue === "" || currentValue === previousSuggestion;

  input.dataset.suggestedValue = suggestion;
  input.placeholder = suggestion || "Auto-generated per selected environment";

  if (!shouldSync) return;

  input.value = suggestion;
  input.dataset.autoManaged = "1";
}

function syncAccessGroupNameSuggestions(container) {
  if (!container) return;
  const environment = getSingleEnvironmentForGroupNaming(container);
  const rawProjectName = String(container.querySelector('[name="projectName"]')?.value ?? "").trim();
  const cleanProjectName = stripEnvironmentSuffix(rawProjectName, environment);

  for (const role of ACCESS_GROUP_ROLES) {
    const input = container.querySelector(`[name="${role.nameField}"]`);
    if (!input) continue;
    const roleLabel = role.key.charAt(0).toUpperCase() + role.key.slice(1);
    const suggestion = environment && cleanProjectName
      ? buildSuggestedGroupName({ projectName: cleanProjectName, environment, role: roleLabel })
      : "";
    syncSuggestedGroupNameInput(input, suggestion);
  }
}

function setupAccessGroupNameSuggestions(container) {
  if (!container || container.dataset.accessGroupNameSuggestionsReady === "1") return;
  container.dataset.accessGroupNameSuggestionsReady = "1";

  const refresh = () => syncAccessGroupNameSuggestions(container);

  container.querySelector('[name="projectName"]')?.addEventListener("input", refresh);
  container.querySelector('[name="environment"]')?.addEventListener("change", refresh);
  container.querySelector("[data-env-multi-toggle]")?.addEventListener("change", refresh);
  container.querySelector("[data-env-multi-options]")?.addEventListener("change", refresh);

  for (const role of ACCESS_GROUP_ROLES) {
    const input = container.querySelector(`[name="${role.nameField}"]`);
    if (!input) continue;

    input.addEventListener("input", () => {
      const currentValue = String(input.value ?? "").trim();
      const suggestion = String(input.dataset.suggestedValue ?? "").trim();
      input.dataset.autoManaged = currentValue === "" || currentValue === suggestion ? "1" : "0";
    });

    input.addEventListener("blur", () => {
      const currentValue = String(input.value ?? "").trim();
      if (currentValue !== "") return;
      input.dataset.autoManaged = "1";
      refresh();
    });
  }

  refresh();
}

function getSubscriptionLifecycleStatus(row) {
  const destroyValue = String(row?.destroy ?? "")
    .trim()
    .toLowerCase();
  const destroyedAt = String(row?.destroyed_at ?? "").trim();

  if (destroyValue === "true") {
    return {
      label: "Pending destruction",
      tone: "pending",
      detail: destroyedAt ? `Marked ${destroyedAt}` : "Awaiting cleanup",
      pendingDestruction: true
    };
  }

  return {
    label: "Active",
    tone: "active",
    detail: "Available for update or destruction review",
    pendingDestruction: false
  };
}

function syncAccessGroupRoleState(container, role) {
  if (!container) return;
  const enabled = readCheckbox(container, role.enabledField);
  const section = container.querySelector(`[data-access-group-role="${role.key}"]`);
  const fields = container.querySelectorAll(
    `[data-access-group-fields="${role.key}"] input, [data-access-group-fields="${role.key}"] textarea`
  );
  for (const field of fields) {
    field.disabled = !enabled;
  }
  if (section) {
    section.classList.toggle("is-enabled", enabled);
    section.classList.toggle("is-disabled", !enabled);
  }
}

function formatAccessGroupRoleLabel(roleKey) {
  const value = String(roleKey ?? "").trim();
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "Access";
}

function setupAccessGroupToggles(container) {
  if (!container || container.dataset.accessGroupTogglesReady === "1") return;
  container.dataset.accessGroupTogglesReady = "1";

  for (const role of ACCESS_GROUP_ROLES) {
    const checkbox = container.querySelector(`[name="${role.enabledField}"]`);
    if (!checkbox) continue;
    checkbox.addEventListener("change", () => {
      syncAccessGroupRoleState(container, role);
    });
    syncAccessGroupRoleState(container, role);
  }
}

function buildEnvironmentOptions(container, environments) {
  container.innerHTML = "";
  for (const env of environments ?? []) {
    const label = document.createElement("label");
    label.className = "envMultiOption";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = env;
    checkbox.dataset.envMultiOption = "1";

    const text = document.createElement("span");
    text.textContent = env;

    label.appendChild(checkbox);
    label.appendChild(text);
    container.appendChild(label);
  }
}

function getSelectedEnvironmentOptions(container) {
  return Array.from(container?.querySelectorAll("[data-env-multi-option]") ?? [])
    .filter((input) => input.checked)
    .map((input) => String(input.value ?? "").trim())
    .filter(Boolean);
}

function setMultiEnvironmentMode(moduleEl, enabled) {
  const select = moduleEl.querySelector('[name="environment"]');
  const toggle = moduleEl.querySelector("[data-env-multi-toggle]");
  const options = moduleEl.querySelector("[data-env-multi-options]");
  if (!select || !toggle || !options) return;

  const toggleWrap = toggle.closest("[data-env-multi-toggle-wrap]");
  if (toggleWrap) toggleWrap.classList.toggle("is-active", enabled);

  toggle.checked = enabled;
  toggle.setCustomValidity("");

  for (const option of options.querySelectorAll("[data-env-multi-option]")) {
    option.disabled = !enabled;
  }

  if (enabled) {
    const current = String(select.value ?? "").trim();
    options.hidden = false;
    select.hidden = true;
    select.disabled = true;
    select.required = false;

    const selected = getSelectedEnvironmentOptions(options);
    if (selected.length === 0) {
      const checkboxes = Array.from(options.querySelectorAll("[data-env-multi-option]"));
      let matched = false;
      for (const checkbox of checkboxes) {
        const value = String(checkbox.value ?? "").trim();
        const shouldCheck = current ? value === current : false;
        checkbox.checked = shouldCheck;
        if (shouldCheck) matched = true;
      }
      if (!matched && checkboxes.length > 0) {
        checkboxes[0].checked = true;
      }
    }
    return;
  }

  const selected = getSelectedEnvironmentOptions(options);
  if (selected.length > 0) select.value = selected[0];
  options.hidden = true;
  select.hidden = false;
  select.disabled = false;
  select.required = true;
}

function setupEnvironmentPicker(moduleEl, environments) {
  const select = moduleEl.querySelector('[name="environment"]');
  const toggle = moduleEl.querySelector("[data-env-multi-toggle]");
  const options = moduleEl.querySelector("[data-env-multi-options]");
  if (!select || !toggle || !options) return;

  buildEnvironmentOptions(options, environments);
  setMultiEnvironmentMode(moduleEl, false);

  toggle.addEventListener("change", () => {
    setMultiEnvironmentMode(moduleEl, toggle.checked);
  });

  select.addEventListener("change", () => {
    toggle.setCustomValidity("");
  });

  options.addEventListener("change", () => {
    toggle.setCustomValidity("");
  });
}

function readAccessGroupPayload(container) {
  const payload = {};
  if (!container) return payload;

  for (const role of ACCESS_GROUP_ROLES) {
    payload[role.enabledField] = readCheckbox(container, role.enabledField);

    const nameInput = container.querySelector(`[name="${role.nameField}"]`);
    const nameValue = readGroupNameFieldValue(nameInput);
    if (nameValue !== "") {
      payload[role.nameField] = nameValue;
    }

    const membersValue = String(container.querySelector(`[name="${role.membersField}"]`)?.value ?? "").trim();
    if (membersValue !== "") {
      payload[role.membersField] = membersValue;
    }
  }

  return payload;
}

function readAccessGroupEditorState(container) {
  const state = {};
  if (!container) return state;

  for (const role of ACCESS_GROUP_ROLES) {
    state[role.enabledField] = readCheckbox(container, role.enabledField);
    const nameInput = container.querySelector(`[name="${role.nameField}"]`);
    state[role.nameField] = String(nameInput?.value ?? "").trim();
    state[`${role.nameField}AutoManaged`] = nameInput?.dataset.autoManaged !== "0";
    state[role.membersField] = String(container.querySelector(`[name="${role.membersField}"]`)?.value ?? "").trim();
  }

  return state;
}

function applyAccessGroupEditorState(container, state) {
  if (!container) return;

  for (const role of ACCESS_GROUP_ROLES) {
    const checkbox = container.querySelector(`[name="${role.enabledField}"]`);
    if (checkbox) checkbox.checked = state?.[role.enabledField] === true;

    const nameInput = container.querySelector(`[name="${role.nameField}"]`);
    const nameValue = String(state?.[role.nameField] ?? "").trim();
    const autoManaged = state?.[`${role.nameField}AutoManaged`] !== false;
    if (nameInput) {
      nameInput.value = nameValue;
      nameInput.dataset.autoManaged = autoManaged ? "1" : "0";
      nameInput.dataset.suggestedValue = "";
    }

    const membersInput = container.querySelector(`[name="${role.membersField}"]`);
    if (membersInput) membersInput.value = String(state?.[role.membersField] ?? "").trim();
  }
}

function shouldUseEnvironmentSpecificAccessGroups(moduleEl) {
  const toggle = moduleEl?.querySelector("[data-env-multi-toggle]");
  return toggle?.checked === true && getModuleEnvironments(moduleEl).length > 1;
}

function getEnvironmentAccessGroupEditors(moduleEl) {
  return Array.from(moduleEl?.querySelectorAll("[data-env-access-editor='1']") ?? []);
}

function captureEnvironmentAccessGroupStates(moduleEl) {
  const states = new Map();
  for (const editor of getEnvironmentAccessGroupEditors(moduleEl)) {
    const environment = String(editor.dataset.environment ?? "").trim();
    if (!environment) continue;
    states.set(environment, readAccessGroupEditorState(editor));
  }
  return states;
}

function buildSharedAccessGroupFallbackState(sharedContainer) {
  const state = readAccessGroupEditorState(sharedContainer);
  for (const role of ACCESS_GROUP_ROLES) {
    state[role.nameField] = "";
    state[`${role.nameField}AutoManaged`] = true;
  }
  return state;
}

function createEnvironmentAccessGroupEditor({ moduleEl, environment, projectName, state }) {
  const sharedContainer = moduleEl?.querySelector("[data-shared-access-groups]");
  if (!sharedContainer) return null;

  const panel = document.createElement("section");
  panel.className = "envAccessGroupsPanel";
  panel.dataset.envAccessEditor = "1";
  panel.dataset.environment = environment;

  const header = document.createElement("div");
  header.className = "envAccessGroupsHeader";

  const title = document.createElement("h4");
  title.className = "envAccessGroupsTitle";
  title.textContent = `${environment} access groups`;

  const meta = document.createElement("p");
  meta.className = "envAccessGroupsMeta";
  meta.textContent = `Configure Owner / Contributor / Reader groups for ${environment} only.`;

  header.appendChild(title);
  header.appendChild(meta);
  panel.appendChild(header);

  const hiddenProject = document.createElement("input");
  hiddenProject.type = "hidden";
  hiddenProject.name = "projectName";
  hiddenProject.value = projectName;
  panel.appendChild(hiddenProject);

  const hiddenEnvironment = document.createElement("input");
  hiddenEnvironment.type = "hidden";
  hiddenEnvironment.name = "environment";
  hiddenEnvironment.value = environment;
  panel.appendChild(hiddenEnvironment);

  const cardsGrid = sharedContainer.cloneNode(true);
  cardsGrid.removeAttribute("data-shared-access-groups");
  cardsGrid.hidden = false;
  cardsGrid.removeAttribute("hidden");
  panel.appendChild(cardsGrid);

  applyAccessGroupEditorState(panel, state);
  setupAccessGroupToggles(panel);
  setupAccessGroupNameSuggestions(panel);
  syncAccessGroupNameSuggestions(panel);
  for (const role of ACCESS_GROUP_ROLES) {
    syncAccessGroupRoleState(panel, role);
  }

  return panel;
}

function syncEnvironmentAccessGroupEditors(moduleEl) {
  const sharedContainer = moduleEl?.querySelector("[data-shared-access-groups]");
  const wrapper = moduleEl?.querySelector("[data-env-access-groups]");
  const list = moduleEl?.querySelector("[data-env-access-groups-list]");
  if (!sharedContainer || !wrapper || !list) return;

  const usePerEnvironmentEditors = shouldUseEnvironmentSpecificAccessGroups(moduleEl);
  sharedContainer.hidden = usePerEnvironmentEditors;
  wrapper.hidden = !usePerEnvironmentEditors;

  if (!usePerEnvironmentEditors) {
    list.innerHTML = "";
    return;
  }

  const environments = getModuleEnvironments(moduleEl);
  const projectName = String(moduleEl.querySelector('[name="projectName"]')?.value ?? "").trim();
  const existingStates = captureEnvironmentAccessGroupStates(moduleEl);
  const sharedFallbackState = buildSharedAccessGroupFallbackState(sharedContainer);

  list.innerHTML = "";
  for (const environment of environments) {
    const state = existingStates.get(environment) ?? sharedFallbackState;
    const editor = createEnvironmentAccessGroupEditor({
      moduleEl,
      environment,
      projectName,
      state
    });
    if (editor) list.appendChild(editor);
  }
}

function setupEnvironmentSpecificAccessGroups(moduleEl) {
  if (!moduleEl || moduleEl.dataset.envSpecificAccessGroupsReady === "1") return;
  moduleEl.dataset.envSpecificAccessGroupsReady = "1";

  const refresh = () => syncEnvironmentAccessGroupEditors(moduleEl);
  moduleEl.querySelector('[name="projectName"]')?.addEventListener("input", refresh);
  moduleEl.querySelector('[name="environment"]')?.addEventListener("change", refresh);
  moduleEl.querySelector("[data-env-multi-toggle]")?.addEventListener("change", refresh);
  moduleEl.querySelector("[data-env-multi-options]")?.addEventListener("change", refresh);

  refresh();
}

async function loadSubscriptions() {
  const { headers, credentials } = await buildAuthContext({ json: false });
  const res = await fetch("./api/subscriptions", { headers, credentials });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

function renderSubscriptionsTable(parsed, { allowSelection = false, rowsByKey } = {}) {
  const tbody = $("#subsTable tbody");
  if (!tbody) return 0;
  tbody.innerHTML = "";

  const selectionHeader = $("#subsTable thead [data-selection-col]");
  if (selectionHeader) selectionHeader.hidden = !allowSelection;

  if (rowsByKey) rowsByKey.clear();
  let selectableCount = 0;

  for (const row of parsed?.rows ?? []) {
    const tr = document.createElement("tr");
    const projectName = String(row?.project_name ?? "").trim();
    const displayProjectName = getDisplayProjectName(row);
    const environment = String(row?.environment ?? "").trim();
    const key = makeSubscriptionKey(projectName, environment);
    tr.dataset.subscriptionKey = key;
    if (rowsByKey && key) rowsByKey.set(key, row);

    const lifecycle = getSubscriptionLifecycleStatus(row);
    tr.classList.toggle("is-pending-destruction", lifecycle.pendingDestruction);
    tr.classList.toggle("is-selectable", !lifecycle.pendingDestruction && key.length > 0);
    if (lifecycle.pendingDestruction) {
      tr.title = lifecycle.detail;
    }

    if (allowSelection) {
      const selectTd = document.createElement("td");
      selectTd.className = "selectCol";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = key;
      checkbox.className = "rowSelectCheckbox";
      checkbox.dataset.rowSelect = "1";
      checkbox.dataset.projectName = projectName;
      checkbox.dataset.displayProjectName = displayProjectName;
      checkbox.dataset.environment = environment;
      checkbox.setAttribute("aria-label", `Select ${formatSubscriptionLabel(displayProjectName, environment)}`);
      checkbox.dataset.pendingDestruction = lifecycle.pendingDestruction ? "1" : "0";
      checkbox.disabled = lifecycle.pendingDestruction || key.length === 0;
      if (lifecycle.pendingDestruction) {
        checkbox.title = "Already marked for destruction";
      } else if (key.length > 0) {
        selectableCount += 1;
      }
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);
    }

    const statusTd = document.createElement("td");
    const statusWrap = document.createElement("div");
    statusWrap.className = "statusCell";
    const statusBadge = document.createElement("span");
    statusBadge.className = `statusBadge is-${lifecycle.tone}`;
    statusBadge.textContent = lifecycle.label;
    statusWrap.appendChild(statusBadge);
    if (lifecycle.detail) {
      const statusMeta = document.createElement("div");
      statusMeta.className = "statusMeta";
      statusMeta.textContent = lifecycle.detail;
      statusWrap.appendChild(statusMeta);
    }
    statusTd.appendChild(statusWrap);
    tr.appendChild(statusTd);

    for (const col of SUMMARY_COLUMNS) {
      const td = document.createElement("td");
      td.textContent = getSummaryValue(row, col);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  return selectableCount;
}

function readCookieValue(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function buildJsonHeaders() {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  const xsrfToken = readCookieValue("XSRF-TOKEN");
  if (xsrfToken) headers["X-XSRF-TOKEN"] = xsrfToken;
  return headers;
}

async function ensureXsrfCookie() {
  if (readCookieValue("XSRF-TOKEN")) return true;
  try {
    const res = await fetch("./.auth/me", { headers: { Accept: "application/json" }, credentials: "same-origin" });
    await res.text().catch(() => "");
  } catch {
    return false;
  }
  return Boolean(readCookieValue("XSRF-TOKEN"));
}

async function buildAuthContext({ json } = {}) {
  const config = appConfig;
  const bearer = getBearerConfig(config);
  const headers = json ? buildJsonHeaders() : { Accept: "application/json" };

  if (bearer.enabled) {
    const token = await getBearerToken(config);
    if (!token) throw new Error("Sign-in required. Finish authentication and try again.");
    headers.Authorization = `Bearer ${token}`;
    return { headers, credentials: "omit" };
  }

  if (json && config?.auth?.easyAuth) {
    await ensureXsrfCookie();
  }

  return { headers, credentials: "same-origin" };
}

async function readResponseBody(res) {
  const text = await res.text().catch(() => "");
  if (!text) return { json: null, text };
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

async function fetchAzdoHealth() {
  try {
    const { headers, credentials } = await buildAuthContext({ json: false });
    const res = await fetch("./api/azdo/health", { headers, credentials });
    const { json, text } = await readResponseBody(res);
    if (!res.ok) {
      const detail = text?.trim();
      const msg = detail ? `Azure DevOps health check failed: ${detail}` : "Azure DevOps health check failed.";
      return { ok: false, error: `${msg} (${res.status} ${res.statusText})` };
    }
    return { ok: true, data: json ?? {} };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

function formatAzdoHealth(data) {
  const azdo = data?.azdo ?? {};
  const lines = ["", "Azure DevOps health:"];
  lines.push(`- configured: ${azdo.configured} (enabled: ${azdo.enabled})`);
  if (Array.isArray(azdo.missing) && azdo.missing.length > 0) {
    lines.push(`- missing: ${azdo.missing.join(", ")}`);
  }
  if (azdo.orgUrl) lines.push(`- orgUrl: ${azdo.orgUrl}`);
  if (azdo.project) lines.push(`- project: ${azdo.project}`);
  if (azdo.repoId) lines.push(`- repoId: ${azdo.repoId}`);
  if (azdo.targetBranch) lines.push(`- targetBranch: ${azdo.targetBranch}`);

  const checks = Array.isArray(data?.checks) ? data.checks : [];
  for (const check of checks) {
    const status = check?.ok ? "ok" : "error";
    const error = check?.ok ? "" : ` (${String(check?.error ?? "").split("\n")[0]})`;
    lines.push(`- ${check?.name ?? "check"}: ${status}${error}`);
  }
  return lines.join("\n");
}

async function buildAzdoErrorMessage(err) {
  const base = err?.message ?? String(err);
  const bearer = getBearerConfig(appConfig);
  const diagnostics = [];
  if (err?.middlewareRequestId) diagnostics.push(`middlewareRequestId: ${err.middlewareRequestId}`);
  if (err?.requestId) diagnostics.push(`requestId: ${err.requestId}`);
  if (err?.errorCode) diagnostics.push(`errorCode: ${err.errorCode}`);
  if (err?.wwwAuthenticate) diagnostics.push(`wwwAuthenticate: ${err.wwwAuthenticate}`);
  diagnostics.push(`authMode: ${bearer.enabled ? "bearer" : "cookie"}`);
  diagnostics.push(`xsrfToken: ${bearer.enabled ? "n/a" : readCookieValue("XSRF-TOKEN") ? "present" : "missing"}`);
  const diagnosticText = diagnostics.length > 0 ? `\n\nRequest diagnostics:\n- ${diagnostics.join("\n- ")}` : "";

  if (err?.status !== 403) return `${base}${diagnosticText}`;
  if (/access required/i.test(base)) return `${base}${diagnosticText}`;

  const health = await fetchAzdoHealth();
  if (!health.ok) return `${base}${diagnosticText}\n\n${health.error}`;

  console.warn("Azure DevOps health", health.data);
  return `${base}${diagnosticText}${formatAzdoHealth(health.data)}`;
}

async function submitBatch({ dryRun, payload }) {
  const body = { ...(payload ?? {}) };
  if (dryRun) body.dryRun = true;
  else delete body.dryRun;

  const { headers, credentials } = await buildAuthContext({ json: true });
  const res = await fetch("./api/subscription-requests/batch", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials
  });

  const { json, text } = await readResponseBody(res);
  if (!res.ok) {
    const cleaned = text?.trim();
    const msg = json?.error ?? (cleaned ? cleaned : null) ?? `Request failed (${res.status} ${res.statusText})`;
    const err = new Error(msg);
    err.status = res.status;
    err.statusText = res.statusText;
    err.middlewareRequestId = res.headers.get("x-ms-middleware-request-id");
    err.requestId = res.headers.get("x-ms-request-id");
    err.errorCode = res.headers.get("x-ms-error-code");
    err.wwwAuthenticate = res.headers.get("www-authenticate");
    throw err;
  }

  return json ?? {};
}

async function submitRemoval({ dryRun, targets }) {
  const body = { targets: Array.isArray(targets) ? targets : [] };
  if (dryRun) body.dryRun = true;
  else delete body.dryRun;

  const { headers, credentials } = await buildAuthContext({ json: true });
  const res = await fetch("./api/subscription-requests/remove", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials
  });

  const { json, text } = await readResponseBody(res);
  if (!res.ok) {
    const cleaned = text?.trim();
    const msg = json?.error ?? (cleaned ? cleaned : null) ?? `Request failed (${res.status} ${res.statusText})`;
    const err = new Error(msg);
    err.status = res.status;
    err.statusText = res.statusText;
    err.middlewareRequestId = res.headers.get("x-ms-middleware-request-id");
    err.requestId = res.headers.get("x-ms-request-id");
    err.errorCode = res.headers.get("x-ms-error-code");
    err.wwwAuthenticate = res.headers.get("www-authenticate");
    throw err;
  }

  return json ?? {};
}

async function submitUpdate({ dryRun, payload }) {
  const body = { ...(payload ?? {}) };
  if (dryRun) body.dryRun = true;
  else delete body.dryRun;

  const { headers, credentials } = await buildAuthContext({ json: true });
  const res = await fetch("./api/subscription-requests/update", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials
  });

  const { json, text } = await readResponseBody(res);
  if (!res.ok) {
    const cleaned = text?.trim();
    const msg = json?.error ?? (cleaned ? cleaned : null) ?? `Request failed (${res.status} ${res.statusText})`;
    const err = new Error(msg);
    err.status = res.status;
    err.statusText = res.statusText;
    err.middlewareRequestId = res.headers.get("x-ms-middleware-request-id");
    err.requestId = res.headers.get("x-ms-request-id");
    err.errorCode = res.headers.get("x-ms-error-code");
    err.wwwAuthenticate = res.headers.get("www-authenticate");
    throw err;
  }

  return json ?? {};
}

async function syncSubscriptionsFromAzdo() {
  const { headers, credentials } = await buildAuthContext({ json: true });
  const res = await fetch("./api/subscriptions/sync", {
    method: "POST",
    headers,
    credentials
  });

  const { json, text } = await readResponseBody(res);
  if (!res.ok) {
    const cleaned = text?.trim();
    const msg = json?.error ?? (cleaned ? cleaned : null) ?? `Request failed (${res.status} ${res.statusText})`;
    const err = new Error(msg);
    err.status = res.status;
    err.statusText = res.statusText;
    throw err;
  }

  return json ?? {};
}

function getRequestModules() {
  return Array.from(document.querySelectorAll("[data-request-module]"));
}

function updateRequestModuleIndices() {
  const modules = getRequestModules();
  for (let i = 0; i < modules.length; i++) {
    const moduleEl = modules[i];
    moduleEl.querySelector("[data-request-index]").textContent = `#${i + 1}`;
    const removeBtn = moduleEl.querySelector("[data-remove-module]");
    if (removeBtn) removeBtn.hidden = modules.length === 1;
  }
}

function getModuleBasePayload(moduleEl) {
  const payload = {};
  const fields = [
    "projectName",
    "managementGroupId",
    "location",
    "department",
    "team",
    "owner",
    "costCenter",
    "billingScope",
    "subOwnerGroupEnabled",
    "subContributorGroupEnabled",
    "subReaderGroupEnabled",
    "subOwnerGroupName",
    "subContributorGroupName",
    "subReaderGroupName",
    "subOwnerMembers",
    "subContributorMembers",
    "subReaderMembers",
    "confidentiality",
    "workloadId",
    "app",
    "compliance",
    "project",
    "sla",
    "leanIX"
  ];
  const checkboxFields = new Set(["subOwnerGroupEnabled", "subContributorGroupEnabled", "subReaderGroupEnabled"]);

  for (const field of fields) {
    const el = moduleEl.querySelector(`[name="${field}"]`);
    if (!el) continue;
    if (checkboxFields.has(field)) {
      payload[field] = el.checked === true;
      continue;
    }
    const value =
      field === "subOwnerGroupName" || field === "subContributorGroupName" || field === "subReaderGroupName"
        ? readGroupNameFieldValue(el)
        : String(el.value ?? "").trim();
    if (value === "") continue;
    payload[field] = value;
  }

  payload.destroy = false;
  return payload;
}

function readGroupNameFieldValue(input) {
  if (!input) return "";
  const value = String(input.value ?? "").trim();
  const suggestion = String(input.dataset.suggestedValue ?? "").trim();
  const autoManaged = input.dataset.autoManaged !== "0";
  if (autoManaged && suggestion && value === suggestion) return "";
  return value;
}

function getModuleEnvironments(moduleEl) {
  const toggle = moduleEl.querySelector("[data-env-multi-toggle]");
  if (toggle?.checked) {
    const options = moduleEl.querySelector("[data-env-multi-options]");
    return Array.from(new Set(getSelectedEnvironmentOptions(options)));
  }

  const select = moduleEl.querySelector('[name="environment"]');
  const value = String(select?.value ?? "").trim();
  return value ? [value] : [];
}

function getModulePayloads(moduleEl) {
  const base = getModuleBasePayload(moduleEl);
  const environments = getModuleEnvironments(moduleEl);
  const usePerEnvironmentAccessGroups = shouldUseEnvironmentSpecificAccessGroups(moduleEl);

  return environments.map((environment) => {
    if (!usePerEnvironmentAccessGroups) {
      return { ...base, environment };
    }

    const envEditor = getEnvironmentAccessGroupEditors(moduleEl).find(
      (editor) => String(editor.dataset.environment ?? "").trim() === environment
    );
    const envAccessGroupPayload = envEditor ? readAccessGroupPayload(envEditor) : {};
    return {
      ...base,
      ...envAccessGroupPayload,
      environment
    };
  });
}

function buildBatchPayload() {
  const modules = getRequestModules();
  return { requests: modules.flatMap(getModulePayloads) };
}

function buildUpdatePayload(updateForm) {
  const read = (name) => String(updateForm?.querySelector(`[name="${name}"]`)?.value ?? "").trim();
  const readGroupName = (name) => readGroupNameFieldValue(updateForm?.querySelector(`[name="${name}"]`));
  return {
    projectName: read("projectName"),
    environment: read("environment"),
    managementGroupId: read("managementGroupId"),
    location: read("location"),
    department: read("department"),
    team: read("team"),
    owner: read("owner"),
    costCenter: read("costCenter"),
    billingScope: read("billingScope"),
    subOwnerGroupEnabled: readCheckbox(updateForm, "subOwnerGroupEnabled"),
    subContributorGroupEnabled: readCheckbox(updateForm, "subContributorGroupEnabled"),
    subReaderGroupEnabled: readCheckbox(updateForm, "subReaderGroupEnabled"),
    subOwnerGroupName: readGroupName("subOwnerGroupName"),
    subContributorGroupName: readGroupName("subContributorGroupName"),
    subReaderGroupName: readGroupName("subReaderGroupName"),
    subOwnerMembers: read("subOwnerMembers"),
    subContributorMembers: read("subContributorMembers"),
    subReaderMembers: read("subReaderMembers"),
    confidentiality: read("confidentiality"),
    workloadId: read("workloadId"),
    app: read("app"),
    compliance: read("compliance"),
    project: read("project"),
    sla: read("sla"),
    leanIX: read("leanIX")
  };
}

function validateEnvironmentSelections() {
  let ok = true;
  for (const moduleEl of getRequestModules()) {
    const toggle = moduleEl.querySelector("[data-env-multi-toggle]");
    if (!toggle?.checked) {
      toggle?.setCustomValidity("");
      continue;
    }
    const selections = getModuleEnvironments(moduleEl);
    if (selections.length === 0) {
      toggle.setCustomValidity("Select at least one environment.");
      ok = false;
    } else {
      toggle.setCustomValidity("");
    }
  }
  return ok;
}

function setEditingEnabled(enabled) {
  $("#addRequestButton").disabled = !enabled;
  $("#reviewButton").disabled = !enabled;
  const dryBtn = $("#dryRunButton");
  if (dryBtn) dryBtn.disabled = !enabled;

  for (const moduleEl of getRequestModules()) {
    for (const el of moduleEl.querySelectorAll("input, select, button")) {
      el.disabled = !enabled;
    }
  }
}

export function renderReviewTableFromPreview({ headers, previewRows }) {
  const cols = SUMMARY_COLUMNS;
  const tbody = $("#reviewTable tbody");
  tbody.innerHTML = "";

  const headersArr = Array.isArray(headers) ? headers : [];
  const rowsArr = Array.isArray(previewRows) ? previewRows : [];

  for (const rowFields of rowsArr) {
    const map = {};
    for (let i = 0; i < headersArr.length; i++) {
      map[headersArr[i]] = rowFields?.[i] ?? "";
    }

    const tr = document.createElement("tr");
    for (const col of cols) {
      const td = document.createElement("td");
      td.textContent = getSummaryValue(map, col);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

async function main() {
  const config = await loadConfig();
  appConfig = config;
  try {
    await initBearerAuth(config);
  } catch (err) {
    console.warn("Bearer auth init failed", err);
  }
  const ui = config.ui ?? {};
  const showDryRun = ui.showDryRun !== false;
  const access = config.auth?.user ?? {};
  const isAdmin = access.isAdmin === true;
  const bearerEnabled = config.auth?.bearer?.enabled === true;
  const showModeBanner = ui.showModeBanner !== false && (isAdmin || !bearerEnabled);
  const showAdminPanel = isAdmin && ui.showExistingSubscriptions !== false;
  const azdo = config.azdo ?? {};

  const modeBanner = $("#modeBanner");
  if (!showModeBanner) {
    modeBanner?.remove();
  } else {
    modeBanner.hidden = false;
    if (config.mode === "azure-devops") {
      modeBanner.textContent = `Mode: Requests sent for approval (target branch: ${config.targetBranch})`;
    } else if (azdo.configured && azdo.enabled === false) {
      modeBanner.textContent = "Mode: Local preview (Azure DevOps configured, submission disabled)";
    } else if (azdo.configured) {
      modeBanner.textContent = "Mode: Local (Azure DevOps configured but inactive)";
    } else {
      modeBanner.textContent = "Preview mode: requests generate a CSV without changing Azure.";
    }
  }

  let existing = null;
  if (showAdminPanel) {
    existing = await loadSubscriptions();
  }

  const subscriptionsCard = $("#existingSubscriptionsCard");
  const removeReviewCard = $("#removeReviewCard");
  const updateCard = $("#updateCard");

  if (!showAdminPanel) {
    subscriptionsCard?.remove();
    removeReviewCard?.remove();
    updateCard?.remove();
  } else {
    const removeRowsByKey = new Map();
    let pendingRemoveTargets = null;
    let pendingUpdateKey = null;

    const removeActions = $("#removeActions");
    if (removeActions) removeActions.hidden = false;
    if (removeReviewCard) removeReviewCard.hidden = true;
    if (updateCard) updateCard.hidden = true;
    const selectionSummary = $("#selectionSummary");
    const selectionCountPill = $("#selectionCountPill");
    const selectionSummaryText = $("#selectionSummaryText");
    const selectionSummaryHint = $("#selectionSummaryHint");

    let selectableCount = renderSubscriptionsTable(existing, {
      allowSelection: true,
      rowsByKey: removeRowsByKey
    });

    function renderRemoveReviewTable(rows) {
      const tbody = $("#removeReviewTable tbody");
      if (!tbody) return;
      tbody.innerHTML = "";

      for (const row of rows ?? []) {
        const tr = document.createElement("tr");
        for (const col of SUMMARY_COLUMNS) {
          const td = document.createElement("td");
          td.textContent = getSummaryValue(row, col);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }

    function getSubscriptionSelectionInputs() {
      return Array.from(document.querySelectorAll("#subsTable tbody input[data-row-select='1']"));
    }

    function getSelectedSubscriptionInputs() {
      return getSubscriptionSelectionInputs().filter((input) => input.checked);
    }

    function getSelectedRemoveTargets() {
      return getSelectedSubscriptionInputs()
        .map((input) => ({
          projectName: String(input.dataset.projectName ?? "").trim(),
          environment: String(input.dataset.environment ?? "").trim()
        }))
        .filter((target) => target.projectName.length > 0 && target.environment.length > 0);
    }

    function getSelectedRowKeys() {
      return getSelectedSubscriptionInputs()
        .map((input) => String(input.value ?? "").trim())
        .filter((value) => value.length > 0);
    }

    function restoreSelectedRowKeys(keys) {
      const wanted = new Set((keys ?? []).map((key) => String(key ?? "").trim()).filter(Boolean));
      for (const input of getSubscriptionSelectionInputs()) {
        const key = String(input.value ?? "").trim();
        input.checked = wanted.has(key) && !input.disabled;
      }
      updateSelectionUi();
    }

    function clearRemoveSelection() {
      for (const input of getSubscriptionSelectionInputs()) {
        input.checked = false;
      }
      updateSelectionUi();
    }

    function syncSelectionRowStyles() {
      for (const input of getSubscriptionSelectionInputs()) {
        const row = input.closest("tr");
        if (!row) continue;
        row.classList.toggle("is-selected", input.checked);
      }
    }

    let selectionEnabled = true;

    function updateSelectionUi() {
      const selectedInputs = getSelectedSubscriptionInputs();
      const selectedCount = selectedInputs.length;
      const hasRows = removeRowsByKey.size > 0 && selectableCount > 0;
      const canInteract = selectionEnabled && hasRows;
      const pendingCount = document.querySelectorAll("#subsTable tbody tr.is-pending-destruction").length;

      syncSelectionRowStyles();

      if (selectionSummary) selectionSummary.hidden = !hasRows;
      if (selectionCountPill) {
        selectionCountPill.textContent = `${selectedCount} selected`;
      }

      if (selectionSummaryText) {
        if (selectedCount === 0) {
          selectionSummaryText.textContent = "Select 1 subscription to update or 1+ subscriptions to review destruction.";
        } else if (selectedCount === 1) {
          const selected = selectedInputs[0];
          const projectName = selected.dataset.displayProjectName || selected.dataset.projectName;
          selectionSummaryText.textContent = `${formatSubscriptionLabel(projectName, selected.dataset.environment)} selected.`;
        } else {
          selectionSummaryText.textContent = `${selectedCount} subscriptions selected.`;
        }
      }

      if (selectionSummaryHint) {
        const pendingSuffix =
          pendingCount > 0
            ? ` ${pendingCount} subscription${pendingCount === 1 ? " is" : "s are"} already pending destruction and unavailable for actions.`
            : "";
        if (selectedCount === 0) {
          selectionSummaryHint.textContent = `Selection is neutral. Destruction only happens after review and confirm.${pendingSuffix}`;
        } else if (selectedCount === 1) {
          selectionSummaryHint.textContent = `Update is available for a single selection. Destruction still requires review and confirm.${pendingSuffix}`;
        } else {
          selectionSummaryHint.textContent = `Update needs exactly 1 selected row. Destruction can review multiple rows.${pendingSuffix}`;
        }
      }

      if (removeReviewButton) removeReviewButton.disabled = !canInteract || selectedCount === 0;
      if (removeClearButton) removeClearButton.disabled = !canInteract || selectedCount === 0;
      if (updateSubscriptionButton) updateSubscriptionButton.disabled = !canInteract || selectedCount !== 1;
      if (syncCsvButton) syncCsvButton.disabled = !selectionEnabled || !azdo.configured;
    }

    function setRemoveSelectionEnabled(enabled) {
      selectionEnabled = enabled;
      for (const input of getSubscriptionSelectionInputs()) {
        const isPendingDestruction = input.dataset.pendingDestruction === "1";
        input.disabled = !enabled || isPendingDestruction;
      }
      updateSelectionUi();
    }

    async function refreshSubscriptionsTable() {
      existing = await loadSubscriptions();
      selectableCount = renderSubscriptionsTable(existing, {
        allowSelection: true,
        rowsByKey: removeRowsByKey
      });
      pendingRemoveTargets = null;
      pendingUpdateKey = null;
      if (removeReviewCard) removeReviewCard.hidden = true;
      if (updateCard) updateCard.hidden = true;
      setRemoveSelectionEnabled(true);
      if (removeRowsByKey.size === 0 || selectableCount === 0) {
        if (removeReviewButton) removeReviewButton.disabled = true;
        if (removeClearButton) removeClearButton.disabled = true;
        if (updateSubscriptionButton) updateSubscriptionButton.disabled = true;
      }
    }

    async function reloadSubscriptionsTableSelection(selectedKeys) {
      existing = await loadSubscriptions();
      selectableCount = renderSubscriptionsTable(existing, {
        allowSelection: true,
        rowsByKey: removeRowsByKey
      });
      restoreSelectedRowKeys(selectedKeys);
      return removeRowsByKey;
    }

    const removeReviewButton = $("#removeReviewButton");
    const removeClearButton = $("#removeClearButton");
    const removeConfirmButton = $("#removeConfirmButton");
    const removeEditButton = $("#removeEditButton");
    const updateSubscriptionButton = $("#updateSubscriptionButton");
    const updateForm = $("#updateForm");
    const updateDryRunButton = $("#updateDryRunButton");
    const updateSubmitButton = $("#updateSubmitButton");
    const updateDismissButton = $("#updateDismissButton");
    const syncCsvButton = $("#syncCsvButton");
    let removeSubmitting = false;
    let updateSubmitting = false;

    const subsTableBody = $("#subsTable tbody");
    subsTableBody?.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.dataset.rowSelect !== "1") return;
      pendingRemoveTargets = null;
      if (removeReviewCard) removeReviewCard.hidden = true;
      updateSelectionUi();
    });

    subsTableBody?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("input, button, a, label")) return;
      const row = target.closest("tr[data-subscription-key]");
      if (!row || !selectionEnabled) return;
      const checkbox = row.querySelector("input[data-row-select='1']");
      if (!(checkbox instanceof HTMLInputElement) || checkbox.disabled) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });

    if (removeRowsByKey.size === 0 || selectableCount === 0) {
      const pendingCount = document.querySelectorAll("#subsTable tbody tr.is-pending-destruction").length;
      if (removeRowsByKey.size > 0 && selectableCount === 0 && pendingCount > 0) {
        showRemoveResult({ ok: true, text: "All listed subscriptions are already pending destruction." });
      } else {
        showRemoveResult({ ok: true, text: "No subscriptions available for update or destruction." });
      }
      if (removeReviewButton) removeReviewButton.disabled = true;
      if (removeClearButton) removeClearButton.disabled = true;
      if (updateSubscriptionButton) updateSubscriptionButton.disabled = true;
    }

    setupAccessGroupToggles(updateForm);
    setupAccessGroupNameSuggestions(updateForm);

    if (syncCsvButton) {
      if (!azdo.configured) {
        syncCsvButton.disabled = true;
        syncCsvButton.title = "Azure DevOps is not configured.";
      }
      syncCsvButton.addEventListener("click", async () => {
        if (syncCsvButton.disabled) return;
        try {
          syncCsvButton.disabled = true;
          showRemoveResult({ ok: true, text: "Syncing subscriptions.csv from Azure DevOps..." });
          const result = await syncSubscriptionsFromAzdo();
          await refreshSubscriptionsTable();
          const detail = result.wroteFile ? `\n${result.wroteFile}` : "";
          showRemoveResult({ ok: true, text: `Sync complete (branch: ${result.branch}).${detail}` });
        } catch (err) {
          showRemoveResult({ ok: false, text: await buildAzdoErrorMessage(err) });
        } finally {
          syncCsvButton.disabled = false;
        }
      });
    }

    updateSelectionUi();

    function populateUpdateForm(row) {
      if (!updateForm || !row) return;
      const setValue = (name, value) => {
        const el = updateForm.querySelector(`[name="${name}"]`);
        if (!el) return;
        el.value = value ?? "";
      };

      const mgFromRow = String(row?.management_group_id ?? "").trim();
      const locFromRow = String(row?.location ?? "").trim();
      const managementGroups = Array.from(new Set([...(config.options.managementGroups ?? []), mgFromRow].filter(Boolean)));
      const locations = Array.from(new Set([...(config.options.locations ?? []), locFromRow].filter(Boolean)));
      fillSelect(updateForm.querySelector('[name="managementGroupId"]'), managementGroups, mgFromRow);
      fillSelect(updateForm.querySelector('[name="location"]'), locations, locFromRow);

      setValue("projectName", row?.project_name ?? "");
      setValue("environment", row?.environment ?? "");
      setValue("department", row?.department ?? "");
      setValue("team", row?.team ?? "");
      setValue("owner", row?.owner ?? "");
      setValue("costCenter", row?.["cost-center"] ?? "");
      setValue("billingScope", row?.billing_scope ?? "");
      for (const role of ACCESS_GROUP_ROLES) {
        const checkbox = updateForm.querySelector(`[name="${role.enabledField}"]`);
        if (checkbox) checkbox.checked = resolveAccessGroupEnabled(row, role);
      }
      for (const role of ACCESS_GROUP_ROLES) {
        const section = updateForm.querySelector(`[data-access-group-role="${role.key}"]`);
        if (!section) continue;
        const title = section.querySelector(".accessGroupToggleTitle");
        const hint = section.querySelector(".accessGroupToggleText small");
        const roleLabel = formatAccessGroupRoleLabel(role.key);
        const hasExistingGroup = resolveAccessGroupEnabled(row, role);
        if (title) title.textContent = `${hasExistingGroup ? "Manage" : "Create"} ${roleLabel} group`;
        if (hint) {
          hint.textContent = hasExistingGroup
            ? "Edit members or name, or uncheck to remove the group."
            : "Unchecked roles are not created.";
        }
      }
      for (const role of ACCESS_GROUP_ROLES) {
        const input = updateForm.querySelector(`[name="${role.nameField}"]`);
        if (!input) continue;
        const currentValue = String(row?.[role.csvNameField] ?? "");
        input.value = currentValue;
        input.dataset.autoManaged = currentValue.trim() === "" ? "1" : "0";
        input.dataset.suggestedValue = "";
      }
      setValue("subOwnerMembers", row?.sub_owner_members ?? "");
      setValue("subContributorMembers", row?.sub_contributor_members ?? "");
      setValue("subReaderMembers", row?.sub_reader_members ?? "");
      setValue("confidentiality", row?.confidentiality ?? "");
      setValue("workloadId", row?.["workload-id"] ?? "");
      setValue("app", row?.app ?? "");
      setValue("compliance", row?.compliance ?? "");
      setValue("project", row?.project ?? "");
      setValue("sla", row?.sla ?? "");
      setValue("leanIX", row?.leanIX ?? "");
      syncAccessGroupNameSuggestions(updateForm);
      for (const role of ACCESS_GROUP_ROLES) {
        syncAccessGroupRoleState(updateForm, role);
      }
    }

    updateSubscriptionButton?.addEventListener("click", async () => {
      const selectedKeys = getSelectedRowKeys();
      if (selectedKeys.length !== 1) {
        showRemoveResult({ ok: false, text: "Select exactly one subscription to update." });
        return;
      }

      const selectedKey = selectedKeys[0];
      showRemoveResult({ ok: true, text: "Loading latest subscription data from Azure DevOps..." });
      try {
        await reloadSubscriptionsTableSelection([selectedKey]);
      } catch (err) {
        showRemoveResult({ ok: false, text: await buildAzdoErrorMessage(err) });
        return;
      }

      const row = removeRowsByKey.get(selectedKey);
      if (!row) {
        showRemoveResult({ ok: false, text: "Selected subscription was not found in loaded CSV data." });
        return;
      }

      if (getSubscriptionLifecycleStatus(row).pendingDestruction) {
        showRemoveResult({ ok: false, text: "Selected subscription is already pending destruction and cannot be updated." });
        return;
      }

      pendingRemoveTargets = null;
      if (removeReviewCard) removeReviewCard.hidden = true;
      pendingUpdateKey = selectedKey;
      populateUpdateForm(row);
      if (updateCard) {
        updateCard.hidden = false;
        updateCard.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setRemoveSelectionEnabled(false);
      showUpdateResult({
        ok: true,
        text: `Editing ${formatRowSubscriptionLabel(row)}.`
      });
    });

    updateDismissButton?.addEventListener("click", () => {
      pendingUpdateKey = null;
      if (updateCard) updateCard.hidden = true;
      setRemoveSelectionEnabled(true);
      showUpdateResult({ ok: true, text: "Update cancelled." });
    });

    updateDryRunButton?.addEventListener("click", async () => {
      if (updateSubmitting) return;
      if (!pendingUpdateKey) {
        showUpdateResult({ ok: false, text: "Select one subscription and open update first." });
        return;
      }
      if (!updateForm?.reportValidity()) return;

      try {
        updateSubmitting = true;
        if (updateDryRunButton) updateDryRunButton.disabled = true;
        if (updateSubmitButton) updateSubmitButton.disabled = true;
        showUpdateResult({ ok: true, text: "Running update dry run..." });
        const payload = buildUpdatePayload(updateForm);
        const result = await submitUpdate({ dryRun: true, payload });

        if (Array.isArray(result.previewHeaders) && Array.isArray(result.previewRow)) {
          showUpdateResult({
            ok: true,
            content: renderRainbowCsvBatchPreview({ headers: result.previewHeaders, rows: [result.previewRow] })
          });
          return;
        }
        showUpdateResult({ ok: true, text: "Update dry run OK." });
      } catch (err) {
        showUpdateResult({ ok: false, text: await buildAzdoErrorMessage(err) });
      } finally {
        updateSubmitting = false;
        if (updateDryRunButton) updateDryRunButton.disabled = false;
        if (updateSubmitButton) updateSubmitButton.disabled = false;
      }
    });

    updateSubmitButton?.addEventListener("click", async () => {
      if (updateSubmitting) return;
      if (!pendingUpdateKey) {
        showUpdateResult({ ok: false, text: "Select one subscription and open update first." });
        return;
      }
      if (!updateForm?.reportValidity()) return;

      try {
        updateSubmitting = true;
        if (updateDryRunButton) updateDryRunButton.disabled = true;
        if (updateSubmitButton) updateSubmitButton.disabled = true;
        showUpdateResult({ ok: true, text: "Sending update request..." });
        const payload = buildUpdatePayload(updateForm);
        const result = await submitUpdate({ dryRun: false, payload });

        pendingUpdateKey = null;
        if (updateCard) updateCard.hidden = true;
        setRemoveSelectionEnabled(true);

        if (result.mode === "azure-devops") {
          showUpdateResult({ ok: true, text: "Update request sent." });
        } else if (result.wroteFile) {
          showUpdateResult({ ok: true, text: `Updated CSV written to:\n${result.wroteFile}` });
        } else if (result.updatedCsv) {
          const prefix = buildLocalPreviewPrefix(result.azdo ?? config.azdo ?? {});
          showUpdateResult({ ok: true, text: `${prefix}Updated CSV generated. Downloading subscriptions.csv...` });
          downloadText("subscriptions.csv", result.updatedCsv);
        } else {
          showUpdateResult({ ok: true, text: "Done." });
        }
      } catch (err) {
        showUpdateResult({ ok: false, text: await buildAzdoErrorMessage(err) });
      } finally {
        updateSubmitting = false;
        if (updateDryRunButton) updateDryRunButton.disabled = false;
        if (updateSubmitButton) updateSubmitButton.disabled = false;
      }
    });

    removeReviewButton?.addEventListener("click", () => {
      const selected = getSelectedRemoveTargets();
      if (selected.length === 0) {
        showRemoveResult({ ok: false, text: "Select at least one subscription to mark for destruction." });
        return;
      }

      pendingRemoveTargets = selected;
      const selectedRows = selected
        .map((target) => {
          const key = makeSubscriptionKey(target.projectName, target.environment);
          return removeRowsByKey.get(key);
        })
        .filter(Boolean);
      renderRemoveReviewTable(selectedRows);
      if (removeReviewCard) removeReviewCard.hidden = false;
      const removeReviewTitle = $("#removeReviewCard h2");
      if (removeReviewTitle) {
        removeReviewTitle.textContent = `Review destruction request (${selected.length})`;
      }
      setRemoveSelectionEnabled(false);
      showRemoveResult({ ok: true, text: "Review the subscriptions below and confirm destruction." });
    });

    removeEditButton?.addEventListener("click", () => {
      pendingRemoveTargets = null;
      if (removeReviewCard) removeReviewCard.hidden = true;
      setRemoveSelectionEnabled(true);
      showRemoveResult({ ok: true, text: "Adjust the selection and review again when ready." });
    });

    removeClearButton?.addEventListener("click", () => {
      pendingRemoveTargets = null;
      clearRemoveSelection();
      if (removeReviewCard) removeReviewCard.hidden = true;
      setRemoveSelectionEnabled(true);
      showRemoveResult({ ok: true, text: "Selection cleared." });
    });

    removeConfirmButton?.addEventListener("click", async () => {
      if (removeSubmitting) return;
      if (!pendingRemoveTargets || pendingRemoveTargets.length === 0) {
        showRemoveResult({ ok: false, text: "Nothing to confirm. Select subscriptions first." });
        return;
      }

      try {
        removeSubmitting = true;
        if (removeConfirmButton) removeConfirmButton.disabled = true;
        showRemoveResult({ ok: true, text: "Sending destruction request..." });
        const result = await submitRemoval({ dryRun: false, targets: pendingRemoveTargets });
        pendingRemoveTargets = null;
        if (removeReviewCard) removeReviewCard.hidden = true;
        setRemoveSelectionEnabled(true);
        clearRemoveSelection();

        if (result.mode === "azure-devops") {
          showRemoveResult({ ok: true, text: "Destruction request sent." });
        } else if (result.wroteFile) {
          showRemoveResult({ ok: true, text: `Updated CSV written to:\n${result.wroteFile}` });
        } else if (result.updatedCsv) {
          const prefix = buildLocalPreviewPrefix(result.azdo ?? config.azdo ?? {});
          showRemoveResult({
            ok: true,
            text: `${prefix}Updated CSV generated. Downloading subscriptions.csv...`
          });
          downloadText("subscriptions.csv", result.updatedCsv);
        } else {
          showRemoveResult({ ok: true, text: "Done." });
        }
      } catch (err) {
        showRemoveResult({ ok: false, text: await buildAzdoErrorMessage(err) });
        setRemoveSelectionEnabled(true);
      } finally {
        removeSubmitting = false;
        if (removeConfirmButton) removeConfirmButton.disabled = false;
      }
    });
  }

  const form = $("#requestsForm");
  const requestsContainer = $("#requests");
  const requestTemplate = document.getElementById("requestTemplate");
  if (!requestTemplate) throw new Error("Missing request template.");

  function createRequestModule() {
    const moduleEl = requestTemplate.content.firstElementChild.cloneNode(true);

    const environmentSelect = moduleEl.querySelector('[name="environment"]');
    fillSelect(environmentSelect, config.options.environments, config.options.environments[0]);
    setupEnvironmentPicker(moduleEl, config.options.environments);
    fillSelect(
      moduleEl.querySelector('[name="managementGroupId"]'),
      config.options.managementGroups,
      config.defaults.managementGroupId
    );
    fillSelect(moduleEl.querySelector('[name="location"]'), config.options.locations, config.defaults.location);

    moduleEl.querySelector('[name="department"]').value = config.defaults.department ?? "";
    moduleEl.querySelector('[name="team"]').value = config.defaults.team ?? "";
    moduleEl.querySelector('[name="owner"]').value = config.defaults.owner ?? "";
    moduleEl.querySelector('[name="costCenter"]').value = config.defaults.costCenter ?? "";
    if (!isAdmin) {
      moduleEl.querySelector("[data-admin-group-fields]")?.remove();
    } else {
      setupAccessGroupToggles(moduleEl);
      setupAccessGroupNameSuggestions(moduleEl);
      setupEnvironmentSpecificAccessGroups(moduleEl);
    }

    moduleEl.querySelector("[data-remove-module]")?.addEventListener("click", () => {
      const current = getRequestModules();
      if (current.length <= 1) return;
      moduleEl.remove();
      updateRequestModuleIndices();
      $("#reviewCard").hidden = true;
    });

    requestsContainer.appendChild(moduleEl);
    updateRequestModuleIndices();
  }

  createRequestModule();
  $("#addRequestButton").addEventListener("click", () => {
    createRequestModule();
    $("#reviewCard").hidden = true;
  });

  if (!showDryRun) {
    $("#dryRunButton")?.remove();
  }

  let pendingPayload = null;
  let requestSubmitting = false;

  $("#dryRunButton")?.addEventListener("click", async () => {
    try {
      validateEnvironmentSelections();
      if (!form.reportValidity()) return;
      showResult({ ok: true, text: "Running dry run..." });
      const payload = buildBatchPayload();
      const result = await submitBatch({ dryRun: true, payload });

      if (Array.isArray(result.previewHeaders) && Array.isArray(result.previewRows)) {
        showResult({
          ok: true,
          content: renderRainbowCsvBatchPreview({ headers: result.previewHeaders, rows: result.previewRows })
        });
        return;
      }
      showResult({ ok: true, text: "Dry run OK." });
    } catch (err) {
      showResult({ ok: false, text: await buildAzdoErrorMessage(err) });
    }
  });

  $("#reviewButton").addEventListener("click", async () => {
    try {
      validateEnvironmentSelections();
      if (!form.reportValidity()) return;
      showResult({ ok: true, text: "Validating requests..." });
      const payload = buildBatchPayload();
      const result = await submitBatch({ dryRun: true, payload });

      pendingPayload = payload;
      renderReviewTableFromPreview({ headers: result.previewHeaders, previewRows: result.previewRows });
      $("#reviewCard").hidden = false;
      $("#reviewCard h2").textContent = `Review requested subscriptions (${payload.requests.length})`;
      $("#confirmButton").textContent =
        config.mode === "azure-devops" ? "Confirm & submit request" : "Confirm & download CSV";
      setEditingEnabled(false);
      showResult({
        ok: true,
        text:
          config.mode === "azure-devops"
            ? "Review the subscriptions below and confirm to submit the request for approval."
            : "Review the subscriptions below and confirm to download the updated CSV."
      });
    } catch (err) {
      pendingPayload = null;
      $("#reviewCard").hidden = true;
      setEditingEnabled(true);
      showResult({ ok: false, text: await buildAzdoErrorMessage(err) });
    }
  });

  $("#editButton").addEventListener("click", () => {
    pendingPayload = null;
    $("#reviewCard").hidden = true;
    setEditingEnabled(true);
    showResult({ ok: true, text: "Edit the requests and review again when ready." });
  });

  $("#confirmButton").addEventListener("click", async () => {
    if (requestSubmitting) return;
    if (!pendingPayload) {
      showResult({ ok: false, text: "Nothing to confirm. Click 'Send request for subscriptions' first." });
      return;
    }

    try {
      requestSubmitting = true;
      $("#confirmButton").disabled = true;
      showResult({
        ok: true,
        text: "Sending request..."
      });
      const result = await submitBatch({ dryRun: false, payload: pendingPayload });
      pendingPayload = null;
      $("#reviewCard").hidden = true;
      setEditingEnabled(true);

      if (result.mode === "azure-devops") {
        showResult({ ok: true, text: "Request sent." });
      } else if (result.wroteFile) {
        showResult({ ok: true, text: `Updated CSV written to:\n${result.wroteFile}` });
      } else if (result.updatedCsv) {
        const prefix = buildLocalPreviewPrefix(result.azdo ?? config.azdo ?? {});
        showResult({ ok: true, text: `${prefix}Updated CSV generated. Downloading subscriptions.csv...` });
        downloadText("subscriptions.csv", result.updatedCsv);
      } else {
        showResult({ ok: true, text: "Done." });
      }
    } catch (err) {
      showResult({ ok: false, text: await buildAzdoErrorMessage(err) });
    } finally {
      requestSubmitting = false;
      $("#confirmButton").disabled = false;
    }
  });
}

if (typeof document !== "undefined") {
  main().catch((err) => showResult({ ok: false, text: err?.message ?? String(err) }));
}

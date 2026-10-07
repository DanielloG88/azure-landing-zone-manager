import Papa from "papaparse";

function detectNewline(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function getTodayStamp() {
  return new Date().toISOString().slice(0, 10);
}

const alwaysQuotedColumns = new Set(["department", "team", "owner", "cost-center", "billing_scope"]);

function normalizeKeyPart(value) {
  return String(value ?? "").trim().toLowerCase();
}

function makeSubscriptionKey(projectName, environment) {
  const name = normalizeKeyPart(projectName);
  if (!name) return "";
  const env = normalizeKeyPart(environment);
  return `${name}::${env}`;
}

function formatSubscriptionLabel(projectName, environment) {
  const name = String(projectName ?? "").trim();
  const env = String(environment ?? "").trim();
  if (!env) return name;
  return `${name} (${env})`;
}

function makeQuotesFn(headers) {
  const cols = Array.isArray(headers) ? headers : [];
  let headerCallsRemaining = cols.length;

  return (_value, col) => {
    if (headerCallsRemaining > 0) {
      headerCallsRemaining--;
      return false;
    }

    const name = cols[col];
    return Boolean(name && alwaysQuotedColumns.has(name));
  };
}

function formatCsvValue(value, forceQuote) {
  const str = String(value ?? "");
  const needsQuote = forceQuote || /[",\r\n]/.test(str) || /^\s|\s$/.test(str);
  if (!needsQuote) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

function formatCsvRow(headers, row) {
  return headers
    .map((header) => formatCsvValue(row?.[header] ?? "", alwaysQuotedColumns.has(header)))
    .join(",");
}

function canAppendRows(headers, newRows) {
  const headerSet = new Set(headers);
  const rows = Array.isArray(newRows) ? newRows : [];
  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) {
      if (!headerSet.has(key)) return false;
    }
  }
  return true;
}

function appendRowsToCsv({ csvText, headers, newRows }) {
  const newline = detectNewline(csvText);
  const rows = Array.isArray(newRows) ? newRows : [];
  if (rows.length === 0) return csvText;

  let updated = csvText;
  if (!/\r?\n$/.test(updated)) {
    updated += newline;
  }

  const lines = rows.map((row) => formatCsvRow(headers, row));
  updated += `${lines.join(newline)}${newline}`;
  return updated;
}

export function parseSubscriptionsCsv(csvText) {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true
  });

  const fatalErrors = (parsed.errors ?? []).filter((error) => error.code !== "TooFewFields");
  if (fatalErrors.length) {
    const message = fatalErrors.map((e) => e.message).join("; ");
    throw new Error(`Failed to parse subscriptions.csv: ${message}`);
  }

  const headers = parsed.meta?.fields ?? [];
  const rows = (Array.isArray(parsed.data) ? parsed.data : []).map((row) => {
    const normalized = {};
    for (const header of headers) {
      normalized[header] = row?.[header] ?? "";
    }
    return normalized;
  });
  return { headers, rows };
}

export function addSubscriptionToCsv({ csvText, newRow }) {
  const newline = detectNewline(csvText);
  const { headers: existingHeaders, rows: existingRows } = parseSubscriptionsCsv(csvText);

  const existingKeys = new Set(
    existingRows
      .map((row) => makeSubscriptionKey(row.project_name, row.environment))
      .filter((key) => key.length > 0)
  );
  const incomingKey = makeSubscriptionKey(newRow.project_name, newRow.environment);
  if (incomingKey && existingKeys.has(incomingKey)) {
    const label = formatSubscriptionLabel(newRow.project_name, newRow.environment);
    throw new Error(`project_name already exists for environment: ${label}`);
  }

  if (canAppendRows(existingHeaders, [newRow])) {
    return appendRowsToCsv({ csvText, headers: existingHeaders, newRows: [newRow] });
  }

  const newKeys = Object.keys(newRow);
  const headers = [...existingHeaders];
  for (const key of newKeys) {
    if (!headers.includes(key)) headers.push(key);
  }

  const normalisedRows = existingRows.map((row) => {
    const normalised = {};
    for (const header of headers) {
      normalised[header] = row?.[header] ?? "";
    }
    return normalised;
  });

  const normalisedNewRow = {};
  for (const header of headers) {
    normalisedNewRow[header] = newRow?.[header] ?? "";
  }
  normalisedRows.push(normalisedNewRow);

  const updated = Papa.unparse(normalisedRows, {
    header: true,
    columns: headers,
    newline,
    quotes: makeQuotesFn(headers)
  });

  return updated.endsWith(newline) ? updated : `${updated}${newline}`;
}

export function addSubscriptionsToCsv({ csvText, newRows }) {
  const rowsToAdd = Array.isArray(newRows) ? newRows : [];
  if (rowsToAdd.length === 0) return csvText;

  const newline = detectNewline(csvText);
  const { headers: existingHeaders, rows: existingRows } = parseSubscriptionsCsv(csvText);

  const existingKeys = new Set(
    existingRows
      .map((row) => makeSubscriptionKey(row.project_name, row.environment))
      .filter((key) => key.length > 0)
  );

  const incomingKeys = new Set();
  for (const newRow of rowsToAdd) {
    const incomingKey = makeSubscriptionKey(newRow?.project_name, newRow?.environment);
    if (incomingKey.length === 0) continue;

    if (incomingKeys.has(incomingKey)) {
      const label = formatSubscriptionLabel(newRow?.project_name, newRow?.environment);
      throw new Error(`Duplicate project_name and environment in request: ${label}`);
    }
    incomingKeys.add(incomingKey);

    if (existingKeys.has(incomingKey)) {
      const label = formatSubscriptionLabel(newRow?.project_name, newRow?.environment);
      throw new Error(`project_name already exists for environment: ${label}`);
    }
  }

  if (canAppendRows(existingHeaders, rowsToAdd)) {
    return appendRowsToCsv({ csvText, headers: existingHeaders, newRows: rowsToAdd });
  }

  const headers = [...existingHeaders];
  for (const newRow of rowsToAdd) {
    for (const key of Object.keys(newRow ?? {})) {
      if (!headers.includes(key)) headers.push(key);
    }
  }

  const normalisedRows = existingRows.map((row) => {
    const normalised = {};
    for (const header of headers) {
      normalised[header] = row?.[header] ?? "";
    }
    return normalised;
  });

  for (const newRow of rowsToAdd) {
    const normalisedNewRow = {};
    for (const header of headers) {
      normalisedNewRow[header] = newRow?.[header] ?? "";
    }
    normalisedRows.push(normalisedNewRow);
  }

  const updated = Papa.unparse(normalisedRows, {
    header: true,
    columns: headers,
    newline,
    quotes: makeQuotesFn(headers)
  });

  return updated.endsWith(newline) ? updated : `${updated}${newline}`;
}

export function updateSubscriptionInCsv({ csvText, target, patch } = {}) {
  const projectName = String(target?.projectName ?? "").trim();
  const environment = String(target?.environment ?? "").trim();
  const targetKey = makeSubscriptionKey(projectName, environment);
  if (!targetKey) {
    throw new Error("Invalid subscription key for update.");
  }

  const patchObject = patch && typeof patch === "object" ? patch : {};
  const newline = detectNewline(csvText);
  const { headers: existingHeaders, rows: existingRows } = parseSubscriptionsCsv(csvText);

  let rowIndex = -1;
  for (let i = 0; i < existingRows.length; i++) {
    const row = existingRows[i];
    const key = makeSubscriptionKey(row?.project_name, row?.environment);
    if (key === targetKey) {
      rowIndex = i;
      break;
    }
  }

  if (rowIndex < 0) {
    throw new Error(`Subscription not found in CSV: ${formatSubscriptionLabel(projectName, environment)}`);
  }

  const headers = [...existingHeaders];
  for (const key of Object.keys(patchObject)) {
    if (!headers.includes(key)) headers.push(key);
  }

  const normalisedRows = existingRows.map((row, index) => {
    const normalised = {};
    for (const header of headers) {
      normalised[header] = row?.[header] ?? "";
    }
    if (index !== rowIndex) return normalised;

    for (const [key, value] of Object.entries(patchObject)) {
      normalised[key] = value ?? "";
    }
    return normalised;
  });

  const updated = Papa.unparse(normalisedRows, {
    header: true,
    columns: headers,
    newline,
    quotes: makeQuotesFn(headers)
  });

  const updatedCsv = updated.endsWith(newline) ? updated : `${updated}${newline}`;
  return {
    updatedCsv,
    updatedRow: normalisedRows[rowIndex],
    headers
  };
}

export function markSubscriptionsDestroyedInCsv({ csvText, targets, destroyedAt } = {}) {
  const list = Array.isArray(targets) ? targets : [];
  const targetMap = new Map();
  for (const target of list) {
    const projectName = String(target?.projectName ?? "").trim();
    const environment = String(target?.environment ?? "").trim();
    const key = makeSubscriptionKey(projectName, environment);
    if (!key) continue;
    targetMap.set(key, { projectName, environment });
  }

  const targetKeys = new Set(targetMap.keys());
  if (targetKeys.size === 0) {
    throw new Error("No subscriptions selected for destruction.");
  }

  const stamp = destroyedAt || getTodayStamp();
  const newline = detectNewline(csvText);
  const { headers: existingHeaders, rows: existingRows } = parseSubscriptionsCsv(csvText);
  let headers = existingHeaders.includes("destroy") ? [...existingHeaders] : [...existingHeaders, "destroy"];
  if (!headers.includes("destroyed_at")) {
    headers = [...headers, "destroyed_at"];
  }

  const updatedRows = [];
  const markedRows = [];
  const foundKeys = new Set();

  for (const row of existingRows) {
    const projectName = String(row?.project_name ?? "").trim();
    const environment = String(row?.environment ?? "").trim();
    const key = makeSubscriptionKey(projectName, environment);
    if (key && targetKeys.has(key)) {
      const currentDestroyedAt = String(row?.destroyed_at ?? "").trim();
      const updatedRow = {
        ...row,
        destroy: "true",
        destroyed_at: currentDestroyedAt ? currentDestroyedAt : stamp
      };
      updatedRows.push(updatedRow);
      markedRows.push(updatedRow);
      foundKeys.add(key);
      continue;
    }
    updatedRows.push(row);
  }

  const missing = [];
  for (const [key, target] of targetMap.entries()) {
    if (!foundKeys.has(key)) {
      missing.push(formatSubscriptionLabel(target.projectName, target.environment));
    }
  }
  if (missing.length > 0) {
    throw new Error(`Subscriptions not found in CSV: ${missing.join(", ")}`);
  }

  const updated = Papa.unparse(updatedRows, {
    header: true,
    columns: headers,
    newline,
    quotes: makeQuotesFn(headers)
  });

  const updatedCsv = updated.endsWith(newline) ? updated : `${updated}${newline}`;
  return { updatedCsv, markedRows, headers };
}

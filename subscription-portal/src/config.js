import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadEnvFileIfPresent(filePath, { allowedKeys } = {}) {
  try {
    if (!fs.existsSync(filePath)) return;
    const allowed = Array.isArray(allowedKeys) ? new Set(allowedKeys) : null;
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;

      const key = match[1];
      if (allowed && !allowed.has(key)) continue;
      let value = match[2] ?? "";

      const isQuoted =
        (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
      if (isQuoted) value = value.slice(1, -1);

      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // If the .env is malformed or unreadable, fall back to process.env.
  }
}

function parseCsvList(value, fallback) {
  if (!value || value.trim() === "") return fallback;
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseBoolEnv(value, fallback) {
  if (value == null || String(value).trim() === "") return fallback;
  const normalised = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalised)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalised)) return false;
  return fallback;
}

function parseAzdoAuthMode(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (normalized === "" || normalized === "managed_identity") return "managed_identity";
  throw new Error(`Unsupported AZDO_AUTH_MODE '${value}'. Only managed_identity is allowed.`);
}

function parseRepoPath(value, fallback = "/infrastructure/subscriptions.csv") {
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const segments = withLeadingSlash.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Invalid AZDO_SUBSCRIPTIONS_PATH '${value}'. Use an absolute repository path.`);
  }
  return `/${segments.join("/")}`;
}

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const portalRoot = path.resolve(srcDir, "..");
const repoRoot = path.resolve(portalRoot, "..");
loadEnvFileIfPresent(path.join(portalRoot, ".env"));
loadEnvFileIfPresent(path.join(portalRoot, ".env.example"), {
  allowedKeys: [
    "PORTAL_UI_SHOW_MODE_BANNER",
    "PORTAL_UI_SHOW_DRY_RUN",
    "PORTAL_UI_SHOW_EXISTING_SUBSCRIPTIONS"
  ]
});

const authBearerClientId = process.env.PORTAL_AUTH_AAD_CLIENT_ID;
const authBearerTenantId = process.env.PORTAL_AUTH_AAD_TENANT_ID;
const authBearerScopes = parseCsvList(process.env.PORTAL_AUTH_AAD_SCOPES, []);
if (authBearerScopes.length === 0 && authBearerClientId) {
  authBearerScopes.push(`api://${authBearerClientId}/.default`);
}

export const portalConfig = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? "3000"),

  subscriptionsCsvPath: (() => {
    return process.env.SUBSCRIPTIONS_CSV_PATH
      ? path.resolve(portalRoot, process.env.SUBSCRIPTIONS_CSV_PATH)
      : path.resolve(repoRoot, "infrastructure", "subscriptions.csv");
  })(),

  writeLocal: (process.env.PORTAL_WRITE_LOCAL ?? "false").toLowerCase() === "true",

  options: {
    environments: parseCsvList(process.env.PORTAL_ENVIRONMENTS, ["dev", "test", "prod"]),
    managementGroups: parseCsvList(process.env.PORTAL_MANAGEMENT_GROUPS, ["LandingZones", "Platform", "Sandbox"]),
    locations: parseCsvList(process.env.PORTAL_LOCATIONS, ["westeurope", "northeurope"])
  },

  defaults: {
    location: process.env.PORTAL_DEFAULT_LOCATION ?? "westeurope",
    managementGroupId: process.env.PORTAL_DEFAULT_MANAGEMENT_GROUP_ID ?? "LandingZones",
    department: process.env.PORTAL_DEFAULT_DEPARTMENT ?? "Platform Engineering",
    team: process.env.PORTAL_DEFAULT_TEAM ?? "Cloud Operations",
    owner: process.env.PORTAL_DEFAULT_OWNER ?? "",
    costCenter: process.env.PORTAL_DEFAULT_COST_CENTER ?? "CC-001",
    billingScope: process.env.PORTAL_DEFAULT_BILLING_SCOPE ?? ""
  },

  ui: {
    showModeBanner: parseBoolEnv(process.env.PORTAL_UI_SHOW_MODE_BANNER, true),
    showDryRun: parseBoolEnv(process.env.PORTAL_UI_SHOW_DRY_RUN, true),
    showExistingSubscriptions: parseBoolEnv(process.env.PORTAL_UI_SHOW_EXISTING_SUBSCRIPTIONS, true)
  },

  azureDevOps: {
    orgUrl: process.env.AZDO_ORG_URL,
    project: process.env.AZDO_PROJECT,
    repoId: process.env.AZDO_REPO_ID,
    authMode: parseAzdoAuthMode(process.env.AZDO_AUTH_MODE),
    managedIdentityClientId: process.env.AZDO_MANAGED_IDENTITY_CLIENT_ID ?? "",
    targetBranch: process.env.AZDO_TARGET_BRANCH ?? "main",
    subscriptionsPath: parseRepoPath(process.env.AZDO_SUBSCRIPTIONS_PATH),
    enabled: parseBoolEnv(process.env.PORTAL_AZDO_ENABLED, true)
  },

  auth: {
    bearer: {
      enabled: parseBoolEnv(process.env.PORTAL_AUTH_BEARER_ENABLED, false),
      clientId: authBearerClientId,
      tenantId: authBearerTenantId,
      scopes: authBearerScopes
    },
    adminGroups: parseCsvList(process.env.PORTAL_AUTH_ADMIN_GROUPS, []),
    requesterGroups: parseCsvList(process.env.PORTAL_AUTH_REQUESTER_GROUPS, [])
  }
};

export function isAzureDevOpsConfigured() {
  return getAzureDevOpsStatus().configured;
}

export function isAzureDevOpsEnabled() {
  return getAzureDevOpsStatus().active;
}

export function getAzureDevOpsStatus() {
  const { orgUrl, project, repoId, authMode, managedIdentityClientId, subscriptionsPath } =
    portalConfig.azureDevOps;
  const enabled = portalConfig.azureDevOps.enabled !== false;
  const missing = [];

  if (!orgUrl) missing.push("AZDO_ORG_URL");
  if (!project) missing.push("AZDO_PROJECT");
  if (!repoId) missing.push("AZDO_REPO_ID");

  const configured = missing.length === 0;
  const active = configured && enabled;

  return {
    configured,
    enabled,
    active,
    missing,
    authMode,
    subscriptionsPath,
    managedIdentityClientIdConfigured: Boolean(String(managedIdentityClientId ?? "").trim())
  };
}

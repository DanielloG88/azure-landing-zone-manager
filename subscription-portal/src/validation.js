import { z } from "zod";
import { networkFields, networkFieldMap, validateNetworkRequest } from "./networking.js";

const groupNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/, "Use letters, numbers, spaces, dots, underscores and hyphens only.");

const optionalGroupNameSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return value.trim() === "" ? undefined : value;
}, groupNameSchema.optional());

const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9.-]*$/i, "Use letters, numbers, dots and hyphens only.")
  .transform((value) => value.toLowerCase());

const environmentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, "Use letters, numbers and hyphens only.")
  .transform((value) => value.toLowerCase());

function splitMemberValues(value) {
  return String(value ?? "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidMemberList(value) {
  const list = splitMemberValues(value);
  const upnRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;
  return list.every((item) => upnRegex.test(item));
}

const memberListSchema = z
  .string()
  .trim()
  .max(4000)
  .refine(isValidMemberList, "Use comma/semicolon/newline-separated user UPNs (e.g. user@example.com).");

const subscriptionRequestBaseSchema = z
  .object({
    ...networkFields,
    projectName: projectNameSchema,
    environment: environmentNameSchema,
    managementGroupId: z.string().trim().min(1).max(64),

    location: z.string().trim().min(1).max(64).optional(),
    billingScope: z.string().trim().min(1).optional(),
    destroy: z.boolean().optional(),

    department: z.string().trim().optional(),
    team: z.string().trim().optional(),
    owner: z.string().trim().optional(),
    costCenter: z.string().trim().optional(),
    subOwnerGroupEnabled: z.boolean().optional(),
    subContributorGroupEnabled: z.boolean().optional(),
    subReaderGroupEnabled: z.boolean().optional(),
    subOwnerGroupName: optionalGroupNameSchema,
    subContributorGroupName: optionalGroupNameSchema,
    subReaderGroupName: optionalGroupNameSchema,
    subOwnerMembers: memberListSchema.optional(),
    subContributorMembers: memberListSchema.optional(),
    subReaderMembers: memberListSchema.optional(),

    confidentiality: z.string().trim().optional(),
    workloadId: z.string().trim().optional(),
    app: z.string().trim().optional(),
    compliance: z.string().trim().optional(),
    project: z.string().trim().optional(),
    sla: z.string().trim().optional(),
    leanIX: z.string().trim().optional(),

    dryRun: z.boolean().optional()
  })
  .strict();

export const subscriptionRequestSchema = subscriptionRequestBaseSchema.superRefine(validateNetworkRequest);
export const subscriptionRequestItemSchema = subscriptionRequestBaseSchema.omit({ dryRun: true }).superRefine(validateNetworkRequest);

const subscriptionUpdateBaseSchema = z
  .object({
    ...networkFields,
    projectName: projectNameSchema,
    environment: environmentNameSchema,
    managementGroupId: z.string().trim().min(1).max(64).optional(),
    location: z.string().trim().min(1).max(64).optional(),
    billingScope: z.string().trim().optional(),
    department: z.string().trim().optional(),
    team: z.string().trim().optional(),
    owner: z.string().trim().optional(),
    costCenter: z.string().trim().optional(),
    subOwnerGroupEnabled: z.boolean().optional(),
    subContributorGroupEnabled: z.boolean().optional(),
    subReaderGroupEnabled: z.boolean().optional(),
    subOwnerGroupName: optionalGroupNameSchema,
    subContributorGroupName: optionalGroupNameSchema,
    subReaderGroupName: optionalGroupNameSchema,
    subOwnerMembers: memberListSchema.optional(),
    subContributorMembers: memberListSchema.optional(),
    subReaderMembers: memberListSchema.optional(),
    confidentiality: z.string().trim().optional(),
    workloadId: z.string().trim().optional(),
    app: z.string().trim().optional(),
    compliance: z.string().trim().optional(),
    project: z.string().trim().optional(),
    sla: z.string().trim().optional(),
    leanIX: z.string().trim().optional(),
    dryRun: z.boolean().optional()
  })
  .strict();

export const subscriptionUpdateSchema = subscriptionUpdateBaseSchema.superRefine(validateNetworkRequest);

export const subscriptionRequestsBatchSchema = z
  .object({
    requests: z.array(subscriptionRequestItemSchema).min(1).max(25),
    dryRun: z.boolean().optional()
  })
  .strict();

export const subscriptionRemovalSchema = z
  .object({
    targets: z
      .array(
        z.object({
          projectName: projectNameSchema,
          environment: environmentNameSchema
        })
      )
      .min(1)
      .max(100),
    dryRun: z.boolean().optional()
  })
  .strict();

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

function sanitizeCsvValue(value) {
  if (value == null) return "";
  const str = String(value);
  if (str === "" || str.startsWith("'")) return str;
  return /^\s*[=+\-@]/.test(str) ? `'${str}` : str;
}

function normalizeSegment(value, fallback) {
  const safe = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe || fallback;
}

function buildDefaultGroupName({ projectName, environment, role }) {
  const project = normalizeSegment(projectName, "project");
  const env = normalizeSegment(environment, "env");
  return `Azure-SUB-${project}-${env}-${role}`;
}

function resolveGroupName(customValue, fallbackValue) {
  const value = String(customValue ?? "").trim();
  return value || fallbackValue;
}

function normalizeMemberList(value) {
  const input = splitMemberValues(value);
  const unique = [];
  const seen = new Set();
  for (const item of input) {
    const normalized = item.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique.join(";");
}

function isGroupEnabled(value) {
  return value === true;
}

function resolveGroupSettings({ enabled, customName, members, defaultName }) {
  if (!isGroupEnabled(enabled)) {
    return {
      enabled: "false",
      groupName: "",
      members: ""
    };
  }

  return {
    enabled: "true",
    groupName: resolveGroupName(customName, defaultName),
    members: normalizeMemberList(members)
  };
}

export function toCsvRow(request, defaults) {
  const safe = (value) => sanitizeCsvValue(value ?? "");
  const cleanProjectName = stripEnvironmentSuffix(request.projectName, request.environment);
  const subOwnerGroup = resolveGroupSettings({
    enabled: request.subOwnerGroupEnabled,
    customName: request.subOwnerGroupName,
    members: request.subOwnerMembers,
    defaultName: buildDefaultGroupName({ projectName: cleanProjectName, environment: request.environment, role: "Owner" })
  });
  const subContributorGroup = resolveGroupSettings({
    enabled: request.subContributorGroupEnabled,
    customName: request.subContributorGroupName,
    members: request.subContributorMembers,
    defaultName: buildDefaultGroupName({ projectName: cleanProjectName, environment: request.environment, role: "Contributor" })
  });
  const subReaderGroup = resolveGroupSettings({
    enabled: request.subReaderGroupEnabled,
    customName: request.subReaderGroupName,
    members: request.subReaderMembers,
    defaultName: buildDefaultGroupName({ projectName: cleanProjectName, environment: request.environment, role: "Reader" })
  });
  const row = {
    project_name: safe(cleanProjectName),
    environment: safe(request.environment),
    management_group_id: safe(request.managementGroupId),
    location: safe(request.location ?? defaults.location),
    destroy: String(request.destroy ?? false).toLowerCase(),
    destroyed_at: "",
    department: safe(request.department ?? defaults.department),
    team: safe(request.team ?? defaults.team),
    owner: safe(request.owner ?? defaults.owner),
    "cost-center": safe(request.costCenter ?? defaults.costCenter),
    billing_scope: safe(request.billingScope ?? defaults.billingScope),
    network_mode: request.networkMode ?? "none",
    network_hub_key: request.networkMode === "spoke" ? safe(request.networkHubKey) : "",
    network_address_space: request.networkMode === "spoke" ? safe(request.networkAddressSpace) : "",
    network_workload_subnet_prefix: request.networkMode === "spoke" ? safe(request.networkWorkloadSubnetPrefix) : "",
    network_private_endpoint_subnet_prefix: request.networkMode === "spoke" ? safe(request.networkPrivateEndpointSubnetPrefix) : "",
    sub_owner_group_enabled: subOwnerGroup.enabled,
    sub_contributor_group_enabled: subContributorGroup.enabled,
    sub_reader_group_enabled: subReaderGroup.enabled,
    sub_owner_group_name: safe(subOwnerGroup.groupName),
    sub_contributor_group_name: safe(subContributorGroup.groupName),
    sub_reader_group_name: safe(subReaderGroup.groupName),
    sub_owner_members: safe(subOwnerGroup.members),
    sub_contributor_members: safe(subContributorGroup.members),
    sub_reader_members: safe(subReaderGroup.members),
    confidentiality: safe(request.confidentiality ?? ""),
    "workload-id": safe(request.workloadId ?? ""),
    app: safe(request.app ?? ""),
    compliance: safe(request.compliance ?? ""),
    project: safe(request.project ?? ""),
    sla: safe(request.sla ?? ""),
    leanIX: safe(request.leanIX ?? "")
  };

  return row;
}

const updateFieldMap = {
  ...networkFieldMap,
  managementGroupId: "management_group_id",
  location: "location",
  department: "department",
  team: "team",
  owner: "owner",
  costCenter: "cost-center",
  billingScope: "billing_scope",
  confidentiality: "confidentiality",
  workloadId: "workload-id",
  app: "app",
  compliance: "compliance",
  project: "project",
  sla: "sla",
  leanIX: "leanIX"
};

const updateGroupFields = [
  {
    enabled: "subOwnerGroupEnabled",
    name: "subOwnerGroupName",
    members: "subOwnerMembers",
    enabledColumn: "sub_owner_group_enabled",
    nameColumn: "sub_owner_group_name",
    membersColumn: "sub_owner_members"
  },
  {
    enabled: "subContributorGroupEnabled",
    name: "subContributorGroupName",
    members: "subContributorMembers",
    enabledColumn: "sub_contributor_group_enabled",
    nameColumn: "sub_contributor_group_name",
    membersColumn: "sub_contributor_members"
  },
  {
    enabled: "subReaderGroupEnabled",
    name: "subReaderGroupName",
    members: "subReaderMembers",
    enabledColumn: "sub_reader_group_enabled",
    nameColumn: "sub_reader_group_name",
    membersColumn: "sub_reader_members"
  }
];

export function toCsvPatch(request, defaults = {}) {
  const source = request && typeof request === "object" ? request : {};
  const normalizedRow = toCsvRow(source, defaults);
  const patch = {};

  for (const [requestField, csvColumn] of Object.entries(updateFieldMap)) {
    if (Object.hasOwn(source, requestField)) {
      patch[csvColumn] = normalizedRow[csvColumn];
    }
  }

  if (source.networkMode === "none") {
    for (const column of Object.values(networkFieldMap).slice(1)) patch[column] = "";
  }

  for (const group of updateGroupFields) {
    const enabledProvided = Object.hasOwn(source, group.enabled);
    const nameProvided = Object.hasOwn(source, group.name);
    const membersProvided = Object.hasOwn(source, group.members);

    if (enabledProvided) {
      patch[group.enabledColumn] = normalizedRow[group.enabledColumn];
      if (source[group.enabled] === false) {
        patch[group.nameColumn] = "";
        patch[group.membersColumn] = "";
        continue;
      }
    }

    if (!nameProvided && !membersProvided) continue;

    const enabledRow =
      source[group.enabled] === true
        ? normalizedRow
        : toCsvRow(
            {
              ...source,
              [group.enabled]: true
            },
            defaults
          );

    if (nameProvided) {
      patch[group.nameColumn] = enabledRow[group.nameColumn];
    }
    if (membersProvided) {
      patch[group.membersColumn] = enabledRow[group.membersColumn];
    }
  }

  return patch;
}

export function makeBranchName({ projectName, environment }) {
  const baseName = stripEnvironmentSuffix(projectName, environment);
  const safe = `${baseName || projectName}-${environment}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `subscription-request/${safe}-${stamp}`.slice(0, 120);
}

export function makeBatchBranchName({ requests }) {
  const first = requests?.[0];
  const hint = first?.projectName
    ? `${stripEnvironmentSuffix(first.projectName, first.environment)}`
    : "batch";
  const safe = hint
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `subscription-request/batch-${safe || "batch"}-${requests?.length ?? 0}-${stamp}`.slice(0, 120);
}

export function makeDestroyBranchName({ targets }) {
  const first = targets?.[0];
  const hint = first ? `${first.projectName}-${first.environment}` : "batch";
  const safe = hint
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `subscription-destroy/${safe || "batch"}-${targets?.length ?? 0}-${stamp}`.slice(0, 120);
}

export function makeUpdateBranchName({ projectName, environment }) {
  const safe = `${projectName}-${environment}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `subscription-update/${safe || "item"}-${stamp}`.slice(0, 120);
}

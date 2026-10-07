import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";

import { getAzureDevOpsStatus, portalConfig, isAzureDevOpsEnabled } from "./config.js";
import {
  createBranch,
  createPullRequest,
  getBranchObjectId,
  getFileContent,
  getFileSnapshot,
  pushFileUpdate
} from "./azdo.js";
import {
  addSubscriptionToCsv,
  addSubscriptionsToCsv,
  updateSubscriptionInCsv,
  parseSubscriptionsCsv,
  markSubscriptionsDestroyedInCsv
} from "./subscriptionsCsv.js";
import {
  makeBatchBranchName,
  makeBranchName,
  makeDestroyBranchName,
  makeUpdateBranchName,
  subscriptionRemovalSchema,
  subscriptionRequestSchema,
  subscriptionUpdateSchema,
  subscriptionRequestsBatchSchema,
  toCsvPatch,
  toCsvRow
} from "./validation.js";

const app = express();
app.disable("x-powered-by");
const cspDirectives = helmet.contentSecurityPolicy.getDefaultDirectives();
const authOrigins = ["https://login.microsoftonline.com"];
const withOrigins = (values) => Array.from(new Set([...(values ?? ["'self'"]), ...authOrigins]));
cspDirectives["connect-src"] = withOrigins(cspDirectives["connect-src"]);
cspDirectives["frame-src"] = withOrigins(cspDirectives["frame-src"]);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: cspDirectives
    }
  })
);
app.use(express.json({ limit: "256kb" }));

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
app.use(express.static(publicDir));

const vendorDir = fileURLToPath(new URL("../node_modules/@azure/msal-browser/lib", import.meta.url));
app.use("/vendor", express.static(vendorDir));


const roleClaimTypes = new Set(["roles", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"]);
const groupClaimTypes = new Set(["groups"]);
const adminRoleValues = new Set(["portal.admin"]);
const requesterRoleValues = new Set(["portal.requester"]);
const userAccessKey = Symbol("userAccess");

const adminGroupIds = new Set(portalConfig.auth.adminGroups.map((value) => String(value ?? "").trim().toLowerCase()));
const requesterGroupIds = new Set(
  portalConfig.auth.requesterGroups.map((value) => String(value ?? "").trim().toLowerCase())
);
const allowRequesterByDefault = !isAzureDevOpsEnabled() && !portalConfig.auth.bearer.enabled &&
  adminGroupIds.size === 0 && requesterGroupIds.size === 0;
const subscriptionAccessConfigFields = [
  "subOwnerGroupEnabled",
  "subContributorGroupEnabled",
  "subReaderGroupEnabled",
  "subOwnerGroupName",
  "subContributorGroupName",
  "subReaderGroupName",
  "subOwnerMembers",
  "subContributorMembers",
  "subReaderMembers"
];

function decodeClientPrincipal(req) {
  const header = req.get("x-ms-client-principal");
  if (!header) return null;
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getClaimValues(principal, claimTypes) {
  const claims = Array.isArray(principal?.claims) ? principal.claims : [];
  const values = [];
  for (const claim of claims) {
    const type = String(claim?.typ ?? "").trim().toLowerCase();
    if (!type || !claimTypes.has(type)) continue;
    const value = String(claim?.val ?? "").trim();
    if (value) values.push(value.toLowerCase());
  }
  return values;
}

function hasAnyMatch(needles, haystack) {
  for (const value of needles) {
    if (!value) continue;
    if (haystack.has(value)) return true;
  }
  return false;
}

function getUserAccess(req) {
  if (req[userAccessKey]) return req[userAccessKey];
  const principal = decodeClientPrincipal(req);
  if (!principal) {
    const access = { isAdmin: false, isRequester: allowRequesterByDefault };
    req[userAccessKey] = access;
    return access;
  }

  const roleSet = new Set(getClaimValues(principal, roleClaimTypes));
  const groupSet = new Set(getClaimValues(principal, groupClaimTypes));

  const isAdmin = hasAnyMatch(adminRoleValues, roleSet) || hasAnyMatch(adminGroupIds, groupSet);
  const isRequester =
    isAdmin || hasAnyMatch(requesterRoleValues, roleSet) || hasAnyMatch(requesterGroupIds, groupSet);

  const access = { isAdmin, isRequester };
  req[userAccessKey] = access;
  return access;
}

function requireAdmin(req, res, next) {
  const access = getUserAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ ok: false, error: "Admin access required." });
    return;
  }
  next();
}

function requireRequester(req, res, next) {
  const access = getUserAccess(req);
  if (!access.isRequester) {
    res.status(403).json({ ok: false, error: "Requester access required." });
    return;
  }
  next();
}

function hasCustomGroupConfig(request) {
  return subscriptionAccessConfigFields.some((field) => {
    const value = request?.[field];
    if (typeof value === "boolean") return value;
    return String(value ?? "").trim() !== "";
  });
}

async function ensureSubscriptionsCsvDir() {
  const dir = path.dirname(portalConfig.subscriptionsCsvPath);
  if (!dir) return;
  await fs.mkdir(dir, { recursive: true });
}

function getSubscriptionsRepoPathForDisplay() {
  return portalConfig.azureDevOps.subscriptionsPath.replace(/^\/+/, "");
}

app.get("/api/config", (req, res) => {
  const azdo = getAzureDevOpsStatus();
  const access = getUserAccess(req);
  res.json({
    mode: azdo.active ? "azure-devops" : "local",
    options: portalConfig.options,
    defaults: portalConfig.defaults,
    ui: portalConfig.ui,
    targetBranch: portalConfig.azureDevOps.targetBranch,
    azdo,
    auth: {
      easyAuth: Boolean(decodeClientPrincipal(req)),
      bearer: portalConfig.auth.bearer,
      user: {
        isAdmin: access.isAdmin,
        isRequester: access.isRequester
      }
    }
  });
});

app.get("/api/azdo/health", async (_req, res) => {
  const azdo = getAzureDevOpsStatus();
  const details = {
    ok: azdo.configured && azdo.enabled,
    azdo: {
      configured: azdo.configured,
      enabled: azdo.enabled,
      active: azdo.active,
      authMode: azdo.authMode,
      missing: azdo.missing,
      targetBranch: portalConfig.azureDevOps.targetBranch,
      subscriptionsPath: portalConfig.azureDevOps.subscriptionsPath,
      orgUrl: portalConfig.azureDevOps.orgUrl,
      project: portalConfig.azureDevOps.project,
      repoId: portalConfig.azureDevOps.repoId
    },
    checks: []
  };

  if (!azdo.configured) {
    res.json(details);
    return;
  }

  const { orgUrl, project, repoId, authMode, managedIdentityClientId, targetBranch } = portalConfig.azureDevOps;
  const runCheck = async (name, fn) => {
    try {
      await fn();
      details.checks.push({ name, ok: true });
    } catch (err) {
      details.ok = false;
      details.checks.push({ name, ok: false, error: err?.message ?? String(err) });
    }
  };

  await runCheck("getBranchObjectId", async () => {
    await getBranchObjectId({ orgUrl, project, repoId, authMode, managedIdentityClientId, branchName: targetBranch });
  });
  await runCheck("readSubscriptionsCsv", async () => {
    await getFileContent({
      orgUrl,
      project,
      repoId,
      authMode,
      managedIdentityClientId,
      path: portalConfig.azureDevOps.subscriptionsPath,
      branchName: targetBranch
    });
  });

  res.json(details);
});

async function readSubscriptionsCsvSnapshot() {
  if (isAzureDevOpsEnabled()) {
    const { orgUrl, project, repoId, authMode, managedIdentityClientId, targetBranch } = portalConfig.azureDevOps;
    return await getFileSnapshot({
      orgUrl,
      project,
      repoId,
      authMode,
      managedIdentityClientId,
      path: portalConfig.azureDevOps.subscriptionsPath,
      branchName: targetBranch
    });
  }
  return {
    content: await fs.readFile(portalConfig.subscriptionsCsvPath, "utf8"),
    commitId: null
  };
}

async function readSubscriptionsCsvText() {
  const snapshot = await readSubscriptionsCsvSnapshot();
  return snapshot.content;
}

app.get("/api/subscriptions", requireAdmin, async (_req, res) => {
  try {
    const csvText = await readSubscriptionsCsvText();
    const parsed = parseSubscriptionsCsv(csvText);
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

app.get("/api/subscriptions.csv", requireAdmin, async (_req, res) => {
  try {
    const csvText = await readSubscriptionsCsvText();
    res.type("text/csv").send(csvText);
  } catch (err) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

app.post("/api/subscriptions/sync", requireAdmin, async (_req, res) => {
  try {
    const azdo = getAzureDevOpsStatus();
    if (!azdo.configured) {
      res.status(400).json({ ok: false, error: "Azure DevOps is not configured." });
      return;
    }

    const { orgUrl, project, repoId, authMode, managedIdentityClientId, targetBranch } = portalConfig.azureDevOps;
    const csvText = await getFileContent({
      orgUrl,
      project,
      repoId,
      authMode,
      managedIdentityClientId,
      path: portalConfig.azureDevOps.subscriptionsPath,
      branchName: targetBranch
    });

    await ensureSubscriptionsCsvDir();
    await fs.writeFile(portalConfig.subscriptionsCsvPath, csvText, "utf8");

    res.json({
      ok: true,
      source: "azure-devops",
      branch: targetBranch,
      bytes: Buffer.byteLength(csvText, "utf8"),
      wroteFile: portalConfig.subscriptionsCsvPath
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

app.post("/api/subscription-requests", requireRequester, async (req, res) => {
  try {
    const request = subscriptionRequestSchema.parse(req.body);
    const access = getUserAccess(req);
    if (!access.isAdmin && hasCustomGroupConfig(request)) {
      res.status(403).json({ ok: false, error: "Only admins can configure subscription access groups." });
      return;
    }
    const newRow = toCsvRow(request, portalConfig.defaults);
    const { content: existingCsv, commitId: baseObjectId } = await readSubscriptionsCsvSnapshot();
    const updatedCsv = addSubscriptionToCsv({ csvText: existingCsv, newRow });

    if (request.dryRun) {
      const parsed = parseSubscriptionsCsv(updatedCsv);
      const lastRow = parsed.rows?.[parsed.rows.length - 1] ?? {};
      const previewHeaders = parsed.headers ?? [];
      const previewRow = previewHeaders.map((h) => lastRow?.[h] ?? "");
      res.json({ ok: true, dryRun: true, updatedCsv, previewHeaders, previewRow });
      return;
    }

    if (isAzureDevOpsEnabled()) {
      const { orgUrl, project, repoId, authMode, managedIdentityClientId, targetBranch } = portalConfig.azureDevOps;
      const branchName = makeBranchName({ projectName: request.projectName, environment: request.environment });

      const steps = [
        `git pull ${targetBranch}`,
        `git checkout -b ${branchName}`,
        `concatenate 1 subscription into ${getSubscriptionsRepoPathForDisplay()}`,
        `create pull request -> ${targetBranch}`,
        "subscriptions pending approval"
      ];

      await createBranch({ orgUrl, project, repoId, authMode, managedIdentityClientId, branchName, baseObjectId });
      await pushFileUpdate({
        orgUrl,
        project,
        repoId,
        authMode,
        managedIdentityClientId,
        branchName,
        oldObjectId: baseObjectId,
        filePath: portalConfig.azureDevOps.subscriptionsPath,
        fileContent: updatedCsv,
        commitMessage: `Add subscription ${request.projectName} (${request.environment})`
      });

      const pr = await createPullRequest({
        orgUrl,
        project,
        repoId,
        authMode,
        managedIdentityClientId,
        sourceBranch: branchName,
        targetBranch,
        title: `Add subscription: ${request.projectName} (${request.environment})`,
        description: [
          "Subscription request created via Subscription Portal.",
          "",
          `project_name: ${request.projectName}`,
          `environment: ${request.environment}`,
          `management_group_id: ${request.managementGroupId}`,
          `location: ${newRow.location}`
        ].join("\n")
      });

      res.json({
        ok: true,
        mode: "azure-devops",
        branchName,
        targetBranch,
        steps,
        pendingApproval: true,
        pullRequest: pr
      });
      return;
    }

    if (portalConfig.writeLocal) {
      await ensureSubscriptionsCsvDir();
      await fs.writeFile(portalConfig.subscriptionsCsvPath, updatedCsv, "utf8");
      res.json({ ok: true, mode: "local", azdo: getAzureDevOpsStatus(), wroteFile: portalConfig.subscriptionsCsvPath });
      return;
    }

    res.json({ ok: true, mode: "local", azdo: getAzureDevOpsStatus(), updatedCsv });
  } catch (err) {
    const message = err?.message ?? String(err);
    res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/subscription-requests/batch", requireRequester, async (req, res) => {
  try {
    const batch = subscriptionRequestsBatchSchema.parse(req.body);
    const requests = batch.requests ?? [];
    const access = getUserAccess(req);
    if (!access.isAdmin && requests.some(hasCustomGroupConfig)) {
      res.status(403).json({ ok: false, error: "Only admins can configure subscription access groups." });
      return;
    }

    const newRows = requests.map((request) => toCsvRow(request, portalConfig.defaults));
    const { content: existingCsv, commitId: baseObjectId } = await readSubscriptionsCsvSnapshot();
    const updatedCsv = addSubscriptionsToCsv({ csvText: existingCsv, newRows });

    if (batch.dryRun) {
      const parsed = parseSubscriptionsCsv(updatedCsv);
      const headers = parsed.headers ?? [];
      const allRows = parsed.rows ?? [];
      const appendedRows = allRows.slice(Math.max(0, allRows.length - newRows.length));
      const previewRows = appendedRows.map((row) => headers.map((h) => row?.[h] ?? ""));
      res.json({ ok: true, dryRun: true, updatedCsv, previewHeaders: headers, previewRows });
      return;
    }

    if (isAzureDevOpsEnabled()) {
      const { orgUrl, project, repoId, authMode, managedIdentityClientId, targetBranch } = portalConfig.azureDevOps;
      const branchName = makeBatchBranchName({ requests });

      const steps = [
        `git pull ${targetBranch}`,
        `git checkout -b ${branchName}`,
        `concatenate ${requests.length} subscriptions into ${getSubscriptionsRepoPathForDisplay()}`,
        `create pull request -> ${targetBranch}`,
        "subscriptions pending approval"
      ];

      await createBranch({ orgUrl, project, repoId, authMode, managedIdentityClientId, branchName, baseObjectId });
      await pushFileUpdate({
        orgUrl,
        project,
        repoId,
        authMode,
        managedIdentityClientId,
        branchName,
        oldObjectId: baseObjectId,
        filePath: portalConfig.azureDevOps.subscriptionsPath,
        fileContent: updatedCsv,
        commitMessage: `Add ${requests.length} subscriptions`
      });

      const description = [
        "Subscription requests created via Subscription Portal.",
        "",
        ...requests.flatMap((request) => [
          `- project_name: ${request.projectName}`,
          `  environment: ${request.environment}`,
          `  management_group_id: ${request.managementGroupId}`,
          `  location: ${request.location ?? portalConfig.defaults.location}`,
          ""
        ])
      ].join("\n");

      const pr = await createPullRequest({
        orgUrl,
        project,
        repoId,
        authMode,
        managedIdentityClientId,
        sourceBranch: branchName,
        targetBranch,
        title: `Add ${requests.length} subscriptions`,
        description
      });

      res.json({
        ok: true,
        mode: "azure-devops",
        branchName,
        targetBranch,
        steps,
        pendingApproval: true,
        pullRequest: pr
      });
      return;
    }

    if (portalConfig.writeLocal) {
      await ensureSubscriptionsCsvDir();
      await fs.writeFile(portalConfig.subscriptionsCsvPath, updatedCsv, "utf8");
      res.json({ ok: true, mode: "local", azdo: getAzureDevOpsStatus(), wroteFile: portalConfig.subscriptionsCsvPath });
      return;
    }

    res.json({ ok: true, mode: "local", azdo: getAzureDevOpsStatus(), updatedCsv });
  } catch (err) {
    const message = err?.message ?? String(err);
    res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/subscription-requests/update", requireAdmin, async (req, res) => {
  try {
    const request = subscriptionUpdateSchema.parse(req.body);
    const patch = toCsvPatch(request, portalConfig.defaults);
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ ok: false, error: "No update fields supplied." });
      return;
    }

    const { content: existingCsv, commitId: baseObjectId } = await readSubscriptionsCsvSnapshot();
    const { updatedCsv, updatedRow, headers } = updateSubscriptionInCsv({
      csvText: existingCsv,
      target: {
        projectName: request.projectName,
        environment: request.environment
      },
      patch
    });

    if (request.dryRun) {
      const previewRow = headers.map((h) => updatedRow?.[h] ?? "");
      res.json({ ok: true, dryRun: true, updatedCsv, previewHeaders: headers, previewRow });
      return;
    }

    if (isAzureDevOpsEnabled()) {
      const { orgUrl, project, repoId, authMode, managedIdentityClientId, targetBranch } = portalConfig.azureDevOps;
      const branchName = makeUpdateBranchName({
        projectName: request.projectName,
        environment: request.environment
      });

      const steps = [
        `git pull ${targetBranch}`,
        `git checkout -b ${branchName}`,
        `update 1 subscription in ${getSubscriptionsRepoPathForDisplay()}`,
        `create pull request -> ${targetBranch}`,
        "update pending approval"
      ];

      await createBranch({ orgUrl, project, repoId, authMode, managedIdentityClientId, branchName, baseObjectId });
      await pushFileUpdate({
        orgUrl,
        project,
        repoId,
        authMode,
        managedIdentityClientId,
        branchName,
        oldObjectId: baseObjectId,
        filePath: portalConfig.azureDevOps.subscriptionsPath,
        fileContent: updatedCsv,
        commitMessage: `Update subscription ${request.projectName} (${request.environment})`
      });

      const pr = await createPullRequest({
        orgUrl,
        project,
        repoId,
        authMode,
        managedIdentityClientId,
        sourceBranch: branchName,
        targetBranch,
        title: `Update subscription: ${request.projectName} (${request.environment})`,
        description: [
          "Subscription update request created via Subscription Portal.",
          "",
          `project_name: ${request.projectName}`,
          `environment: ${request.environment}`,
          `updated_fields: ${Object.keys(patch).join(", ")}`,
          `management_group_id: ${updatedRow?.management_group_id ?? ""}`,
          `location: ${updatedRow?.location ?? ""}`
        ].join("\n")
      });

      res.json({
        ok: true,
        mode: "azure-devops",
        branchName,
        targetBranch,
        steps,
        pendingApproval: true,
        pullRequest: pr
      });
      return;
    }

    if (portalConfig.writeLocal) {
      await ensureSubscriptionsCsvDir();
      await fs.writeFile(portalConfig.subscriptionsCsvPath, updatedCsv, "utf8");
      res.json({ ok: true, mode: "local", azdo: getAzureDevOpsStatus(), wroteFile: portalConfig.subscriptionsCsvPath });
      return;
    }

    res.json({ ok: true, mode: "local", azdo: getAzureDevOpsStatus(), updatedCsv });
  } catch (err) {
    const message = err?.message ?? String(err);
    res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/subscription-requests/remove", requireAdmin, async (req, res) => {
  try {
    const removal = subscriptionRemovalSchema.parse(req.body);
    const targets = Array.isArray(removal.targets) ? removal.targets : [];
    const targetMap = new Map();
    for (const target of targets) {
      const projectName = String(target?.projectName ?? "").trim();
      const environment = String(target?.environment ?? "").trim();
      if (!projectName || !environment) continue;
      const key = `${projectName}::${environment}`;
      if (!targetMap.has(key)) {
        targetMap.set(key, { projectName, environment });
      }
    }
    const uniqueTargets = Array.from(targetMap.values());
    if (uniqueTargets.length === 0) {
      res.status(400).json({ ok: false, error: "No subscriptions selected for destruction." });
      return;
    }

    const { content: existingCsv, commitId: baseObjectId } = await readSubscriptionsCsvSnapshot();
    const { updatedCsv, markedRows, headers } = markSubscriptionsDestroyedInCsv({
      csvText: existingCsv,
      targets: uniqueTargets
    });

    if (removal.dryRun) {
      const previewRows = markedRows.map((row) => headers.map((h) => row?.[h] ?? ""));
      res.json({ ok: true, dryRun: true, updatedCsv, previewHeaders: headers, previewRows });
      return;
    }

    if (isAzureDevOpsEnabled()) {
      const { orgUrl, project, repoId, authMode, managedIdentityClientId, targetBranch } = portalConfig.azureDevOps;
      const branchName = makeDestroyBranchName({ targets: uniqueTargets });

      const steps = [
        `git pull ${targetBranch}`,
        `git checkout -b ${branchName}`,
        `mark ${uniqueTargets.length} subscriptions for destruction in ${getSubscriptionsRepoPathForDisplay()}`,
        `create pull request -> ${targetBranch}`,
        "subscriptions pending approval"
      ];

      await createBranch({ orgUrl, project, repoId, authMode, managedIdentityClientId, branchName, baseObjectId });
      await pushFileUpdate({
        orgUrl,
        project,
        repoId,
        authMode,
        managedIdentityClientId,
        branchName,
        oldObjectId: baseObjectId,
        filePath: portalConfig.azureDevOps.subscriptionsPath,
        fileContent: updatedCsv,
        commitMessage: `Mark ${uniqueTargets.length} subscriptions for destruction`
      });

      const description = [
        "Subscription destruction request created via Subscription Portal.",
        "",
        ...markedRows.flatMap((row) => [
          `- project_name: ${row?.project_name ?? ""}`,
          `  environment: ${row?.environment ?? ""}`,
          `  management_group_id: ${row?.management_group_id ?? ""}`,
          `  location: ${row?.location ?? ""}`,
          ""
        ])
      ].join("\n");

      const pr = await createPullRequest({
        orgUrl,
        project,
        repoId,
        authMode,
        managedIdentityClientId,
        sourceBranch: branchName,
        targetBranch,
        title: `Mark ${uniqueTargets.length} subscriptions for destruction`,
        description
      });

      res.json({
        ok: true,
        mode: "azure-devops",
        branchName,
        targetBranch,
        steps,
        pendingApproval: true,
        pullRequest: pr
      });
      return;
    }

    if (portalConfig.writeLocal) {
      await ensureSubscriptionsCsvDir();
      await fs.writeFile(portalConfig.subscriptionsCsvPath, updatedCsv, "utf8");
      res.json({ ok: true, mode: "local", azdo: getAzureDevOpsStatus(), wroteFile: portalConfig.subscriptionsCsvPath });
      return;
    }

    res.json({ ok: true, mode: "local", azdo: getAzureDevOpsStatus(), updatedCsv });
  } catch (err) {
    const message = err?.message ?? String(err);
    res.status(400).json({ ok: false, error: message });
  }
});

const listener = app.listen(portalConfig.port, portalConfig.host, () => {
  console.log(`Subscription Portal running on http://${portalConfig.host}:${listener.address().port}`);
});

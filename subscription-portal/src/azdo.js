import { ManagedIdentityCredential } from "@azure/identity";

const AZDO_SCOPE = "https://app.vssps.visualstudio.com/.default";
const managedIdentityCredentials = new Map();

function getManagedIdentityCredential(clientId) {
  const key = String(clientId ?? "").trim() || "__system_assigned__";
  let credential = managedIdentityCredentials.get(key);
  if (!credential) {
    credential = key === "__system_assigned__" ? new ManagedIdentityCredential() : new ManagedIdentityCredential(key);
    managedIdentityCredentials.set(key, credential);
  }
  return credential;
}

async function buildAuthHeader({ authMode = "managed_identity", managedIdentityClientId } = {}) {
  if (authMode !== "managed_identity") {
    throw new Error(`Unsupported Azure DevOps auth mode '${authMode}'.`);
  }

  const credential = getManagedIdentityCredential(managedIdentityClientId);
  const token = await credential.getToken(AZDO_SCOPE);
  if (!token?.token) {
    throw new Error("Managed identity token acquisition for Azure DevOps returned an empty token.");
  }
  return `Bearer ${token.token}`;
}

function joinUrl(base, path) {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

async function azdoFetchJson({
  orgUrl,
  project,
  authMode,
  managedIdentityClientId,
  apiPath,
  method = "GET",
  query = {},
  body
}) {
  const url = new URL(joinUrl(orgUrl, `${encodeURIComponent(project)}/_apis/${apiPath}`));
  url.searchParams.set("api-version", query.apiVersion ?? "7.1-preview.1");
  for (const [key, value] of Object.entries(query)) {
    if (key === "apiVersion") continue;
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  const authHeader = await buildAuthHeader({ authMode, managedIdentityClientId });

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Azure DevOps API ${method} ${url} failed: ${res.status} ${res.statusText} - ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function getBranchObjectId({ orgUrl, project, repoId, authMode, managedIdentityClientId, branchName }) {
  const data = await azdoFetchJson({
    orgUrl,
    project,
    authMode,
    managedIdentityClientId,
    apiPath: `git/repositories/${encodeURIComponent(repoId)}/refs`,
    query: { filter: `heads/${branchName}` }
  });
  const ref = data?.value?.[0];
  if (!ref?.objectId) throw new Error(`Branch not found: ${branchName}`);
  return ref.objectId;
}

async function getFileItem({
  orgUrl,
  project,
  repoId,
  authMode,
  managedIdentityClientId,
  path,
  branchName
}) {
  const data = await azdoFetchJson({
    orgUrl,
    project,
    authMode,
    managedIdentityClientId,
    apiPath: `git/repositories/${encodeURIComponent(repoId)}/items`,
    query: {
      path,
      includeContent: true,
      "versionDescriptor.versionType": "branch",
      "versionDescriptor.version": branchName
    }
  });

  return data;
}

export async function getFileContent(options) {
  const data = await getFileItem(options);
  if (typeof data === "string") return data;
  if (typeof data?.content === "string") return data.content;
  throw new Error("Unexpected response when reading file content from Azure DevOps.");
}

export async function getFileSnapshot(options) {
  const data = await getFileItem(options);
  const content = typeof data?.content === "string" ? data.content : null;
  const commitId = String(data?.commitId ?? "").trim();
  if (content === null || !/^[0-9a-f]{40}$/i.test(commitId)) {
    throw new Error("Azure DevOps did not return file content with a valid source commit.");
  }
  return { content, commitId };
}

export async function createBranch({
  orgUrl,
  project,
  repoId,
  authMode,
  managedIdentityClientId,
  branchName,
  baseObjectId
}) {
  const data = await azdoFetchJson({
    orgUrl,
    project,
    authMode,
    managedIdentityClientId,
    method: "POST",
    apiPath: `git/repositories/${encodeURIComponent(repoId)}/refs`,
    body: [
      {
        name: `refs/heads/${branchName}`,
        oldObjectId: "0000000000000000000000000000000000000000",
        newObjectId: baseObjectId
      }
    ]
  });

  const result = Array.isArray(data) ? data[0] : data?.value?.[0];
  if (!result?.success) {
    const status = result?.updateStatus ? ` (${result.updateStatus})` : "";
    const message = result?.customMessage ? `: ${result.customMessage}` : "";
    throw new Error(`Azure DevOps could not create branch ${branchName}${status}${message}`);
  }
}

export async function pushFileUpdate({
  orgUrl,
  project,
  repoId,
  authMode,
  managedIdentityClientId,
  branchName,
  oldObjectId,
  filePath,
  fileContent,
  commitMessage
}) {
  await azdoFetchJson({
    orgUrl,
    project,
    authMode,
    managedIdentityClientId,
    method: "POST",
    apiPath: `git/repositories/${encodeURIComponent(repoId)}/pushes`,
    query: { apiVersion: "7.1-preview.2" },
    body: {
      refUpdates: [
        {
          name: `refs/heads/${branchName}`,
          oldObjectId
        }
      ],
      commits: [
        {
          comment: commitMessage,
          changes: [
            {
              changeType: "edit",
              item: { path: filePath },
              newContent: { content: fileContent, contentType: "rawtext" }
            }
          ]
        }
      ]
    }
  });
}

export async function createPullRequest({
  orgUrl,
  project,
  repoId,
  authMode,
  managedIdentityClientId,
  sourceBranch,
  targetBranch,
  title,
  description,
  deleteSourceBranchOnCompletion = true
}) {
  const pr = await azdoFetchJson({
    orgUrl,
    project,
    authMode,
    managedIdentityClientId,
    method: "POST",
    apiPath: `git/repositories/${encodeURIComponent(repoId)}/pullrequests`,
    query: { apiVersion: "7.1" },
    body: {
      sourceRefName: `refs/heads/${sourceBranch}`,
      targetRefName: `refs/heads/${targetBranch}`,
      title,
      description,
      completionOptions: {
        deleteSourceBranch: deleteSourceBranchOnCompletion
      }
    }
  });

  const web = pr?._links?.web?.href;
  return {
    pullRequestId: pr?.pullRequestId,
    url: web ?? pr?.url ?? null,
    deleteSourceBranchOnCompletion
  };
}

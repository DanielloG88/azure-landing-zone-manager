# Subscription Portal

A small web app that lets non-technical users request new Azure subscriptions by creating a PR that updates `infrastructure/subscriptions.csv`.

## How it works

- Reads the current `infrastructure/subscriptions.csv`
- Validates user input
- Adds one or more rows
- **Recommended:** creates a new branch + PR in Azure DevOps so a DevOps team can review/merge
- When merged, the existing Azure Pipeline triggers Terraform and creates the subscription(s)

The UI supports building multiple subscription requests. Click **Add another subscription**, then **Send request for subscriptions** to review the list and confirm. You can also toggle **Multiple environments** inside a request module to submit dev/sandbox/prod in one shot.

## Run locally

From repo root:

```powershell
cd subscription-portal
Copy-Item .env.example .env
npm ci
npm run dev
```

Then open `http://127.0.0.1:3000`.

## Container Apps (scale-to-zero)

This portal works well on Azure Container Apps with `min replicas = 0` so it scales to zero when idle.
With HTTP ingress, it automatically scales to zero after inactivity (no extra schedule needed).

High-level steps (no Terraform):

- Build and push the image (for example to ACR).
- Create a Container Apps environment.
- Create the app with ingress enabled, target port `3000`, and `min replicas = 0` / `max replicas = 1`.
- Enable managed identity for the Container App.
- Add that identity to Azure DevOps with the required repo/project permissions.
- Map env vars (`AZDO_ORG_URL`, `AZDO_PROJECT`, `AZDO_REPO_ID`, `AZDO_AUTH_MODE=managed_identity`, `AZDO_MANAGED_IDENTITY_CLIENT_ID`, `AZDO_TARGET_BRANCH`, `PORTAL_AZDO_ENABLED=true`, `PORTAL_WRITE_LOCAL=false`, `PORT=3000`).

Example build (from repo root):

```powershell
az acr build -r <acrName> -t subscription-portal:latest .\subscription-portal
```

Use the Azure Portal if you prefer UI steps. In the container settings you can set env vars to "Reference a secret"
for Key Vault-backed values.

## Configuration

The server reads `subscription-portal/.env` if present (without overriding already-set environment variables). For convenience, UI toggles can also be taken from `subscription-portal/.env.example` if not set elsewhere.

The portal supports two modes:

1) **Azure DevOps PR mode (recommended)**: set `AZDO_ORG_URL`, `AZDO_PROJECT`, `AZDO_REPO_ID`, `AZDO_AUTH_MODE=managed_identity`, `AZDO_MANAGED_IDENTITY_CLIENT_ID` and (optionally) `PORTAL_AZDO_ENABLED=true`.

2) **Local file mode (dev only)**: if Azure DevOps is not configured, the portal can read from `SUBSCRIPTIONS_CSV_PATH` and (optionally) write back when `PORTAL_WRITE_LOCAL=true`.

If Azure DevOps is configured but you want to test the UI without creating branches/PRs, set `PORTAL_AZDO_ENABLED=false` (the portal will generate/download the updated CSV instead).

`AZDO_SUBSCRIPTIONS_PATH` selects the repository file read and updated by portal commits/PRs. It defaults to
`/infrastructure/subscriptions.csv`. Non-production environments can point it to a sandbox file outside Terraform
pipeline paths, allowing realistic portal and PR testing without managing Azure subscriptions.

### UI toggles

Set any of these to `false` to hide the corresponding UI block:

- `PORTAL_UI_SHOW_MODE_BANNER`
- `PORTAL_UI_SHOW_DRY_RUN`
- `PORTAL_UI_SHOW_EXISTING_SUBSCRIPTIONS` (admins only)

### Access control (admin vs requester)

The admin panel (existing subscriptions, destruction requests, CSV sync) is only visible to admins.
Requesters see only the subscription request form, and users must belong to one of the configured
groups/roles to submit requests once auth is enforced.

Admins can also update a selected existing subscription from the admin table:

- Open **Update selected subscription** for one selected row.
- Choose exactly which access groups should exist, then edit IAM group names and IAM user membership lists.
- Submit an update request (branch + PR in Azure DevOps, same pattern as create/destroy flows).

Configure either group IDs or app roles:

- `PORTAL_AUTH_ADMIN_GROUPS` (comma-separated Entra group object IDs)
- `PORTAL_AUTH_REQUESTER_GROUPS` (comma-separated Entra group object IDs)

Alternatively, define app roles in the app registration and assign them to users or groups:

- `Portal.Admin`
- `Portal.Requester`

If you rely on group IDs, make sure the enterprise app emits group claims in tokens.

### Subscription access groups (admin-configured)

The request form supports optional admin-only fields for subscription-level access groups:

- `subOwnerGroupEnabled`
- `subContributorGroupEnabled`
- `subReaderGroupEnabled`
- `subOwnerGroupName`
- `subContributorGroupName`
- `subReaderGroupName`
- `subOwnerMembers`
- `subContributorMembers`
- `subReaderMembers`

Unchecked roles are not created. This is the safe default for new and existing rows, so POCs can enable only the
specific Owner / Contributor / Reader groups they want to test.

If left empty, the backend auto-generates defaults using:

- `Azure-SUB-<project>-<env>-Owner`
- `Azure-SUB-<project>-<env>-Contributor`
- `Azure-SUB-<project>-<env>-Reader`

Only admins can submit custom values for these fields. Non-admin attempts are rejected with `403`.
Values are persisted into `infrastructure/subscriptions.csv` as:

- `sub_owner_group_enabled`
- `sub_contributor_group_enabled`
- `sub_reader_group_enabled`
- `sub_owner_group_name`
- `sub_contributor_group_name`
- `sub_reader_group_name`
- `sub_owner_members`
- `sub_contributor_members`
- `sub_reader_members`

### Existing subscriptions onboarded manually

Existing subscriptions can also be represented in `infrastructure/subscriptions.csv` without creating a new subscription alias.

For those manual CSV rows:

- set `subscription_id` to the real Azure subscription ID
- optionally set `bootstrap_subscription_resources=false` to avoid creating landing-zone bootstrap resources on first onboarding
- optionally set `manage_management_group_attachment=false` to leave an existing management-group attachment untouched during first onboarding

The portal UI does not expose these fields today, but admin updates preserve them because CSV updates patch only the edited columns.

### Options and defaults

Dropdown options can be provided as comma-separated lists. If not set, the portal uses the defaults from `src/config.js`.

- `PORTAL_ENVIRONMENTS`
- `PORTAL_MANAGEMENT_GROUPS`
- `PORTAL_LOCATIONS`

Defaults for new requests (empty values are allowed):

- `PORTAL_DEFAULT_MANAGEMENT_GROUP_ID`
- `PORTAL_DEFAULT_LOCATION`
- `PORTAL_DEFAULT_DEPARTMENT`
- `PORTAL_DEFAULT_TEAM`
- `PORTAL_DEFAULT_OWNER`
- `PORTAL_DEFAULT_COST_CENTER`
- `PORTAL_DEFAULT_BILLING_SCOPE`

### Destroy cleanup

When a subscription is marked for destruction, the portal sets `destroy=true` and `destroyed_at=YYYY-MM-DD` in `infrastructure/subscriptions.csv`.

To keep the CSV tidy, run the cleanup script on a schedule. It removes rows where `destroy=true` and
`destroyed_at` is older than 60 days. If `destroy=true` rows are missing `destroyed_at`, the cleanup fails so the
portal or CSV can be corrected.

The PROD and POC cleanup pipelines run at 01:00 UTC on weekdays. A cleanup run creates a PR; it never changes the
target branch directly.

Examples:

```powershell
cd subscription-portal
npm ci
pwsh -NoProfile -File scripts/cleanup-subscriptions.ps1
pwsh -NoProfile -File scripts/cleanup-subscriptions.ps1 --force
```

Use `--force` to remove all destroyed subscriptions immediately (useful for testing). The script reads from
`infrastructure/subscriptions.csv` by default. Set `AZDO_SUBSCRIPTIONS_PATH` to a repository path when an environment
uses a sandbox dataset; the script rejects paths outside the repository.

In CI, the same script creates a PR when Azure DevOps variables are available (`SYSTEM_ACCESSTOKEN` plus
`SYSTEM_COLLECTIONURI` / `SYSTEM_TEAMPROJECT` / `BUILD_REPOSITORY_ID` or `AZDO_*`). In Azure Pipelines, enable
"Allow scripts to access the OAuth token". The cleanup pipeline includes a `forceCleanup` parameter for test runs.

## Security note

This portal can propose changes that ultimately create Azure subscriptions. Host it behind SSO and network controls, and restrict the managed identity permissions in Azure DevOps to the minimum required scope.

## Private-source starter defaults

The default inventory is empty; `infrastructure/subscriptions.example.csv` contains synthetic preview data.
The server binds to `127.0.0.1` unless `HOST` is configured. The Docker image sets `HOST=0.0.0.0`.
Frontend URLs remain valid when the portal is mounted under a reverse-proxy path prefix.
Set the Entra redirect URI to the actual public portal URL, including that prefix.

Azure DevOps integration still uses managed identity; GitHub hosts the source only.
Production authorization trusts the principal header validated by Azure Container Apps Easy Auth.
The Express server does not independently validate bearer tokens. Keep it behind that trusted ingress.

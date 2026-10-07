# Azure Landing Zone Manager

A configurable starter for Azure subscription lifecycle management, with Terraform,
a browser request portal, and Azure DevOps review and deployment pipelines.

## Scope

- Request subscriptions for one or more environments.
- Review requests through Azure DevOps pull requests that update a CSV inventory.
- Onboard existing subscriptions and optionally manage tags, management-group attachment,
  Entra access groups, and Terraform state bootstrap resources.
- Request updates or removals with separate administrator permissions.
- Host the portal in Azure Container Apps using managed identity and Entra Easy Auth.

This repository manages subscriptions and their bootstrap resources. It is not a full implementation
of the Azure Landing Zones reference architecture: management groups, enterprise networking,
and organization-wide policy assignments must be designed and provisioned separately.

## Run the local preview

Requires Node.js 20 or newer and npm.

```bash
cd subscription-portal
npm ci
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000/`. Defaults disable local writes and Azure DevOps integration.
The real inventory, `infrastructure/subscriptions.csv`, contains only the column header.
For a preview with synthetic data, set:

```dotenv
SUBSCRIPTIONS_CSV_PATH=../infrastructure/subscriptions.example.csv
```

Administrative controls require a trusted Entra principal with configured groups or app roles.
The local preview supports requester actions and CSV generation without modifying Azure.

## Configure your deployment

Use the supplied `.tfvars.example` and `.tfbackend.example` files to create ignored local configuration.
Replace every placeholder with values from your own tenant, billing account, backend and Entra registration.
Configure portal environment variables using [`subscription-portal/.env.example`](subscription-portal/.env.example).

The following values are configurable: subscription and service-principal prefixes, billing scope,
management-group aliases, monitoring group, resource names, region, dropdown options and tag defaults.
Project-specific state-name and tag-management exceptions use input maps rather than hardcoded entries.

The active CSV starts empty so cloning this repository creates no subscriptions.
Adding a row with an empty `subscription_id` requests a new subscription and requires a real billing scope.
Review the Terraform plan before applying it. Existing subscriptions require deliberate onboarding;
see [`infrastructure/existing-subscriptions.md`](infrastructure/existing-subscriptions.md).

### Azure DevOps pipelines

GitHub hosts source and CI validation. The portal's PR integration currently targets **Azure DevOps**.
It does not create GitHub pull requests. Connect the repository to Azure Pipelines and configure
an Azure DevOps repository for portal changes, or extend the provider before using a GitHub-only workflow.

- `azure-pipelines.yaml`: subscription Terraform, restricted to `main`.
- `azure-pipelines-container.yaml`: portal container delivery from `main` or `poc`.
- `azure-pipelines-cleanup*.yaml`: inventory cleanup through reviewed PRs.
- `azure-pipeline-templates/portal-*.yml`: reusable portal infrastructure templates.

Create Azure service connections named as configured in the pipeline variables, and configure
approvals on the Azure DevOps deployment environments before enabling runs.
Container pipeline parameters supply the subscription, resource group, Container App and registry targets.

Backend and Terraform configuration are loaded from **Azure DevOps secure files**:

| Stack | Backend secure file | Input secure file |
| --- | --- | --- |
| Subscription lifecycle | `landing-zone-prod.azurerm.tfbackend` | `landing-zone-prod.tfvars` |
| Portal, production | `portal-prod.azurerm.tfbackend` | `portal-prod.tfvars` |
| Portal, POC | `portal-poc.azurerm.tfbackend` | `portal-poc.tfvars` |

Authorize the corresponding pipeline to read each file. CI removes the copied configuration
before publishing artifacts; saved Terraform plans may still contain sensitive data and need restricted access.
The apply stage uses the reviewed saved plan and reloads backend configuration from secure files.

### Authentication and hosting

Production portal deployments require Azure Container Apps Easy Auth to validate Entra identity
and supply the trusted `X-MS-CLIENT-PRINCIPAL` header. App roles are `Portal.Admin` and `Portal.Requester`.
Do not expose a standalone server directly to untrusted clients with Azure DevOps writes enabled.
Bearer UI configuration alone does not validate tokens in Express.

The default server binds to `127.0.0.1`. The Docker image sets `HOST=0.0.0.0` for container ingress.
Browser assets, API calls and login redirect paths use relative URLs for reverse-proxy path prefixes.
The public callback URL, including its prefix when applicable, must be registered in Entra.

## Validate

```bash
cd subscription-portal
npm ci
npm test
cd ../infrastructure
terraform fmt -check -recursive
terraform init -backend=false -input=false
terraform validate
cd subscription-portal
terraform init -backend=false -input=false
terraform validate
```

The GitHub workflow runs tests and backend-free Terraform validation. It does not deploy Azure resources.
Deployment configuration, credentials, local previews, state and dependency directories are ignored by Git.

## More documentation

- [Portal configuration and operations](subscription-portal/README.md)
- [Portal infrastructure](infrastructure/subscription-portal/README.md)
- [Terraform state backend](infrastructure/tfstate/README.md)
- [Local PowerShell authentication helper](infrastructure/utils/README.md)

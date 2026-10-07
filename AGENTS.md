# Contributor guide

## Layout

- `subscription-portal/`: Express API and browser UI.
- `infrastructure/`: subscription lifecycle Terraform and CSV schema.
- `infrastructure/subscription-portal/`: optional Container Apps stack.
- `azure-pipeline-templates/`: reusable Azure DevOps stages.

## Configuration

Use environment variables, ignored `.env`, `.tfvars` and `.tfbackend` files.
Tracked examples must contain synthetic data only. Do not add tenant-specific identifiers,
personal contact details, credentials, state files, or branding from a previous deployment.

## Validation

Run `npm ci` and `npm test` in `subscription-portal/`.
Run `terraform fmt -check -recursive` and `terraform validate` after backend-free initialization.
Keep local previews on `127.0.0.1`. Container deployments use `HOST=0.0.0.0` behind Easy Auth.
The frontend uses relative URLs so reverse proxies may mount it under a public path prefix.

## Deployment

GitHub hosts the source and validation workflow. Azure DevOps remains the runtime PR provider.
Configure service connections, secure files and environment approvals before using Azure pipelines.
Subscription lifecycle runs from `main`; the `poc` branch uses separate portal data.
Never apply Terraform or remove Azure resources during repository-only changes.

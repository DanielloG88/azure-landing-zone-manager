# Contributor guide

## Layout

- `subscription-portal/`: Express API and browser UI.
- `infrastructure/`: subscription lifecycle Terraform and CSV schema.
- `infrastructure/networking/hub/`: shared hub bootstrap with separate state.
- `infrastructure/terraform_modules/subscription_networking/`: optional spokes driven by the subscription CSV.
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

GitHub hosts source only. Azure DevOps runs validation, hub bootstrap and subscription lifecycle pipelines, and remains the runtime PR provider.
Configure service connections, secure files and environment approvals before using Azure pipelines.
Subscription lifecycle runs from `main`; the `poc` branch uses separate portal data.
Never apply Terraform or remove Azure resources during repository-only changes.

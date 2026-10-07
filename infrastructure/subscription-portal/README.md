# Subscription Portal Infrastructure

Terraform stack for the Azure Subscription Portal (Container Apps).

## Backend

This stack uses a dedicated state key in the landing-zone tfstate storage account.

```
cp prod.azurerm.tfbackend.example prod.azurerm.tfbackend
cp prod.tfvars.example prod.tfvars
# Edit both files to configure your own tenant and resources.
terraform init -backend-config=prod.azurerm.tfbackend
```

## Required inputs

For Azure DevOps auth, this stack uses managed identity:

- optional: `TF_VAR_azdo_managed_identity_client_id`
- if omitted, the stack uses the client ID of the user-assigned identity it creates

For Easy Auth login to work, provide one of:

- `TF_VAR_container_app_auth_client_secret` (stores Entra app secret in container app secret), or
- `TF_VAR_container_app_auth_client_secret_secret_id` (references an existing Key Vault secret).

## Notes

- Neutral defaults use westeurope and prod; supply your own subscription and resource targets.
- If you want a separate backend container, create it first and update `prod.azurerm.tfbackend`.
- This stack configures Container Apps Easy Auth (Entra ID) when `container_app_auth_enabled=true` (default).
- Resource modules live under `infrastructure/subscription-portal/modules/`.
- Container App creation is disabled by default to allow infra-only deploys. Enable it by setting `TF_VAR_create_container_app=true` once the image tag is available in ACR.
- Key Vault is created by default as `kv-<prefix>-<env>-01` unless you pass `TF_VAR_key_vault_id` or set `TF_VAR_create_key_vault=false`.
- The runtime uses managed identity for Azure DevOps; bootstrap that identity into Azure DevOps separately.
- Entra requester/admin access is controlled by `portal_auth.requester_groups` and `portal_auth.admin_groups` (group lists default to empty).

Authentication remains enabled by default. Supply your own Entra tenant, client ID, scopes and access groups.
Azure DevOps integration has no organization-specific defaults. Configure it explicitly.

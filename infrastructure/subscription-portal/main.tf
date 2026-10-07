terraform {
  backend "azurerm" {
    use_azuread_auth = true
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.20.0"
    }
    azapi = {
      source  = "azure/azapi"
      version = ">= 2.7.0"
    }
  }

  required_version = ">= 1.9.8"
}

provider "azurerm" {
  features {}
  storage_use_azuread = true
  subscription_id     = trimspace(var.subscription_id) != "" ? trimspace(var.subscription_id) : null
}

locals {
  environment = lower(var.environment)
  name_prefix = lower(var.name_prefix)

  resource_group_name            = var.resource_group_name != "" ? var.resource_group_name : "rg-${local.name_prefix}-${local.environment}"
  log_analytics_workspace_name   = var.log_analytics_workspace_name != "" ? var.log_analytics_workspace_name : "law-${local.name_prefix}-${local.environment}"
  container_app_environment_name = var.container_app_environment_name != "" ? var.container_app_environment_name : "cae-${local.name_prefix}-${local.environment}"
  container_app_name             = var.container_app_name != "" ? var.container_app_name : "${local.name_prefix}-front-${local.environment}"
  user_assigned_identity_name    = var.user_assigned_identity_name != "" ? var.user_assigned_identity_name : "id-${local.name_prefix}-${local.environment}"
  key_vault_name                 = var.key_vault_name != "" ? var.key_vault_name : "kv-${local.name_prefix}-${local.environment}-01"

  # ACR names must be 5-50 lowercase alphanumeric characters.
  default_acr_name        = "cr${local.name_prefix}${local.environment}01"
  default_acr_sanitized   = replace(replace(replace(local.default_acr_name, "-", ""), "_", ""), ".", "")
  container_registry_name = var.container_registry_name != "" ? var.container_registry_name : lower(substr(local.default_acr_sanitized, 0, 50))

  tags = merge(
    {
      Environment = upper(var.environment)
      Project     = "subscription-portal"
      ManagedBy   = "Terraform"
    },
    var.tags
  )

  container_app_auth_secret_id    = var.container_app_auth_client_secret_secret_id != null && var.container_app_auth_client_secret_secret_id != "" ? var.container_app_auth_client_secret_secret_id : null
  container_app_auth_secret_val   = var.container_app_auth_client_secret != null && var.container_app_auth_client_secret != "" ? var.container_app_auth_client_secret : null
  azdo_managed_identity_client_id = trimspace(var.azdo_managed_identity_client_id) != "" ? trimspace(var.azdo_managed_identity_client_id) : module.user_assigned_identity.client_id

  use_managed_key_vault = var.key_vault_id == "" && var.create_key_vault
  key_vault_id          = var.key_vault_id != "" ? var.key_vault_id : (local.use_managed_key_vault ? module.key_vault[0].id : "")

  container_app_auth_allowed_audiences = compact(
    distinct([
      trimspace(var.portal_auth.aad_client_id) != "" ? trimspace(var.portal_auth.aad_client_id) : null,
      trimspace(var.portal_auth.aad_client_id) != "" ? "api://${trimspace(var.portal_auth.aad_client_id)}" : null
    ])
  )

  env_base = {
    PORT                            = "3000"
    PORTAL_AZDO_ENABLED             = var.azdo.enabled ? "true" : "false"
    PORTAL_WRITE_LOCAL              = "false"
    AZDO_ORG_URL                    = var.azdo.org_url
    AZDO_PROJECT                    = var.azdo.project
    AZDO_REPO_ID                    = var.azdo.repo_id
    AZDO_AUTH_MODE                  = "managed_identity"
    AZDO_MANAGED_IDENTITY_CLIENT_ID = local.azdo_managed_identity_client_id
    AZDO_TARGET_BRANCH              = var.azdo.target_branch
    PORTAL_AUTH_BEARER_ENABLED      = var.portal_auth.bearer_enabled ? "true" : "false"
    PORTAL_AUTH_AAD_CLIENT_ID       = var.portal_auth.aad_client_id
    PORTAL_AUTH_AAD_TENANT_ID       = var.portal_auth.aad_tenant_id
    PORTAL_AUTH_AAD_SCOPES          = length(var.portal_auth.aad_scopes) > 0 ? join(",", var.portal_auth.aad_scopes) : null
    PORTAL_AUTH_ADMIN_GROUPS        = length(var.portal_auth.admin_groups) > 0 ? join(",", var.portal_auth.admin_groups) : null
    PORTAL_AUTH_REQUESTER_GROUPS    = length(var.portal_auth.requester_groups) > 0 ? join(",", var.portal_auth.requester_groups) : null
  }

  env_vars = {
    for key, value in merge(local.env_base, var.portal_env_overrides) :
    key => value
    if value != null && value != ""
  }
}

data "azurerm_client_config" "current" {}

module "resource_group" {
  source   = "./modules/resource_group"
  name     = local.resource_group_name
  location = var.location
  tags     = local.tags
}

module "log_analytics" {
  source              = "./modules/log_analytics"
  name                = local.log_analytics_workspace_name
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  sku                 = var.log_analytics_sku
  retention_in_days   = var.log_analytics_retention_days
  tags                = local.tags
}

module "container_app_environment" {
  source                     = "./modules/container_app_environment"
  name                       = local.container_app_environment_name
  resource_group_name        = module.resource_group.name
  location                   = module.resource_group.location
  log_analytics_workspace_id = module.log_analytics.id
  workload_profiles          = var.container_app_environment_workload_profiles
  tags                       = local.tags
}

module "user_assigned_identity" {
  source              = "./modules/user_assigned_identity"
  name                = local.user_assigned_identity_name
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  tags                = local.tags
}

module "key_vault" {
  count                         = local.use_managed_key_vault ? 1 : 0
  source                        = "./modules/key_vault"
  name                          = local.key_vault_name
  resource_group_name           = module.resource_group.name
  location                      = module.resource_group.location
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = var.key_vault_sku_name
  public_network_access_enabled = var.key_vault_public_network_access_enabled
  tags                          = local.tags
}

module "container_registry" {
  source                = "./modules/container_registry"
  name                  = local.container_registry_name
  resource_group_name   = module.resource_group.name
  location              = module.resource_group.location
  sku                   = var.acr_sku
  tags                  = local.tags
  identity_principal_id = module.user_assigned_identity.principal_id
}

module "key_vault_secrets_user" {
  source       = "./modules/key_vault_secrets_user"
  enabled      = local.use_managed_key_vault || var.key_vault_id != "" || local.container_app_auth_secret_id != null
  key_vault_id = local.key_vault_id
  principal_id = module.user_assigned_identity.principal_id
}

module "container_app" {
  count                           = var.create_container_app ? 1 : 0
  source                          = "./modules/container_app"
  name                            = local.container_app_name
  container_name                  = trimspace(var.container_name) != "" ? trimspace(var.container_name) : local.container_app_name
  resource_group_name             = module.resource_group.name
  container_app_environment_id    = module.container_app_environment.id
  workload_profile_name           = trimspace(var.container_app_workload_profile_name) != "" ? trimspace(var.container_app_workload_profile_name) : null
  container_registry_login_server = module.container_registry.login_server
  identity_id                     = module.user_assigned_identity.id
  image_name                      = var.image_name
  image_tag                       = var.image_tag
  cpu                             = var.container_cpu
  memory                          = var.container_memory
  min_replicas                    = var.min_replicas
  max_replicas                    = var.max_replicas
  ingress_external_enabled        = var.container_app_ingress_external_enabled
  ingress_target_port             = var.container_app_ingress_target_port
  ingress_allow_insecure          = var.container_app_ingress_allow_insecure
  ingress_transport               = var.container_app_ingress_transport
  tags                            = local.tags
  aad_client_secret               = local.container_app_auth_secret_val
  aad_client_secret_secret_id     = local.container_app_auth_secret_id
  aad_client_secret_setting_name  = var.container_app_auth_client_secret_setting_name
  env_vars                        = local.env_vars
  depends_on                      = [module.container_registry, module.key_vault_secrets_user]
}

resource "azapi_resource" "container_app_auth" {
  count = var.create_container_app && var.container_app_auth_enabled ? 1 : 0

  type      = "Microsoft.App/containerApps/authConfigs@2024-03-01"
  name      = "current"
  parent_id = module.container_app[0].id

  schema_validation_enabled = false

  body = {
    properties = {
      platform = {
        enabled = true
      }
      globalValidation = {
        redirectToProvider          = "AzureActiveDirectory"
        unauthenticatedClientAction = "RedirectToLoginPage"
      }
      identityProviders = {
        azureActiveDirectory = {
          isAutoProvisioned = false
          registration = merge(
            {
              clientId     = var.portal_auth.aad_client_id
              openIdIssuer = "https://login.microsoftonline.com/${var.portal_auth.aad_tenant_id}/v2.0"
            },
            local.container_app_auth_secret_id != null || local.container_app_auth_secret_val != null ? { clientSecretSettingName = var.container_app_auth_client_secret_setting_name } : {}
          )
          validation = {
            allowedAudiences = local.container_app_auth_allowed_audiences
          }
        }
      }
      login = {
        preserveUrlFragmentsForLogins = false
      }
    }
  }

  depends_on = [module.container_app]
}

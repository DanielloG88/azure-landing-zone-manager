variable "environment" {
  type        = string
  description = "Deployment environment (e.g. dev, test, prod)."
  default     = "prod"
}

variable "location" {
  type        = string
  description = "Azure region for the portal resources."
  default     = "westeurope"
}

variable "subscription_id" {
  type        = string
  description = "Azure subscription ID where the portal resources will be managed."
  default     = ""
}

variable "name_prefix" {
  type        = string
  description = "Prefix used to build resource names."
  default     = "alzportal"
}

variable "tags" {
  type        = map(string)
  description = "Extra tags to apply to portal resources."
  default     = {}
}

variable "resource_group_name" {
  type        = string
  description = "Override resource group name (optional)."
  default     = ""
}

variable "log_analytics_workspace_name" {
  type        = string
  description = "Override Log Analytics workspace name (optional)."
  default     = ""
}

variable "container_app_environment_name" {
  type        = string
  description = "Override Container Apps environment name (optional)."
  default     = ""
}

variable "container_app_environment_workload_profiles" {
  type = list(object({
    name                  = string
    workload_profile_type = string
    minimum_count         = number
    maximum_count         = number
  }))
  description = "Optional workload profiles to declare on the Container Apps environment."
  default     = []
}

variable "container_app_name" {
  type        = string
  description = "Override Container App name (optional)."
  default     = ""
}

variable "container_app_workload_profile_name" {
  type        = string
  description = "Optional workload profile name for the portal Container App."
  default     = ""
}

variable "container_name" {
  type        = string
  description = "Override the container name inside the Container App template (optional)."
  default     = ""
}

variable "container_registry_name" {
  type        = string
  description = "Override ACR name (optional)."
  default     = ""
}

variable "user_assigned_identity_name" {
  type        = string
  description = "Override user-assigned identity name (optional)."
  default     = ""
}

variable "create_key_vault" {
  type        = bool
  description = "Whether to create a Key Vault for the portal."
  default     = true
}

variable "key_vault_name" {
  type        = string
  description = "Override Key Vault name (optional)."
  default     = ""
}

variable "key_vault_sku_name" {
  type        = string
  description = "Key Vault SKU name."
  default     = "standard"
}

variable "key_vault_public_network_access_enabled" {
  type        = bool
  description = "Allow public network access to Key Vault."
  default     = true
}

variable "image_name" {
  type        = string
  description = "Container image repository name."
  default     = "subscription-portal"
}

variable "image_tag" {
  type        = string
  description = "Container image tag."
  default     = "latest"
}

variable "container_cpu" {
  type        = number
  description = "CPU cores for the portal container."
  default     = 0.25
}

variable "container_memory" {
  type        = string
  description = "Memory for the portal container."
  default     = "0.5Gi"
}

variable "min_replicas" {
  type        = number
  description = "Minimum number of replicas."
  default     = 0
}

variable "max_replicas" {
  type        = number
  description = "Maximum number of replicas."
  default     = 1
}

variable "create_container_app" {
  type        = bool
  description = "Whether to create the Container App (skip if image isn't published yet)."
  default     = false
}

variable "container_app_ingress_external_enabled" {
  type        = bool
  description = "Expose Container App ingress publicly."
  default     = true
}

variable "container_app_ingress_target_port" {
  type        = number
  description = "Container App ingress target port."
  default     = 3000
}

variable "container_app_ingress_allow_insecure" {
  type        = bool
  description = "Allow HTTP traffic on ingress."
  default     = true
}

variable "container_app_ingress_transport" {
  type        = string
  description = "Container App ingress transport mode (auto, http, http2, tcp)."
  default     = "auto"
}

variable "acr_sku" {
  type        = string
  description = "ACR SKU."
  default     = "Basic"
}

variable "log_analytics_sku" {
  type        = string
  description = "Log Analytics workspace SKU."
  default     = "PerGB2018"
}

variable "log_analytics_retention_days" {
  type        = number
  description = "Log Analytics retention in days."
  default     = 30
}

variable "azdo" {
  type = object({
    org_url       = string
    project       = string
    repo_id       = string
    target_branch = string
    enabled       = bool
  })
  description = "Azure DevOps configuration for PR creation."
  default = {
    org_url       = ""
    project       = ""
    repo_id       = ""
    target_branch = "main"
    enabled       = true
  }
}

variable "azdo_managed_identity_client_id" {
  type        = string
  description = "Optional managed identity client ID override for Azure DevOps auth."
  default     = ""
}

variable "key_vault_id" {
  type        = string
  description = "Existing Key Vault resource ID to reuse (optional)."
  default     = ""
}

variable "container_app_auth_enabled" {
  type        = bool
  description = "Configure Container App Easy Auth (Microsoft Entra ID)."
  default     = true
}

variable "container_app_auth_client_secret" {
  type        = string
  description = "AAD app client secret value for Easy Auth (optional)."
  default     = null
  sensitive   = true
}

variable "container_app_auth_client_secret_secret_id" {
  type        = string
  description = "Key Vault secret ID for AAD app client secret (optional)."
  default     = null
}

variable "container_app_auth_client_secret_setting_name" {
  type        = string
  description = "Container App secret setting name used by Easy Auth."
  default     = "aad-client-secret"
}

variable "portal_auth" {
  type = object({
    bearer_enabled   = bool
    aad_client_id    = string
    aad_tenant_id    = string
    aad_scopes       = list(string)
    admin_groups     = list(string)
    requester_groups = list(string)
  })
  description = "Auth settings for the portal UI."
  default = {
    bearer_enabled   = true
    aad_client_id    = ""
    aad_tenant_id    = ""
    aad_scopes       = []
    admin_groups     = []
    requester_groups = []
  }
}

variable "portal_env_overrides" {
  type        = map(string)
  description = "Additional env vars (or overrides) for the portal container."
  default     = {}
}

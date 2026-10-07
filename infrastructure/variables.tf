variable "environment" {
  type        = string
  description = "Stage of the deployment and environment (e.g. dev, test, prod)."
}

variable "tfstate_resource_group" {
  type        = string
  description = "The resource group for the terraform state."
}

variable "tfstate_storage_account" {
  type        = string
  description = "The storage account for the terraform state."
}

variable "subscription_display_name_prefix" {
  type        = string
  description = "Name prefix used to build subscription display name."
  default     = "alz"
}

variable "project_sp_prefix" {
  type        = string
  description = "Prefix for the Azure AD application / service principal."
  default     = "spi-alz"
}

variable "storage_provider_registration_wait" {
  type        = string
  description = "How long to wait after registering Microsoft.Storage RP in new subscriptions."
  default     = "90s"
}

variable "manage_tfstate_supporting_resources" {
  type        = bool
  description = "Whether this workspace should manage shared tfstate lock/monitoring resources in the landing zone subscription."
  default     = true
}

variable "management_group_id_aliases" {
  type        = map(string)
  description = "Optional mapping from portal or CSV management group values (including display names) to the real Azure management group IDs."
  default     = {}
}

variable "billing_scope" {
  type        = string
  description = "Default MCA billing scope for new subscriptions; empty for existing-only setups."
  default     = ""
}

variable "tfstate_monitoring_group_name" {
  type        = string
  description = "Entra security group used for state monitoring."
  default     = "alz-tfstate-monitoring-group"
}

variable "default_subscription_tags" {
  type        = map(string)
  description = "Organization-specific tag defaults merged with the neutral defaults."
  default     = {}
}

variable "tfstate_storage_account_name_overrides" {
  type        = map(string)
  description = "Optional project-environment overrides for globally unique state storage names."
  default     = {}
}

variable "subscription_tag_management_overrides" {
  type        = map(bool)
  description = "Optional project-environment flags to preserve externally managed subscription tags."
  default     = {}
}

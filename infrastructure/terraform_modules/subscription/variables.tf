variable "environment" {
  type        = string
  description = "Stage of the deployment and environment (e.g. dev, test, prod)."
}

variable "tags" {
  description = "A map of tags to apply to resources."
  type        = map(string)
  default     = {}
}

variable "project_name" {
  type        = string
  description = "The name of the project."
}

variable "billing_scope" {
  type    = string
  default = ""
}

variable "subscription_id" {
  type        = string
  description = "Optional existing subscription ID to manage instead of creating a new subscription alias."
  default     = ""
}

variable "management_group_id" {
  type = string
}

variable "location" {
  type    = string
  default = "westeurope"
}

variable "destroy" {
  type = bool
}

variable "bootstrap_subscription_resources" {
  type        = bool
  description = "Whether to create landing-zone bootstrap resources inside the subscription (service principal, role assignments, tfstate backend resources)."
  default     = true
}

variable "manage_management_group_attachment" {
  type        = bool
  description = "Whether Terraform should manage the subscription attachment to the configured management group."
  default     = true
}

variable "manage_subscription_tags" {
  type        = bool
  description = "Whether Terraform should manage tags on the subscription."
  default     = true
}

variable "tfstate_storage_account_name_override" {
  type        = string
  description = "Optional explicit storage account name to use for the subscription tfstate backend."
  default     = ""
}

variable "sub_owner_group_enabled" {
  type        = bool
  description = "Whether to create the Entra Owner access group for the subscription."
  default     = false
}

variable "sub_contributor_group_enabled" {
  type        = bool
  description = "Whether to create the Entra Contributor access group for the subscription."
  default     = false
}

variable "sub_reader_group_enabled" {
  type        = bool
  description = "Whether to create the Entra Reader access group for the subscription."
  default     = false
}

variable "sub_owner_group_name" {
  type        = string
  description = "Optional custom Entra group display name for subscription Owner role."
  default     = ""
}

variable "sub_contributor_group_name" {
  type        = string
  description = "Optional custom Entra group display name for subscription Contributor role."
  default     = ""
}

variable "sub_reader_group_name" {
  type        = string
  description = "Optional custom Entra group display name for subscription Reader role."
  default     = ""
}

variable "sub_owner_members" {
  type        = string
  description = "Semicolon/comma/newline-separated UPNs to add to the subscription Owner group."
  default     = ""
}

variable "sub_contributor_members" {
  type        = string
  description = "Semicolon/comma/newline-separated UPNs to add to the subscription Contributor group."
  default     = ""
}

variable "sub_reader_members" {
  type        = string
  description = "Semicolon/comma/newline-separated UPNs to add to the subscription Reader group."
  default     = ""
}

variable "subscription_display_name_prefix" {
  type        = string
  description = "Prefix used to construct the subscription display name and alias."
}

variable "subscription_display_name_override" {
  type        = string
  description = "Optional full Azure subscription display name. Keeps project_name unchanged for Terraform state and bootstrap resources."
  default     = ""
}

variable "project_sp_prefix" {
  type        = string
  description = "Prefix used to construct the project service principal display name."
}

variable "storage_provider_registration_wait" {
  type        = string
  description = "How long to wait after registering Microsoft.Storage RP before creating the tfstate storage account."
  default     = "90s"
}

locals {
  display_name = trimspace(var.subscription_display_name_override) != "" ? trimspace(var.subscription_display_name_override) : "${var.subscription_display_name_prefix}-${var.project_name}-${var.environment}"
  alias_name   = "${local.subscription_display_name_prefix_segment_safe}-${local.project_segment_safe}-${local.environment_segment_safe}"
}

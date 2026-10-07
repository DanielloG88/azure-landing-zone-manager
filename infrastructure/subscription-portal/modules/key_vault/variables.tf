variable "name" {
  type        = string
  description = "Key Vault name."
}

variable "resource_group_name" {
  type        = string
  description = "Resource group name."
}

variable "location" {
  type        = string
  description = "Azure region."
}

variable "tenant_id" {
  type        = string
  description = "Tenant ID."
}

variable "sku_name" {
  type        = string
  description = "Key Vault SKU name."
  default     = "standard"
}

variable "soft_delete_retention_days" {
  type        = number
  description = "Soft delete retention in days."
  default     = 90
}

variable "purge_protection_enabled" {
  type        = bool
  description = "Enable purge protection."
  default     = false
}

variable "public_network_access_enabled" {
  type        = bool
  description = "Allow public network access."
  default     = true
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply."
  default     = {}
}

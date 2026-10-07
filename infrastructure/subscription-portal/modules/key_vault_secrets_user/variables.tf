variable "key_vault_id" {
  type        = string
  description = "Key Vault resource ID."
  default     = ""
}

variable "enabled" {
  type        = bool
  description = "Whether to create the Key Vault Secrets User role assignment."
  default     = true
}

variable "role_definition_name" {
  type        = string
  description = "Role definition name to assign."
  default     = "Key Vault Secrets User"
}

variable "principal_id" {
  type        = string
  description = "Principal ID to grant Key Vault Secrets User."
}

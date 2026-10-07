variable "enabled" {
  type        = bool
  description = "Whether to create the secret."
  default     = true
}

variable "key_vault_id" {
  type        = string
  description = "Key Vault resource ID."
}

variable "name" {
  type        = string
  description = "Secret name."
}

variable "value" {
  type        = string
  description = "Secret value."
  sensitive   = true
}

variable "content_type" {
  type        = string
  description = "Secret content type."
  default     = ""
}

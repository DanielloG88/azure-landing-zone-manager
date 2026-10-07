variable "name" {
  type        = string
  description = "ACR name."
}

variable "resource_group_name" {
  type        = string
  description = "Resource group name."
}

variable "location" {
  type        = string
  description = "Azure region."
}

variable "sku" {
  type        = string
  description = "ACR SKU."
  default     = "Basic"
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply."
  default     = {}
}

variable "identity_principal_id" {
  type        = string
  description = "Principal ID to grant AcrPull."
}

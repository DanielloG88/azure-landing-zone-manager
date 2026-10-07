variable "name" {
  type        = string
  description = "Log Analytics workspace name."
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
  description = "Workspace SKU."
  default     = "PerGB2018"
}

variable "retention_in_days" {
  type        = number
  description = "Retention in days."
  default     = 30
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply."
  default     = {}
}

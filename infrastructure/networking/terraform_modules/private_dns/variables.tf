variable "zone_names" {
  description = "Central private DNS zones, created once and shared by the hub and spokes."
  type        = set(string)

  validation {
    condition = alltrue([
      for name in var.zone_names : can(regex("^[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}$", name))
    ])
    error_message = "Private DNS zone names must be lowercase DNS names."
  }
}

variable "resource_group_name" {
  description = "Resource group owned by the hub stack."
  type        = string
}

variable "hub_virtual_network_id" {
  description = "Virtual network linked to the central zones."
  type        = string
}

variable "tags" {
  description = "Hub resource tags."
  type        = map(string)
}

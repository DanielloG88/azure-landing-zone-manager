variable "name" {
  description = "Stable lowercase name segment shared by the resource group and virtual network."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,49}$", var.name))
    error_message = "name must be 2-50 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "address_space" {
  description = "Non-overlapping IPv4 CIDRs, checked by the caller's address_plan module."
  type        = set(string)
}

variable "tags" {
  description = "Resource tags including owner, cost-center, department, team, project and environment."
  type        = map(string)

  validation {
    condition = alltrue([
      for key in ["owner", "cost-center", "department", "team", "project", "environment"] :
      try(trimspace(var.tags[key]) != "", false)
    ])
    error_message = "All six mandatory resource tags must have non-empty values."
  }
}

variable "enable_delete_lock" {
  description = "Create an Azure CanNotDelete lock on the resource group. Terraform can remove this lock during destroy."
  type        = bool
  default     = false
}

variable "subnets" {
  description = "Subnet definitions, private endpoint policies and optional application-specific NSG rules."
  type = map(object({
    address_prefixes                  = set(string)
    network_security_group_enabled    = optional(bool, true)
    private_endpoint_network_policies = optional(string, "Enabled")
    security_rules = optional(map(object({
      priority                   = number
      direction                  = string
      access                     = string
      protocol                   = string
      source_port_range          = optional(string, "*")
      destination_port_range     = string
      source_address_prefix      = string
      destination_address_prefix = optional(string, "*")
    })), {})
  }))

  validation {
    condition = alltrue([
      for key, subnet in var.subnets :
      can(regex("^[a-z][a-z0-9-]{0,39}$", key)) && length(subnet.address_prefixes) > 0 &&
      contains(["Disabled", "Enabled", "NetworkSecurityGroupEnabled", "RouteTableEnabled"], subnet.private_endpoint_network_policies)
    ])
    error_message = "Subnet keys must be lowercase names; each subnet needs prefixes and a supported private endpoint policy setting."
  }
}

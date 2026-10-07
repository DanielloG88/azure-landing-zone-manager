variable "hub_key" {
  description = "Alias used by the subscription inventory and exported hub catalogue."
  type        = string
  default     = "platform"
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,47}$", var.hub_key))
    error_message = "hub_key must use lowercase letters, numbers and hyphens."
  }
}
variable "subscriptions_csv_path" {
  description = "Shared subscription CSV path relative to this hub stack. Change only for synthetic validation fixtures."
  type        = string
  default     = "../../subscriptions.csv"
}
variable "external_address_spaces" {
  description = "Prefixes of other connected networks that must not overlap with the hub."
  type        = map(set(string))
  default     = {}
}

variable "subscription_id" {
  description = "Existing connectivity subscription created or onboarded by the subscription manager."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.subscription_id))
    error_message = "Replace the connectivity subscription placeholder with a subscription UUID."
  }
}

variable "environment" {
  description = "Deployment environment and state boundary."
  type        = string

  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "environment must be dev, test or prod."
  }
}

variable "name_prefix" {
  description = "Same neutral resource prefix used by the subscription manager."
  type        = string
  default     = "alz"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,11}$", var.name_prefix))
    error_message = "name_prefix must be 2-12 lowercase letters, digits or hyphens."
  }
}

variable "project_name" {
  description = "Stable connectivity workload name."
  type        = string
  default     = "connectivity"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}$", var.project_name))
    error_message = "project_name must be 2-20 lowercase letters, digits or hyphens."
  }
}

variable "location" {
  description = "Azure region for the hub."
  type        = string
  default     = "westeurope"
}

variable "address_space" {
  description = "Hub IPv4 address spaces; must be disjoint from every spoke."
  type        = set(string)
}

variable "subnets" {
  description = "Hub subnet prefixes keyed by name; services and appliances can use these subnets in a separate stack."
  type        = map(set(string))
}

variable "private_dns_zone_names" {
  description = "Service-specific central private DNS zones. Empty by default; select only zones your workloads need."
  type        = set(string)
  default     = []
}

variable "tags" {
  description = "Organization tag values, matching the subscription manager's mandatory keys."
  type        = map(string)

  validation {
    condition = alltrue([
      for key in ["owner", "cost-center", "department", "team"] :
      try(trimspace(var.tags[key]) != "", false)
    ])
    error_message = "tags requires non-empty owner, cost-center, department and team values."
  }
}

variable "enable_delete_lock" {
  description = "Create a CanNotDelete resource-group lock. Review destructive Terraform plans even when locks are enabled."
  type        = bool
  default     = false
}

variable "subnet_security_rules" {
  description = "Optional NSG rules keyed by hub subnet and rule name. Empty maps retain Azure's default NSG rules."
  type = map(map(object({
    priority                   = number
    direction                  = string
    access                     = string
    protocol                   = string
    source_port_range          = optional(string, "*")
    destination_port_range     = string
    source_address_prefix      = string
    destination_address_prefix = optional(string, "*")
  })))
  default = {}

  validation {
    condition     = alltrue([for key in keys(var.subnet_security_rules) : contains(keys(var.subnets), key)])
    error_message = "NSG rule keys must refer to defined hub subnets."
  }
}

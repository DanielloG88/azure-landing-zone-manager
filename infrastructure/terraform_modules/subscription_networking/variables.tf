terraform {
  required_version = ">= 1.11.1, < 2.0.0"
  required_providers {
    azapi = {
      source  = "azure/azapi"
      version = "~> 2.7.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.9"
    }
  }
}

variable "subscription_id" {
  type        = string
  description = "Subscription ID resolved by the subscription lifecycle module."
  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.subscription_id))
    error_message = "subscription_id must be an Azure subscription UUID."
  }
}
variable "project_name" {
  type        = string
  description = "Project name from the shared subscription inventory."
}
variable "environment" {
  type        = string
  description = "Environment from the shared subscription inventory."
}
variable "location" {
  type        = string
  description = "Azure location for the spoke."
}
variable "tags" {
  type        = map(string)
  description = "Subscription tags inherited by all spoke resources."
  validation {
    condition     = alltrue([for key in ["owner", "cost-center", "department", "team"] : try(trimspace(var.tags[key]) != "", false)])
    error_message = "Spoke resources require non-empty owner, cost-center, department and team tags."
  }
}
variable "address_space" {
  type        = string
  description = "One canonical IPv4 CIDR for the new spoke."
}
variable "workload_subnet_prefix" {
  type        = string
  description = "Workload subnet IPv4 CIDR."
  validation {
    condition     = try(tonumber(split("/", var.workload_subnet_prefix)[1]) <= 29, false)
    error_message = "Azure workload subnets must be at least /29."
  }
}
variable "private_endpoint_subnet_prefix" {
  type        = string
  description = "Private endpoint subnet IPv4 CIDR."
  validation {
    condition     = try(tonumber(split("/", var.private_endpoint_subnet_prefix)[1]) <= 29, false)
    error_message = "Azure private endpoint subnets must be at least /29."
  }
}
variable "network_provider_registration_wait" {
  type        = string
  description = "Wait after Microsoft.Network registration for a new managed spoke. Increase if registration propagation requires more time."
  default     = "90s"
}
variable "hub" {
  description = "Explicit hub contract from the shared hub bootstrap."
  type = object({
    subscription_id      = string
    resource_group_name  = string
    virtual_network_name = string
    virtual_network_id   = string
    address_space        = set(string)
    private_dns_zones = map(object({
      id                  = string
      name                = string
      resource_group_name = string
    }))
  })
}

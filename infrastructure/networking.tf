variable "network_hubs" {
  description = "Shared hubs exported by the hub bootstrap pipeline, keyed by the portal hub alias."
  type = map(object({
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
  }))
  default = {}

  validation {
    condition = alltrue([
      for key, hub in var.network_hubs :
      can(regex("^[a-z0-9][a-z0-9-]{0,47}$", key)) &&
      lower(hub.virtual_network_id) == lower(format(
        "/subscriptions/%s/resourceGroups/%s/providers/Microsoft.Network/virtualNetworks/%s",
        hub.subscription_id, hub.resource_group_name, hub.virtual_network_name
      ))
    ])
    error_message = "Hub aliases must use lowercase letters, numbers and hyphens; the hub VNet ID must match its subscription, resource group and name."
  }
}

variable "network_external_address_spaces" {
  description = "Additional connected network prefixes, including existing spokes and on-premises ranges, keyed by a unique name."
  type        = map(set(string))
  default     = {}
}

variable "network_provider_registration_wait" {
  description = "Wait for Microsoft.Network registration propagation when creating a managed spoke."
  type        = string
  default     = "90s"
}

locals {
  network_spokes = {
    for key, subscription in local.subscriptions : key => subscription
    if subscription.network_mode == "spoke" && !subscription.destroy
  }
}

resource "terraform_data" "network_requests" {
  input = { for key, subscription in local.subscriptions : key => subscription.network_mode }
  lifecycle {
    precondition {
      condition     = alltrue([for subscription in local.subscriptions : contains(["none", "spoke"], subscription.network_mode)])
      error_message = "network_mode must be none or spoke."
    }
    precondition {
      condition     = alltrue([for subscription in local.network_spokes : contains(keys(var.network_hubs), subscription.network_hub_key)])
      error_message = "Every spoke must select a configured network_hubs alias. Create the shared hub first."
    }
  }
}

module "network_address_plan" {
  source = "./networking/terraform_modules/address_plan"
  virtual_networks = merge(
    { for key, hub in var.network_hubs : format("hub:%s", key) => { address_space = hub.address_space, subnets = {} } },
    { for key, prefixes in var.network_external_address_spaces : format("external:%s", key) => { address_space = prefixes, subnets = {} } },
    { for key, subscription in local.network_spokes : format("spoke:%s", key) => {
      address_space = [subscription.network_address_space]
      subnets = {
        workload          = [subscription.network_workload_subnet_prefix]
        private-endpoints = [subscription.network_private_endpoint_subnet_prefix]
      }
    } }
  )
}

module "subscription_networking" {
  source     = "./terraform_modules/subscription_networking"
  for_each   = local.network_spokes
  depends_on = [module.subscription]

  subscription_id                    = module.subscription[each.key].subscription_id
  project_name                       = each.value.project_name
  environment                        = each.value.environment
  location                           = each.value.location
  tags                               = each.value.tags
  address_space                      = each.value.network_address_space
  workload_subnet_prefix             = each.value.network_workload_subnet_prefix
  private_endpoint_subnet_prefix     = each.value.network_private_endpoint_subnet_prefix
  network_provider_registration_wait = var.network_provider_registration_wait
  # Unknown aliases fail the validation gate before subscription resources can be created.
  hub = try(var.network_hubs[each.value.network_hub_key], {
    subscription_id      = "00000000-0000-0000-0000-000000000000"
    resource_group_name  = "unconfigured"
    virtual_network_name = "unconfigured"
    virtual_network_id   = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/unconfigured/providers/Microsoft.Network/virtualNetworks/unconfigured"
    address_space        = ["0.0.0.0/32"]
    private_dns_zones    = {}
  })
}

output "subscription_networks" {
  description = "Managed spoke and subnet IDs keyed by project-environment. Workload deployment modules can consume this contract."
  value       = { for key, network in module.subscription_networking : key => network.network }
}

locals {
  # Keep names stable and collision-resistant even for long portal project names.
  project_key = lower(format("%s-%s", var.project_name, var.environment))
  name        = format("%s-%s", substr(replace(local.project_key, "/[^a-z0-9-]/", "-"), 0, 38), substr(sha256(local.project_key), 0, 8))
  group_name  = format("rg-net-%s", local.name)
  vnet_name   = format("vnet-%s", local.name)
  group_id    = format("/subscriptions/%s/resourceGroups/%s", var.subscription_id, local.group_name)
  vnet_id     = format("%s/providers/Microsoft.Network/virtualNetworks/%s", local.group_id, local.vnet_name)
  link_name   = format("%s-%s", local.name, replace(var.subscription_id, "-", ""))
  tags        = merge(var.tags, { project = var.project_name, environment = var.environment, created-by = "Terraform" })
  subnets = {
    workload          = var.workload_subnet_prefix
    private-endpoints = var.private_endpoint_subnet_prefix
  }
}

module "address_plan" {
  source = "../../networking/terraform_modules/address_plan"
  virtual_networks = {
    hub   = { address_space = var.hub.address_space }
    spoke = { address_space = [var.address_space], subnets = { for name, prefix in local.subnets : name => [prefix] } }
  }
}

resource "azapi_resource_action" "register_network" {
  type        = "Microsoft.Resources/providers@2021-04-01"
  resource_id = format("/subscriptions/%s/providers/Microsoft.Network", var.subscription_id)
  action      = "register"
  method      = "POST"
  depends_on  = [module.address_plan]
}

resource "azapi_resource" "resource_group" {
  type       = "Microsoft.Resources/resourceGroups@2024-03-01"
  parent_id  = format("/subscriptions/%s", var.subscription_id)
  name       = local.group_name
  location   = var.location
  tags       = local.tags
  body       = {}
  depends_on = [time_sleep.network_registration]
}

resource "time_sleep" "network_registration" {
  create_duration = var.network_provider_registration_wait
  triggers        = { subscription_id = var.subscription_id }
  depends_on      = [azapi_resource_action.register_network]
}

resource "azapi_resource" "nsg" {
  for_each   = local.subnets
  type       = "Microsoft.Network/networkSecurityGroups@2024-05-01"
  parent_id  = local.group_id
  name       = format("nsg-%s-%s", local.name, each.key)
  location   = var.location
  tags       = local.tags
  body       = { properties = { securityRules = [] } }
  depends_on = [azapi_resource.resource_group]
}

resource "azapi_resource" "vnet" {
  type      = "Microsoft.Network/virtualNetworks@2024-05-01"
  parent_id = local.group_id
  name      = local.vnet_name
  location  = var.location
  tags      = local.tags
  body = {
    properties = {
      addressSpace = { addressPrefixes = [var.address_space] }
      subnets = [for name, prefix in local.subnets : {
        name = name
        properties = {
          addressPrefix                  = prefix
          defaultOutboundAccess          = false
          privateEndpointNetworkPolicies = "Enabled"
          networkSecurityGroup           = { id = format("%s/providers/Microsoft.Network/networkSecurityGroups/nsg-%s-%s", local.group_id, local.name, name) }
        }
      }]
    }
  }
  # Subnets belong to this module; workload stacks only deploy resources into their IDs.
  depends_on = [azapi_resource.nsg]
}

resource "azapi_resource" "spoke_to_hub" {
  type      = "Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2024-05-01"
  parent_id = local.vnet_id
  name      = "to-hub"
  body = {
    properties = {
      allowVirtualNetworkAccess = true
      allowForwardedTraffic     = false
      allowGatewayTransit       = false
      useRemoteGateways         = false
      remoteVirtualNetwork      = { id = var.hub.virtual_network_id }
    }
  }
  depends_on = [azapi_resource.vnet]
}

resource "azapi_resource" "hub_to_spoke" {
  type      = "Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2024-05-01"
  parent_id = var.hub.virtual_network_id
  name      = local.link_name
  body = {
    properties = {
      allowVirtualNetworkAccess = true
      allowForwardedTraffic     = false
      allowGatewayTransit       = false
      useRemoteGateways         = false
      remoteVirtualNetwork      = { id = local.vnet_id }
    }
  }
  depends_on = [azapi_resource.spoke_to_hub]
}

resource "azapi_resource" "dns_link" {
  for_each  = var.hub.private_dns_zones
  type      = "Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01"
  parent_id = each.value.id
  name      = local.link_name
  location  = "global"
  tags      = local.tags
  body = {
    properties = {
      registrationEnabled = false
      virtualNetwork      = { id = local.vnet_id }
    }
  }
  depends_on = [azapi_resource.hub_to_spoke]
}

output "network" {
  description = "Spoke IDs for application modules, without sharing subscription lifecycle state."
  value = {
    subscription_id     = var.subscription_id
    resource_group_name = local.group_name
    virtual_network_id  = local.vnet_id
    subnet_ids          = { for name, prefix in local.subnets : name => format("%s/subnets/%s", local.vnet_id, name) }
  }
}

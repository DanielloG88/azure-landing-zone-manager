mock_provider "azapi" {}
mock_provider "time" {}

variables {
  subscription_id                = "00000000-0000-0000-0000-000000000002"
  project_name                   = "sample"
  environment                    = "dev"
  location                       = "westeurope"
  address_space                  = "10.20.0.0/16"
  workload_subnet_prefix         = "10.20.1.0/24"
  private_endpoint_subnet_prefix = "10.20.2.0/24"
  tags = {
    owner       = "owner@example.com"
    cost-center = "CC-001"
    department  = "Platform Engineering"
    team        = "Cloud Operations"
  }
  hub = {
    subscription_id      = "00000000-0000-0000-0000-000000000001"
    resource_group_name  = "rg-connectivity"
    virtual_network_name = "vnet-hub"
    virtual_network_id   = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-connectivity/providers/Microsoft.Network/virtualNetworks/vnet-hub"
    address_space        = ["10.0.0.0/16"]
    private_dns_zones = {
      "privatelink.blob.core.windows.net" = {
        id                  = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-connectivity/providers/Microsoft.Network/privateDnsZones/privatelink.blob.core.windows.net"
        name                = "privatelink.blob.core.windows.net"
        resource_group_name = "rg-connectivity"
      }
    }
  }
}

run "target_subscription_and_shared_hub_are_separate" {
  command = plan
  assert {
    condition = (
      azapi_resource.resource_group.parent_id == "/subscriptions/00000000-0000-0000-0000-000000000002" &&
      azapi_resource.hub_to_spoke.parent_id == var.hub.virtual_network_id &&
      azapi_resource.spoke_to_hub.body.properties.remoteVirtualNetwork.id == var.hub.virtual_network_id &&
      azapi_resource.hub_to_spoke.body.properties.remoteVirtualNetwork.id == output.network.virtual_network_id
    )
    error_message = "The spoke must target the requested subscription with both peering directions to the shared hub."
  }
  assert {
    condition = alltrue([for subnet in azapi_resource.vnet.body.properties.subnets :
      !subnet.properties.defaultOutboundAccess && subnet.properties.privateEndpointNetworkPolicies == "Enabled"
    ]) && length(azapi_resource.nsg) == 2 && length(output.network.subnet_ids) == 2
    error_message = "Spokes require separate protected workload/private endpoint subnets without implicit outbound access."
  }
  assert {
    condition = (
      length(azapi_resource.dns_link) == 1 &&
      !azapi_resource.dns_link["privatelink.blob.core.windows.net"].body.properties.registrationEnabled &&
      azapi_resource.dns_link["privatelink.blob.core.windows.net"].body.properties.virtualNetwork.id == output.network.virtual_network_id
    )
    error_message = "The spoke must link to the existing central DNS zone without creating a second zone or auto-registering records."
  }
}

run "long_project_names_keep_links_inside_azure_limits" {
  command = plan
  variables {
    project_name = "a-very-long-project-name-that-exceeds-the-normal-resource-prefix"
    environment  = "a-long-environment-name"
  }
  assert {
    condition     = length(azapi_resource.hub_to_spoke.name) <= 80 && endswith(azapi_resource.hub_to_spoke.name, "00000000000000000000000000000002")
    error_message = "Hub-side peering names must fit Azure limits and remain unique across subscriptions."
  }
}

run "reject_missing_owner_tag" {
  command = plan
  variables {
    tags = { cost-center = "CC-001", department = "Platform", team = "Cloud" }
  }
  expect_failures = [var.tags]
}

run "reject_undersized_subnet" {
  command = plan
  variables {
    workload_subnet_prefix = "10.20.1.0/30"
  }
  expect_failures = [var.workload_subnet_prefix]
}

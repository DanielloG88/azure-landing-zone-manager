mock_provider "azurerm" {
  mock_resource "azurerm_virtual_network" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-alz-connectivity-dev/providers/Microsoft.Network/virtualNetworks/vnet-alz-connectivity-dev"
    }
  }
  mock_resource "azurerm_subnet" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-alz-connectivity-dev/providers/Microsoft.Network/virtualNetworks/vnet-alz-connectivity-dev/subnets/snet-shared-services"
    }
  }
  mock_resource "azurerm_network_security_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-alz-connectivity-dev/providers/Microsoft.Network/networkSecurityGroups/nsg-shared-services"
    }
  }
}

variables {
  subscription_id = "00000000-0000-0000-0000-000000000001"
  environment     = "dev"
  address_space   = ["10.0.0.0/16"]
  subnets         = { shared-services = ["10.0.1.0/24"] }
  private_dns_zone_names = [
    "privatelink.blob.core.windows.net",
    "privatelink.file.core.windows.net",
    "privatelink.vaultcore.azure.net",
  ]
  tags = {
    owner       = "owner@example.com"
    cost-center = "CC-001"
    department  = "Platform Engineering"
    team        = "Cloud Operations"
  }
}

run "export_hub_contract_for_workload_subscriptions" {
  command = apply

  assert {
    condition     = output.hub.virtual_network_name == "vnet-alz-connectivity-dev" && output.hub.subscription_id == var.subscription_id
    error_message = "The hub contract must retain the connectivity subscription and stable environment name."
  }

  assert {
    condition     = length(output.hub.private_dns_zones) == 3 && length(output.subnet_ids) == 1
    error_message = "The hub contract must export all selected zones and subnet IDs."
  }
}

run "reject_missing_mandatory_owner_tag" {
  command = plan
  variables {
    tags = { cost-center = "CC-001", department = "Platform Engineering", team = "Cloud Operations" }
  }
  expect_failures = [var.tags]
}

run "shared_subscription_inventory_supplies_connected_spokes" {
  command = plan
  variables {
    subscriptions_csv_path = "../../tests/fixtures/network-requests.csv"
  }
  assert {
    condition     = length(local.connected_spokes) == 1 && local.connected_spokes["spoke:connected-dev"].address_space == ["10.20.0.0/16"]
    error_message = "The hub must check the active spokes from the Manager CSV and omit subscriptions without managed networking."
  }
}

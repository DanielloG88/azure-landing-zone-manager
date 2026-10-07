mock_provider "azurerm" {
  mock_data "azurerm_storage_account" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-state/providers/Microsoft.Storage/storageAccounts/ststate"
    }
  }
}
mock_provider "azuread" {
  mock_data "azuread_group" {
    defaults = { object_id = "00000000-0000-0000-0000-000000000004" }
  }
}
mock_provider "azurecaf" {}
mock_provider "azapi" {}
mock_provider "random" {}
mock_provider "time" {}
mock_provider "local" {}

variables {
  environment                         = "prod"
  tfstate_resource_group              = "rg-state"
  tfstate_storage_account             = "ststate"
  manage_tfstate_supporting_resources = false
  network_hubs = {
    platform = {
      subscription_id      = "00000000-0000-0000-0000-000000000001"
      resource_group_name  = "rg-connectivity"
      virtual_network_name = "vnet-hub"
      virtual_network_id   = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-connectivity/providers/Microsoft.Network/virtualNetworks/vnet-hub"
      address_space        = ["10.0.0.0/16"]
      private_dns_zones    = {}
    }
  }
}

run "empty_inventory_creates_no_spokes" {
  command = plan
  assert {
    condition     = length(output.subscription_networks) == 0
    error_message = "The published empty subscription inventory must not create managed networking."
  }
}

run "single_subscription_csv_drives_optional_networking" {
  command = apply
  variables {
    subscriptions_csv_path = "tests/fixtures/network-requests.csv"
  }
  override_module {
    target  = module.subscription["connected-dev"]
    outputs = { subscription_id = "00000000-0000-0000-0000-000000000002" }
  }
  override_module {
    target  = module.subscription["isolated-dev"]
    outputs = { subscription_id = "00000000-0000-0000-0000-000000000003" }
  }
  assert {
    condition = (
      length(output.subscription_networks) == 1 &&
      output.subscription_networks["connected-dev"].subscription_id == "00000000-0000-0000-0000-000000000002"
    )
    error_message = "Only the spoke row creates networking, using the ID returned by subscription creation even when its CSV ID is empty."
  }
  assert {
    condition     = !contains(keys(local.subscriptions["connected-dev"].tags), "network_mode") && !contains(keys(local.subscriptions["connected-dev"].tags), "network_address_space")
    error_message = "Network control fields must never become subscription tags."
  }
}

run "unknown_hub_fails_before_subscription_work" {
  command = plan
  variables {
    subscriptions_csv_path = "tests/fixtures/network-requests.csv"
    network_hubs           = {}
  }
  override_module {
    target  = module.subscription["connected-dev"]
    outputs = { subscription_id = "00000000-0000-0000-0000-000000000002" }
  }
  override_module {
    target  = module.subscription["isolated-dev"]
    outputs = { subscription_id = "00000000-0000-0000-0000-000000000003" }
  }
  expect_failures = [terraform_data.network_requests]
}

locals {
  tags = merge({
    Environment  = var.environment
    BusinessUnit = var.business_unit
  }, var.tags)
  workload = "tfstate-landingzone"
}

provider "azurerm" {
  storage_use_azuread = true
  features {}
}

data "azurerm_client_config" "current" {}

data "azurerm_subscription" "subscription" {
  subscription_id = data.azurerm_client_config.current.subscription_id
}

resource "azurecaf_name" "main" {
  name           = local.workload
  resource_types = ["azurerm_resource_group", "azurerm_storage_container"]
  suffixes       = [var.environment]
}

resource "azurerm_resource_group" "main" {
  name     = azurecaf_name.main.results["azurerm_resource_group"]
  location = var.location
  tags     = local.tags
}

resource "azurecaf_name" "storage_account_main" {
  name          = local.workload
  resource_type = "azurerm_storage_account"
  suffixes      = [var.environment]
  random_length = 5
}

#tfsec:ignore:azure-storage-queue-services-logging-enabled
resource "azurerm_storage_account" "main" {
  tags                     = local.tags
  name                     = azurecaf_name.storage_account_main.result
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  # https_traffic_only_enabled      = true
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false

  blob_properties {
    change_feed_enabled = true
    versioning_enabled  = true
    container_delete_retention_policy {
      days = 60
    }
    delete_retention_policy {
      days = 60
    }
  }
}

resource "azurerm_storage_container" "main" {
  name                  = azurecaf_name.main.results["azurerm_storage_container"]
  container_access_type = "private"
  storage_account_name  = azurerm_storage_account.main.name
}

resource "azurerm_role_assignment" "service_principal" {
  scope                = azurerm_storage_container.main.resource_manager_id
  role_definition_name = "Storage Blob Data Owner"
  principal_id         = data.azurerm_client_config.current.object_id
}

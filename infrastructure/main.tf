terraform {
  backend "azurerm" {
    use_azuread_auth = true
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.20.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = ">= 3.2.0, < 4.0.0"
    }
    azurecaf = {
      source  = "aztfmod/azurecaf"
      version = ">= 1.2.19"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.1.0"
    }
    azapi = {
      source  = "azure/azapi"
      version = "~> 2.7.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.9"
    }
  }

  required_version = ">= 1.11.1"
}

provider "azurerm" {
  features {}
  storage_use_azuread = true
}

data "azurerm_storage_account" "tfstate" {
  name                = var.tfstate_storage_account
  resource_group_name = var.tfstate_resource_group
}

data "azuread_group" "administrator" {
  display_name     = var.tfstate_monitoring_group_name
  security_enabled = true
}

data "azurerm_storage_container" "tfstate" {
  count              = var.manage_tfstate_supporting_resources && var.environment == "dev" ? 1 : 0
  name               = "stct-tfstate-landingzone-${var.environment}"
  storage_account_id = data.azurerm_storage_account.tfstate.id
}

resource "azurerm_role_assignment" "tfstate_administrator_storage_blob_data_reader" {
  count                = var.manage_tfstate_supporting_resources && length(data.azurerm_storage_container.tfstate) > 0 ? 1 : 0
  scope                = data.azurerm_storage_container.tfstate[0].id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = data.azuread_group.administrator.object_id
}

resource "azurerm_management_lock" "storage_account" {
  count      = var.manage_tfstate_supporting_resources ? 1 : 0
  name       = "locked-storage-account"
  scope      = data.azurerm_storage_account.tfstate.id
  lock_level = "CanNotDelete"
  notes      = "Locking storage account with CannotDelete lock"

  depends_on = [
    azurerm_role_assignment.tfstate_administrator_storage_blob_data_reader
  ]
}

module "tfstate_monitoring" {
  count               = var.manage_tfstate_supporting_resources ? 1 : 0
  source              = "./tfstate_monitoring"
  resource_group_name = "rg-tfstate-landingzone-${var.environment}"
  group_display_name  = var.tfstate_monitoring_group_name
  storage_account_id  = data.azurerm_storage_account.tfstate.id
  environment         = var.environment
}

# ------------------------ landing zone deploy ------------------------

locals {
  management_group_id_alias_lookup = merge(
    {
      for key, value in var.management_group_id_aliases :
      lower(trimspace(key)) => trimspace(value)
      if trimspace(key) != "" && trimspace(value) != ""
    },
    {
      for _, value in var.management_group_id_aliases :
      lower(trimspace(value)) => trimspace(value)
      if trimspace(value) != ""
    }
  )

  # One-off overrides for globally unique tfstate storage account names.
  tfstate_storage_account_name_overrides = var.tfstate_storage_account_name_overrides

  # Existing subscriptions whose tags must remain outside landing-zone ownership.
  subscription_tag_management_overrides = var.subscription_tag_management_overrides

  # Keys that are NOT tags (config / control fields, not to be copied as tags).
  subscription_non_tag_columns = [
    "project_name",
    "display_project_name",
    "environment",
    "management_group_id",
    "location",
    "billing_scope",
    "subscription_id",
    "bootstrap_subscription_resources",
    "manage_management_group_attachment",
    "destroy",
    "destroyed_at",
    "sub_owner_group_enabled",
    "sub_contributor_group_enabled",
    "sub_reader_group_enabled",
    "sub_owner_group_name",
    "sub_contributor_group_name",
    "sub_reader_group_name",
    "sub_owner_members",
    "sub_contributor_members",
    "sub_reader_members",
  ]

  # Default tags applied to all subscriptions unless overridden by CSV
  default_subscription_tags = merge({
    department  = "Platform Engineering"
    team        = "Cloud Operations"
    owner       = "tbd"
    cost-center = "CC-001"
    created-by  = "Terraform"

    # Optional tags (only kept when set)
    project         = ""
    confidentiality = ""
    workload-id     = ""
    app             = ""
    compliance      = ""
    sla             = ""
    leanIX          = ""
  }, var.default_subscription_tags)

  # Read CSV file: one row per subscription
  subscriptions_csv = csvdecode(file("${path.module}/subscriptions.csv"))

  # Normalised map keyed by project_name from the CSV
  # Shape:
  # local.subscriptions = {
  #   "project-dev" = {
  #     project_name        = "project-dev"
  #     environment         = "test"
  #     management_group_id = "IT"
  #     location            = "westeurope"
  #     billing_scope       = "<...>"
  #     subscription_id     = ""
  #     bootstrap_subscription_resources = true
  #     destroy             = false
  #     sub_owner_group_enabled     = true
  #     sub_contributor_group_enabled = false
  #     sub_reader_group_enabled    = false
  #     sub_owner_group_name       = "Azure-SUB-project-dev-test-Owner"
  #     sub_contributor_group_name = "Azure-SUB-project-dev-test-Contributor"
  #     sub_reader_group_name      = "Azure-SUB-project-dev-test-Reader"
  #     sub_owner_members          = "john.doe@example.com;jane.smith@example.com"
  #     sub_contributor_members    = ""
  #     sub_reader_members         = ""
  #     tags                = { ... }
  #   }
  #   "project2-prod" = { ... }
  # }
  subscriptions = {
    for _, item in local.subscriptions_csv :
    "${lower(trimspace(item.project_name))}-${lower(trimspace(item.environment))}" => {
      project_name = item.project_name
      environment  = item.environment
      # The admin portal currently stores user-facing management group values in CSV.
      # Resolve those to the actual Azure management group ID before attaching subscriptions.
      management_group_id = lookup(
        local.management_group_id_alias_lookup,
        lower(trimspace(item.management_group_id)),
        trimspace(item.management_group_id) != "" ? trimspace(item.management_group_id) : null
      )

      # Fallbacks to existing defaults if CSV fields are empty
      location = trimspace(item.location) != "" ? item.location : "westeurope"

      billing_scope                      = trimspace(item.billing_scope) != "" ? item.billing_scope : var.billing_scope
      subscription_id                    = trimspace(lookup(item, "subscription_id", ""))
      bootstrap_subscription_resources   = trimspace(lookup(item, "bootstrap_subscription_resources", "")) != "" ? lower(trimspace(lookup(item, "bootstrap_subscription_resources", ""))) == "true" : trimspace(lookup(item, "subscription_id", "")) == ""
      manage_management_group_attachment = trimspace(lookup(item, "manage_management_group_attachment", "")) != "" ? lower(trimspace(lookup(item, "manage_management_group_attachment", ""))) == "true" : trimspace(lookup(item, "subscription_id", "")) == ""
      manage_subscription_tags = lookup(
        local.subscription_tag_management_overrides,
        "${lower(trimspace(item.project_name))}-${lower(trimspace(item.environment))}",
        true
      )
      tfstate_storage_account_name_override = lookup(
        local.tfstate_storage_account_name_overrides,
        "${lower(trimspace(item.project_name))}-${lower(trimspace(item.environment))}",
        ""
      )
      display_project_name = trimspace(lookup(item, "display_project_name", ""))
      subscription_display_name_override = trimspace(lookup(item, "display_project_name", "")) != "" ? format(
        "%s-%s-%s",
        var.subscription_display_name_prefix,
        trimspace(lookup(item, "display_project_name", "")),
        trimspace(item.environment)
      ) : ""

      # Convert the CSV string to a boolean
      destroy                       = lower(trimspace(item.destroy)) == "true"
      sub_owner_group_enabled       = lower(trimspace(lookup(item, "sub_owner_group_enabled", ""))) == "true"
      sub_contributor_group_enabled = lower(trimspace(lookup(item, "sub_contributor_group_enabled", ""))) == "true"
      sub_reader_group_enabled      = lower(trimspace(lookup(item, "sub_reader_group_enabled", ""))) == "true"
      sub_owner_group_name          = trimspace(lookup(item, "sub_owner_group_name", ""))
      sub_contributor_group_name    = trimspace(lookup(item, "sub_contributor_group_name", ""))
      sub_reader_group_name         = trimspace(lookup(item, "sub_reader_group_name", ""))
      sub_owner_members             = trimspace(lookup(item, "sub_owner_members", ""))
      sub_contributor_members       = trimspace(lookup(item, "sub_contributor_members", ""))
      sub_reader_members            = trimspace(lookup(item, "sub_reader_members", ""))

      # Final tag set:
      # - Start from sensible defaults
      # - Treat all extra CSV columns (except the known config fields) as tags
      # - Allow CSV columns (department, team, owner, etc.) to override defaults
      # - Always set Environment tag based on the row's environment (uppercased)
      tags = {
        for k, v in merge(
          local.default_subscription_tags,
          {
            for k, v in item : k => v
            if !contains(local.subscription_non_tag_columns, k) && trimspace(v) != ""
          },
          {
            Environment = upper(item.environment)
          }
        ) : k => v
        if trimspace(tostring(v)) != ""
      }
    }
  }
}

module "subscription" {
  # One module instance per CSV row (one row = one subscription)
  for_each = local.subscriptions

  source                                = "./terraform_modules/subscription"
  tags                                  = each.value.tags
  environment                           = each.value.environment
  project_name                          = each.value.project_name
  management_group_id                   = each.value.management_group_id
  location                              = each.value.location
  billing_scope                         = each.value.billing_scope
  subscription_id                       = each.value.subscription_id
  bootstrap_subscription_resources      = each.value.bootstrap_subscription_resources
  manage_management_group_attachment    = each.value.manage_management_group_attachment
  manage_subscription_tags              = each.value.manage_subscription_tags
  tfstate_storage_account_name_override = each.value.tfstate_storage_account_name_override
  destroy                               = each.value.destroy
  sub_owner_group_enabled               = each.value.sub_owner_group_enabled
  sub_contributor_group_enabled         = each.value.sub_contributor_group_enabled
  sub_reader_group_enabled              = each.value.sub_reader_group_enabled
  sub_owner_group_name                  = each.value.sub_owner_group_name
  sub_contributor_group_name            = each.value.sub_contributor_group_name
  sub_reader_group_name                 = each.value.sub_reader_group_name
  sub_owner_members                     = each.value.sub_owner_members
  sub_contributor_members               = each.value.sub_contributor_members
  sub_reader_members                    = each.value.sub_reader_members

  # Name prefixes to build display name and service principal
  subscription_display_name_prefix   = var.subscription_display_name_prefix
  subscription_display_name_override = each.value.subscription_display_name_override
  project_sp_prefix                  = var.project_sp_prefix
  storage_provider_registration_wait = var.storage_provider_registration_wait
}

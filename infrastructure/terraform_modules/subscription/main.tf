locals {
  existing_subscription_id         = trimspace(var.subscription_id)
  create_subscription_alias        = !var.destroy && local.existing_subscription_id == ""
  bootstrap_subscription_resources = local.create_subscription_alias ? true : var.bootstrap_subscription_resources
  subscription_id                  = local.create_subscription_alias ? azapi_resource.sub_alias[0].output["properties"]["subscriptionId"] : local.existing_subscription_id
  # Storage account names must be 3-24 chars, lowercase alphanumeric only.
  # Strip any non-alphanumeric chars from project_name to keep names valid.
  sa_tfstate_prefix            = lower(replace("sttfstate${var.project_name}", "/[^0-9a-z]/", ""))
  tfstate_storage_account_name = trimspace(var.tfstate_storage_account_name_override) != "" ? lower(trimspace(var.tfstate_storage_account_name_override)) : lower(substr("${local.sa_tfstate_prefix}${random_string.tfstate_sa_suffix.result}${var.environment}", 0, 24))
  workload                     = "tfstate-${var.project_name}"
  project_slug                 = replace(lower(var.project_name), " ", "-")
  project_segment              = trim(replace(replace(lower(trimspace(var.project_name)), "/[^a-z0-9-]/", "-"), "/-+/", "-"), "-")
  environment_segment = trim(
    replace(replace(lower(trimspace(var.environment)), "/[^a-z0-9-]/", "-"), "/-+/", "-"),
    "-"
  )
  subscription_display_name_prefix_segment = trim(
    replace(replace(lower(trimspace(var.subscription_display_name_prefix)), "/[^a-z0-9-]/", "-"), "/-+/", "-"),
    "-"
  )
  project_segment_safe                          = local.project_segment != "" ? local.project_segment : "project"
  environment_segment_safe                      = local.environment_segment != "" ? local.environment_segment : "env"
  subscription_display_name_prefix_segment_safe = local.subscription_display_name_prefix_segment != "" ? local.subscription_display_name_prefix_segment : "subscription"
  sub_owner_group_enabled                       = !var.destroy && var.sub_owner_group_enabled
  sub_contributor_group_enabled                 = !var.destroy && var.sub_contributor_group_enabled
  sub_reader_group_enabled                      = !var.destroy && var.sub_reader_group_enabled
  any_access_groups_enabled                     = local.sub_owner_group_enabled || local.sub_contributor_group_enabled || local.sub_reader_group_enabled
  sub_owner_group_name                          = trimspace(var.sub_owner_group_name) != "" ? trimspace(var.sub_owner_group_name) : "Azure-SUB-${local.project_segment_safe}-${local.environment_segment_safe}-Owner"
  sub_contributor_group_name                    = trimspace(var.sub_contributor_group_name) != "" ? trimspace(var.sub_contributor_group_name) : "Azure-SUB-${local.project_segment_safe}-${local.environment_segment_safe}-Contributor"
  sub_reader_group_name                         = trimspace(var.sub_reader_group_name) != "" ? trimspace(var.sub_reader_group_name) : "Azure-SUB-${local.project_segment_safe}-${local.environment_segment_safe}-Reader"
  sub_owner_member_candidates = split(
    ";",
    replace(replace(replace(var.sub_owner_members, ",", ";"), "\n", ";"), "\r", ";")
  )
  sub_contributor_member_candidates = split(
    ";",
    replace(replace(replace(var.sub_contributor_members, ",", ";"), "\n", ";"), "\r", ";")
  )
  sub_reader_member_candidates = split(
    ";",
    replace(replace(replace(var.sub_reader_members, ",", ";"), "\n", ";"), "\r", ";")
  )
  sub_owner_member_upns       = toset(compact([for value in local.sub_owner_member_candidates : lower(trimspace(value))]))
  sub_contributor_member_upns = toset(compact([for value in local.sub_contributor_member_candidates : lower(trimspace(value))]))
  sub_reader_member_upns      = toset(compact([for value in local.sub_reader_member_candidates : lower(trimspace(value))]))
}

resource "azapi_resource" "sub_alias" {
  count     = local.create_subscription_alias ? 1 : 0
  type      = "Microsoft.Subscription/aliases@2024-08-01-preview"
  name      = local.alias_name
  parent_id = "/"

  body = {
    properties = {
      displayName  = local.display_name
      billingScope = var.billing_scope
      workload     = "Production"
    }
  }

  response_export_values = ["properties.subscriptionId"]

  # Updating displayName through the alias makes subscriptionId unknown in the plan
  # and cascades into replacements of resources scoped to the subscription.
  lifecycle {
    precondition {
      condition     = trimspace(var.billing_scope) != "" && !strcontains(var.billing_scope, "<")
      error_message = "Configure a real billing_scope before creating a subscription."
    }
    ignore_changes = [
      body.properties.displayName
    ]
  }
}

resource "terraform_data" "subscription_display_name" {
  count = local.create_subscription_alias && trimspace(var.subscription_display_name_override) != "" ? 1 : 0

  input = {
    display_name    = local.display_name
    subscription_id = local.subscription_id
  }

  triggers_replace = [
    local.display_name,
    local.subscription_id
  ]

  provisioner "local-exec" {
    command = <<-EOT
      az rest \
        --method post \
        --uri "/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Subscription/rename?api-version=2021-10-01" \
        --body "$SUBSCRIPTION_RENAME_BODY"
    EOT

    interpreter = ["/bin/bash", "-c"]

    environment = {
      SUBSCRIPTION_ID          = self.input.subscription_id
      SUBSCRIPTION_RENAME_BODY = jsonencode({ subscriptionName = self.input.display_name })
    }
  }

  depends_on = [
    azapi_resource.sub_alias
  ]
}

resource "azapi_update_resource" "subscription_tags" {
  count     = var.destroy || !var.manage_subscription_tags ? 0 : 1
  type      = "Microsoft.Resources/tags@2021-04-01"
  name      = "default"
  parent_id = "/subscriptions/${local.subscription_id}"

  body = {
    properties = {
      tags = var.tags
    }
  }

  depends_on = [
    azapi_resource.sub_alias
  ]
}

resource "azapi_resource" "mg_attach" {
  count     = var.destroy || var.management_group_id == null || !var.manage_management_group_attachment ? 0 : 1
  type      = "Microsoft.Management/managementGroups/subscriptions@2020-05-01"
  name      = local.subscription_id
  parent_id = "/providers/Microsoft.Management/managementGroups/${var.management_group_id}"
}

# New subscriptions are often missing RP registrations (esp. Microsoft.Storage).
# Register it explicitly and wait a bit before creating the tfstate storage account.
resource "azapi_resource_action" "register_storage_provider" {
  count       = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1
  type        = "Microsoft.Resources/providers@2021-04-01"
  resource_id = "/subscriptions/${local.subscription_id}/providers/Microsoft.Storage"
  action      = "register"
  method      = "POST"

  depends_on = [
    azapi_resource.sub_alias,
    azapi_resource.mg_attach
  ]
}

resource "time_sleep" "wait_for_storage_provider" {
  count           = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1
  create_duration = var.storage_provider_registration_wait

  depends_on = [
    azapi_resource_action.register_storage_provider
  ]
}

data "azuread_client_config" "current" {}

resource "azuread_application" "project_sp" {
  count = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1

  display_name = "${var.project_sp_prefix}-${var.project_name}-${var.environment}"

  owners = [
    data.azuread_client_config.current.object_id
  ]

  sign_in_audience = "AzureADMyOrg"

  depends_on = [
    azapi_resource.sub_alias
  ]

  # Microsoft Graph permissions
  required_resource_access {
    resource_app_id = "00000003-0000-0000-c000-000000000000"

    resource_access {
      id   = "1bfefb4e-e0b5-418b-a88f-73c46d2cc8e9"
      type = "Role"
    }

    resource_access {
      id   = "18a4783c-866b-4cc7-a460-3d5e5662c884"
      type = "Role"
    }

    resource_access {
      id   = "62a82d76-70ea-41e2-9197-370581804d09"
      type = "Role"
    }

    resource_access {
      id   = "df021288-bdef-4463-88db-98f22de89214"
      type = "Role"
    }

    resource_access {
      id   = "e1fe6dd8-ba31-4d61-89e7-88639da4683d"
      type = "Scope"
    }
  }
}

resource "azuread_service_principal" "project_sp" {
  count = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1

  client_id = azuread_application.project_sp[count.index].client_id

  depends_on = [
    azapi_resource.sub_alias,
    azuread_application.project_sp
  ]
}

resource "time_sleep" "wait_after_sp" {
  count           = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1
  create_duration = "60s"

  depends_on = [
    azuread_service_principal.project_sp
  ]
}

resource "azuread_group" "subscription_owner" {
  count = var.destroy || !local.sub_owner_group_enabled ? 0 : 1

  display_name     = local.sub_owner_group_name
  description      = "Owner access for subscription ${local.display_name} - managed by Terraform"
  security_enabled = true

  depends_on = [
    azapi_resource.sub_alias
  ]
}

resource "azuread_group" "subscription_contributor" {
  count = var.destroy || !local.sub_contributor_group_enabled ? 0 : 1

  display_name     = local.sub_contributor_group_name
  description      = "Contributor access for subscription ${local.display_name} - managed by Terraform"
  security_enabled = true

  depends_on = [
    azapi_resource.sub_alias
  ]
}

resource "azuread_group" "subscription_reader" {
  count = var.destroy || !local.sub_reader_group_enabled ? 0 : 1

  display_name     = local.sub_reader_group_name
  description      = "Reader access for subscription ${local.display_name} - managed by Terraform"
  security_enabled = true

  depends_on = [
    azapi_resource.sub_alias
  ]
}

resource "time_sleep" "wait_after_access_groups" {
  count           = var.destroy || !local.any_access_groups_enabled ? 0 : 1
  create_duration = "30s"

  depends_on = [
    azuread_group.subscription_owner,
    azuread_group.subscription_contributor,
    azuread_group.subscription_reader
  ]
}

data "azuread_user" "subscription_owner_members" {
  for_each = var.destroy || !local.sub_owner_group_enabled ? toset([]) : local.sub_owner_member_upns

  user_principal_name = each.value
}

data "azuread_user" "subscription_contributor_members" {
  for_each = var.destroy || !local.sub_contributor_group_enabled ? toset([]) : local.sub_contributor_member_upns

  user_principal_name = each.value
}

data "azuread_user" "subscription_reader_members" {
  for_each = var.destroy || !local.sub_reader_group_enabled ? toset([]) : local.sub_reader_member_upns

  user_principal_name = each.value
}

resource "azuread_group_member" "subscription_owner_members" {
  for_each = var.destroy || !local.sub_owner_group_enabled ? tomap({}) : data.azuread_user.subscription_owner_members

  group_object_id  = azuread_group.subscription_owner[0].object_id
  member_object_id = each.value.object_id
}

resource "azuread_group_member" "subscription_contributor_members" {
  for_each = var.destroy || !local.sub_contributor_group_enabled ? tomap({}) : data.azuread_user.subscription_contributor_members

  group_object_id  = azuread_group.subscription_contributor[0].object_id
  member_object_id = each.value.object_id
}

resource "azuread_group_member" "subscription_reader_members" {
  for_each = var.destroy || !local.sub_reader_group_enabled ? tomap({}) : data.azuread_user.subscription_reader_members

  group_object_id  = azuread_group.subscription_reader[0].object_id
  member_object_id = each.value.object_id
}

resource "azurerm_role_assignment" "subscription_owner" {
  count                = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1
  scope                = "/subscriptions/${local.subscription_id}"
  role_definition_name = "Owner"
  principal_id         = azuread_service_principal.project_sp[0].object_id

  depends_on = [
    azapi_resource.sub_alias,
    time_sleep.wait_after_sp
  ]
}

resource "azurerm_role_assignment" "subscription_owner_group" {
  count                = var.destroy || !local.sub_owner_group_enabled ? 0 : 1
  scope                = "/subscriptions/${local.subscription_id}"
  role_definition_name = "Owner"
  principal_id         = azuread_group.subscription_owner[0].object_id
  principal_type       = "Group"

  depends_on = [
    azapi_resource.sub_alias,
    time_sleep.wait_after_access_groups
  ]
}

resource "azurerm_role_assignment" "subscription_contributor_group" {
  count                = var.destroy || !local.sub_contributor_group_enabled ? 0 : 1
  scope                = "/subscriptions/${local.subscription_id}"
  role_definition_name = "Contributor"
  principal_id         = azuread_group.subscription_contributor[0].object_id
  principal_type       = "Group"

  depends_on = [
    azapi_resource.sub_alias,
    time_sleep.wait_after_access_groups
  ]
}

resource "azurerm_role_assignment" "subscription_reader_group" {
  count                = var.destroy || !local.sub_reader_group_enabled ? 0 : 1
  scope                = "/subscriptions/${local.subscription_id}"
  role_definition_name = "Reader"
  principal_id         = azuread_group.subscription_reader[0].object_id
  principal_type       = "Group"

  depends_on = [
    azapi_resource.sub_alias,
    time_sleep.wait_after_access_groups
  ]
}

resource "random_string" "tfstate_sa_suffix" {
  length  = 4
  upper   = false
  numeric = false
  special = false
}

resource "azurecaf_name" "tfstate_main" {
  name           = local.workload
  resource_types = ["azurerm_resource_group", "azurerm_storage_container"]
  suffixes       = [var.environment]
}

resource "azurecaf_name" "tfstate_sa" {
  name          = local.workload
  resource_type = "azurerm_storage_account"
  suffixes      = [var.environment]
  random_length = 5
}

resource "azapi_resource" "tfstate_rg" {
  count     = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1
  type      = "Microsoft.Resources/resourceGroups@2022-09-01"
  name      = azurecaf_name.tfstate_main.results["azurerm_resource_group"]
  parent_id = "/subscriptions/${local.subscription_id}"
  location  = var.location
  tags      = var.tags

  lifecycle {
    ignore_changes = [
      tags
    ]
  }
}

resource "azapi_update_resource" "tfstate_rg_tags" {
  count     = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1
  type      = "Microsoft.Resources/resourceGroups@2022-09-01"
  name      = azapi_resource.tfstate_rg[0].name
  parent_id = "/subscriptions/${local.subscription_id}"

  body = {
    tags = var.tags
  }

  depends_on = [
    azapi_resource.tfstate_rg
  ]
}

resource "azapi_resource" "tfstate_sa" {
  count     = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1
  type      = "Microsoft.Storage/storageAccounts@2023-01-01"
  name      = local.tfstate_storage_account_name
  parent_id = azapi_resource.tfstate_rg[0].id
  location  = var.location

  timeouts {
    create = "30m"
    update = "30m"
  }

  body = {
    sku  = { name = "Standard_LRS" }
    kind = "StorageV2"
    properties = {
      allowBlobPublicAccess = false
      allowSharedKeyAccess  = false
      minimumTlsVersion     = "TLS1_2"
    }
    tags = var.tags
  }

  lifecycle {
    ignore_changes = [
      body.tags
    ]
  }

  depends_on = [
    azapi_resource.tfstate_rg,
    azapi_resource.mg_attach,
    time_sleep.wait_for_storage_provider
  ]
}

resource "azapi_update_resource" "tfstate_sa_tags" {
  count     = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1
  type      = "Microsoft.Storage/storageAccounts@2023-01-01"
  name      = azapi_resource.tfstate_sa[0].name
  parent_id = azapi_resource.tfstate_rg[0].id

  body = {
    tags = var.tags
  }

  depends_on = [
    azapi_resource.tfstate_sa
  ]
}

resource "azapi_update_resource" "tfstate_blob_service" {
  count     = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1
  type      = "Microsoft.Storage/storageAccounts/blobServices@2023-01-01"
  name      = "default"
  parent_id = azapi_resource.tfstate_sa[0].id

  body = {
    properties = {
      isVersioningEnabled = true
      deleteRetentionPolicy = {
        enabled = true
        days    = 60
      }
      containerDeleteRetentionPolicy = {
        enabled = true
        days    = 60
      }
    }
  }
}

resource "azapi_resource" "tfstate_container" {
  count     = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1
  type      = "Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01"
  name      = azurecaf_name.tfstate_main.results["azurerm_storage_container"]
  parent_id = azapi_update_resource.tfstate_blob_service[0].id

  body = {
    properties = {
      publicAccess = "None"
    }
  }
}

resource "azurerm_role_assignment" "tfstate_sp" {
  count                = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1
  scope                = azapi_resource.tfstate_container[0].id
  role_definition_name = "Storage Blob Data Owner"
  principal_id         = azuread_service_principal.project_sp[0].object_id

  depends_on = [
    azapi_resource.tfstate_container,
    time_sleep.wait_after_sp
  ]
}

data "azurerm_client_config" "current" {}

resource "local_file" "backend_config" {
  count = var.destroy || !local.bootstrap_subscription_resources ? 0 : 1

  content = <<-EOT
resource_group_name  = "${azapi_resource.tfstate_rg[0].name}"
storage_account_name = "${azapi_resource.tfstate_sa[0].name}"
container_name       = "${azapi_resource.tfstate_container[0].name}"
key                  = "${local.project_slug}-${var.environment}.terraform.tfstate"
subscription_id      = "${local.subscription_id}"
tenant_id            = "${data.azurerm_client_config.current.tenant_id}"
EOT

  filename = "${path.module}/${local.project_slug}-${var.environment}.azurerm.tfbackend"

  depends_on = [
    azapi_resource.tfstate_container
  ]
}

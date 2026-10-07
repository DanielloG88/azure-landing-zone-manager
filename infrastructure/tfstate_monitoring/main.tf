terraform {
  required_providers {
    azurecaf = {
      source  = "aztfmod/azurecaf"
      version = "1.2.19"
    }
  }
}

resource "azurecaf_name" "log_analytics_workspace_tfstate" {
  name          = "tfstate"
  resource_type = "azurerm_log_analytics_workspace"
  suffixes      = [var.environment]
}

data "azurerm_resource_group" "tfstate" {
  name = var.resource_group_name
}

resource "azurerm_log_analytics_workspace" "tfstate" {
  name                = azurecaf_name.log_analytics_workspace_tfstate.result
  resource_group_name = data.azurerm_resource_group.tfstate.name
  location            = data.azurerm_resource_group.tfstate.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_monitor_diagnostic_setting" "tfstate_audit_log_blob" {
  name                       = "tfstate-audit-log-blob"
  target_resource_id         = "${var.storage_account_id}/blobServices/default"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.tfstate.id

  enabled_log {
    category = "StorageRead"
  }

  enabled_log {
    category = "StorageWrite"
  }

  enabled_log {
    category = "StorageDelete"
  }

  enabled_metric {
    category = "Capacity"
  }

  enabled_metric {
    category = "Transaction"
  }
}

resource "azurerm_storage_management_policy" "tfstate_diagnostic_retention" {
  storage_account_id = var.storage_account_id

  rule {
    name    = "diagnostic-retention"
    enabled = true

    filters {
      blob_types = ["blockBlob"]
      prefix_match = [
        "insights-logs-StorageRead",
        "insights-logs-StorageWrite",
        "insights-logs-StorageDelete",
        "insights-metrics-Capacity",
        "insights-metrics-Transaction"
      ]
    }

    actions {
      base_blob {
        delete_after_days_since_modification_greater_than = 30
      }
    }
  }
}

data "azuread_group" "main" {
  display_name     = var.group_display_name
  security_enabled = true
}

data "azuread_users" "main" {
  object_ids     = data.azuread_group.main.members
  ignore_missing = true
}

resource "azurerm_monitor_action_group" "monitoring" {
  name                = "tfstate-monitoring-alert"
  resource_group_name = data.azurerm_resource_group.tfstate.name
  short_name          = "tfstate"

  dynamic "email_receiver" {
    for_each = data.azuread_users.main.users
    content {
      name                    = "Email ${email_receiver.value.display_name}"
      email_address           = email_receiver.value.mail != "" ? email_receiver.value.mail : email_receiver.value.user_principal_name
      use_common_alert_schema = true
    }
  }

  dynamic "azure_app_push_receiver" {
    for_each = data.azuread_users.main.users
    content {
      name          = "App ${azure_app_push_receiver.value.display_name}"
      email_address = azure_app_push_receiver.value.mail != "" ? azure_app_push_receiver.value.mail : azure_app_push_receiver.value.user_principal_name
    }
  }
}

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "tfstate_access_monitoring" {
  name                = "UnknownTerraformStateAccess"
  resource_group_name = data.azurerm_resource_group.tfstate.name
  location            = data.azurerm_resource_group.tfstate.location
  scopes              = [var.storage_account_id]
  description         = "Terraform state access by a user that is not a service principal."

  evaluation_frequency = "PT15M"
  window_duration      = "PT15M"
  severity             = var.environment == "dev" ? 3 : 0

  criteria {
    query                   = <<-QUERY
      StorageBlobLogs
        | where AuthenticationType == 'OAuth' and RequesterUpn contains '@' and OperationName  == "GetBlob"
        | project TimeGenerated, Uri, RequesterUpn, CallerIpAddress, AuthorizationDetails, UserAgentHeader, _ResourceId
      QUERY
    time_aggregation_method = "Count"
    threshold               = 1
    operator                = "GreaterThanOrEqual"
    resource_id_column      = "_ResourceId"

    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.monitoring.id]
  }

  lifecycle {
    ignore_changes = all
  }
}

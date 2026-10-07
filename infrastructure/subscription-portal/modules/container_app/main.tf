locals {
  aad_client_secret_value     = var.aad_client_secret != null && var.aad_client_secret != "" ? var.aad_client_secret : null
  aad_client_secret_secret_id = var.aad_client_secret_secret_id != null && var.aad_client_secret_secret_id != "" ? var.aad_client_secret_secret_id : null

  env_vars = {
    for key, value in var.env_vars :
    key => value
    if value != null && value != ""
  }
}

resource "azurerm_container_app" "this" {
  name                         = var.name
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.container_app_environment_id
  revision_mode                = "Single"
  workload_profile_name        = var.workload_profile_name
  tags                         = var.tags

  # The Portal Build & Deploy pipeline owns the immutable application image.
  # Portal infrastructure Terraform must not roll it back to an older tag.
  lifecycle {
    ignore_changes = [
      template[0].container[0].image
    ]
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  registry {
    server   = var.container_registry_login_server
    identity = var.identity_id
  }

  dynamic "secret" {
    for_each = local.aad_client_secret_secret_id != null ? [local.aad_client_secret_secret_id] : []
    content {
      name                = var.aad_client_secret_setting_name
      key_vault_secret_id = secret.value
      identity            = var.identity_id
    }
  }

  dynamic "secret" {
    for_each = local.aad_client_secret_value != null ? [local.aad_client_secret_value] : []
    content {
      name  = var.aad_client_secret_setting_name
      value = secret.value
    }
  }

  ingress {
    external_enabled           = var.ingress_external_enabled
    target_port                = var.ingress_target_port
    allow_insecure_connections = var.ingress_allow_insecure
    transport                  = var.ingress_transport

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = var.max_replicas

    container {
      name   = var.container_name
      image  = "${var.container_registry_login_server}/${var.image_name}:${var.image_tag}"
      cpu    = var.cpu
      memory = var.memory

      dynamic "env" {
        for_each = local.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }
}

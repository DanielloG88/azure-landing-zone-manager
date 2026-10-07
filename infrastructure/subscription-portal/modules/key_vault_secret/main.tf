resource "azurerm_key_vault_secret" "this" {
  count        = var.enabled ? 1 : 0
  key_vault_id = var.key_vault_id
  name         = var.name
  value        = var.value

  content_type = var.content_type != "" ? var.content_type : null

  lifecycle {
    ignore_changes = [value]
  }
}

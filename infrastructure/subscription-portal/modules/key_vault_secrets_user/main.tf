resource "azurerm_role_assignment" "this" {
  count                = var.enabled ? 1 : 0
  scope                = var.key_vault_id
  role_definition_name = var.role_definition_name
  principal_id         = var.principal_id
}

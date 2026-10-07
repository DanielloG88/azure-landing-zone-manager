output "name" {
  value       = azurerm_user_assigned_identity.this.name
  description = "User-assigned identity name."
}

output "id" {
  value       = azurerm_user_assigned_identity.this.id
  description = "User-assigned identity ID."
}

output "principal_id" {
  value       = azurerm_user_assigned_identity.this.principal_id
  description = "User-assigned identity principal ID."
}

output "client_id" {
  value       = azurerm_user_assigned_identity.this.client_id
  description = "User-assigned identity client ID."
}

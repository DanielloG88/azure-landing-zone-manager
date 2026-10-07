output "id" {
  value       = azurerm_container_registry.this.id
  description = "ACR resource ID."
}

output "name" {
  value       = azurerm_container_registry.this.name
  description = "ACR name."
}

output "login_server" {
  value       = azurerm_container_registry.this.login_server
  description = "ACR login server."
}

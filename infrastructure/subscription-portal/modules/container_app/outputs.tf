output "id" {
  value       = azurerm_container_app.this.id
  description = "Container App ID."
}

output "name" {
  value       = azurerm_container_app.this.name
  description = "Container App name."
}

output "fqdn" {
  value       = azurerm_container_app.this.ingress[0].fqdn
  description = "Container App FQDN."
}

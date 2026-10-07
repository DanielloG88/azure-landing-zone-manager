output "id" {
  value       = azurerm_log_analytics_workspace.this.id
  description = "Log Analytics workspace ID."
}

output "name" {
  value       = azurerm_log_analytics_workspace.this.name
  description = "Log Analytics workspace name."
}

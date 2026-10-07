output "id" {
  value       = try(azurerm_role_assignment.this[0].id, null)
  description = "Role assignment ID (if created)."
}

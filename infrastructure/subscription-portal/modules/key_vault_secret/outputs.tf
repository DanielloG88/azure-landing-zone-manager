output "id" {
  value       = try(azurerm_key_vault_secret.this[0].id, null)
  description = "Key Vault secret ID (if created)."
}

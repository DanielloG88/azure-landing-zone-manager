output "resource_group_name" {
  value       = module.resource_group.name
  description = "Portal resource group name."
}

output "container_app_name" {
  value       = try(module.container_app[0].name, null)
  description = "Container App name."
}

output "container_app_fqdn" {
  value       = try(module.container_app[0].fqdn, null)
  description = "Public FQDN for the portal."
}

output "container_app_environment_name" {
  value       = module.container_app_environment.name
  description = "Container Apps environment name."
}

output "container_registry_name" {
  value       = module.container_registry.name
  description = "ACR name."
}

output "container_registry_login_server" {
  value       = module.container_registry.login_server
  description = "ACR login server."
}

output "user_assigned_identity_id" {
  value       = module.user_assigned_identity.id
  description = "User-assigned identity resource ID."
}

output "user_assigned_identity_client_id" {
  value       = module.user_assigned_identity.client_id
  description = "User-assigned identity client ID."
}

output "user_assigned_identity_principal_id" {
  value       = module.user_assigned_identity.principal_id
  description = "User-assigned identity principal ID."
}

output "key_vault_name" {
  value       = try(module.key_vault[0].name, null)
  description = "Key Vault name (if created)."
}

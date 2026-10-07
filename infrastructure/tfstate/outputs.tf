output "storage_account_name" {
  value       = azurerm_storage_account.main.name
  description = "The name of the storage account containing the Terraform state."
}
output "storage_container" {
  value       = azurerm_storage_container.main.name
  description = "The name of the container containing the Terraform state."
}
output "resource_group_name" {
  value       = azurerm_resource_group.main.name
  description = "The name of the resource group containing the storage account."
}

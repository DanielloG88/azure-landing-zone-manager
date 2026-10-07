output "resource_group_name" {
  value = azurerm_resource_group.this.name
}

output "virtual_network_name" {
  value = azurerm_virtual_network.this.name
}

output "virtual_network_id" {
  value = azurerm_virtual_network.this.id
}

output "subnet_ids" {
  value = { for key, subnet in azurerm_subnet.this : key => subnet.id }
}

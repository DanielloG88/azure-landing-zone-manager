output "zones" {
  value = {
    for name, zone in azurerm_private_dns_zone.this : name => {
      id                  = zone.id
      name                = zone.name
      resource_group_name = zone.resource_group_name
    }
  }
}

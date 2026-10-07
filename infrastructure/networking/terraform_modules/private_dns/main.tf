resource "azurerm_private_dns_zone" "this" {
  for_each = var.zone_names

  name                = each.value
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "hub" {
  for_each = azurerm_private_dns_zone.this

  name                  = "link-hub"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = each.value.name
  virtual_network_id    = var.hub_virtual_network_id
  registration_enabled  = false
  tags                  = var.tags
}

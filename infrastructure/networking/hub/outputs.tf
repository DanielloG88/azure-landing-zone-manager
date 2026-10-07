output "hub" {
  description = "Explicit hub contract for the subscription lifecycle; does not expose the complete hub Terraform state."
  value = {
    subscription_id      = var.subscription_id
    resource_group_name  = module.hub.resource_group_name
    virtual_network_name = module.hub.virtual_network_name
    virtual_network_id   = module.hub.virtual_network_id
    address_space        = var.address_space
    private_dns_zones    = module.private_dns.zones
  }
}

output "subnet_ids" {
  description = "Hub subnet IDs for separately managed appliances or shared services."
  value       = module.hub.subnet_ids
}

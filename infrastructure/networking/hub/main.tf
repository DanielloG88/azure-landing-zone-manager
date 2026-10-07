locals {
  name = "${var.name_prefix}-${var.project_name}-${var.environment}"
  tags = merge(var.tags, {
    project     = var.project_name
    environment = var.environment
    created-by  = "Terraform"
  })
  subscription_rows = csvdecode(file(format("%s/%s", path.module, var.subscriptions_csv_path)))
  connected_spokes = {
    for row in local.subscription_rows : format("spoke:%s-%s", row.project_name, row.environment) => {
      address_space = [trimspace(lookup(row, "network_address_space", ""))]
    }
    if lower(trimspace(lookup(row, "network_mode", ""))) == "spoke" &&
    trimspace(lookup(row, "network_hub_key", "")) == var.hub_key &&
    lower(trimspace(row.destroy)) != "true"
  }
}

module "address_plan" {
  source = "../terraform_modules/address_plan"
  virtual_networks = merge({
    hub = {
      address_space = var.address_space
      subnets       = var.subnets
    }
    }, local.connected_spokes, {
    for key, prefixes in var.external_address_spaces : format("external:%s", key) => { address_space = prefixes }
  })
}

module "hub" {
  source = "../terraform_modules/virtual_network"

  name               = local.name
  location           = var.location
  address_space      = var.address_space
  tags               = local.tags
  enable_delete_lock = var.enable_delete_lock
  subnets = {
    for name, prefixes in var.subnets : name => {
      address_prefixes = prefixes
      security_rules   = lookup(var.subnet_security_rules, name, {})
    }
  }

  depends_on = [module.address_plan]
}

module "private_dns" {
  source = "../terraform_modules/private_dns"

  zone_names             = var.private_dns_zone_names
  resource_group_name    = module.hub.resource_group_name
  hub_virtual_network_id = module.hub.virtual_network_id
  tags                   = local.tags
}

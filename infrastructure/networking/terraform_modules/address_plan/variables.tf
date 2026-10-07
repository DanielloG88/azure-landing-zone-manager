variable "virtual_networks" {
  description = "IPv4 address spaces and subnet prefixes keyed by virtual network name. Include every network connected to the hub."
  type = map(object({
    address_space = set(string)
    subnets       = optional(map(set(string)), {})
  }))

  validation {
    condition = alltrue(flatten([
      for network in var.virtual_networks : concat(
        [length(network.address_space) > 0],
        [for prefix in concat(tolist(network.address_space), flatten([for prefixes in values(network.subnets) : tolist(prefixes)])) :
          can(cidrnetmask(prefix)) && try(split("/", prefix)[0] == cidrhost(prefix, 0), false)
        ]
      )
    ]))
    error_message = "Each network requires canonical IPv4 CIDRs; IPv6 and host bits in network prefixes are not supported."
  }
}

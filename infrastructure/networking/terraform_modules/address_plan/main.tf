terraform {
  required_version = ">= 1.11.1, < 2.0.0"
}

locals {
  # Integer intervals catch partial overlaps as well as identical prefixes.
  networks = flatten([
    for name, network in var.virtual_networks : [
      for prefix in network.address_space : {
        network = name
        prefix  = prefix
        first   = try(sum([for index, octet in split(".", cidrhost(prefix, 0)) : tonumber(octet) * pow(256, 3 - index)]), 0)
        last    = try(sum([for index, octet in split(".", cidrhost(prefix, -1)) : tonumber(octet) * pow(256, 3 - index)]), 0)
      }
    ]
  ])

  subnets = flatten([
    for name, network in var.virtual_networks : [
      for subnet, prefixes in network.subnets : [
        for prefix in prefixes : {
          network = name
          subnet  = subnet
          prefix  = prefix
          first   = try(sum([for index, octet in split(".", cidrhost(prefix, 0)) : tonumber(octet) * pow(256, 3 - index)]), 0)
          last    = try(sum([for index, octet in split(".", cidrhost(prefix, -1)) : tonumber(octet) * pow(256, 3 - index)]), 0)
        }
      ]
    ]
  ])
}

resource "terraform_data" "validated" {
  input = var.virtual_networks

  lifecycle {
    precondition {
      condition = alltrue(flatten([
        for index, left in local.networks : [
          for other_index, right in local.networks :
          left.last < right.first || right.last < left.first if other_index > index
        ]
      ]))
      error_message = "Virtual network address spaces overlap. Choose disjoint ranges for the hub and every spoke."
    }

    precondition {
      condition = alltrue([
        for subnet in local.subnets : anytrue([
          for network in local.networks :
          subnet.first >= network.first && subnet.last <= network.last if subnet.network == network.network
        ])
      ])
      error_message = "Every subnet must fit entirely inside an address space of its own virtual network."
    }

    precondition {
      condition = alltrue(flatten([
        for index, left in local.subnets : [
          for other_index, right in local.subnets :
          left.last < right.first || right.last < left.first
          if other_index > index && left.network == right.network
        ]
      ]))
      error_message = "Subnet prefixes overlap inside a virtual network."
    }
  }
}

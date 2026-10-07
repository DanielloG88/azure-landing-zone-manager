variables {
  virtual_networks = {
    hub = {
      address_space = ["10.0.0.0/16"]
      subnets       = { shared = ["10.0.1.0/24"] }
    }
    application = {
      address_space = ["10.10.0.0/16"]
      subnets = {
        workload          = ["10.10.1.0/24"]
        private-endpoints = ["10.10.2.0/24"]
      }
    }
  }
}

run "accept_disjoint_hub_and_spoke" {
  command = plan
}

run "reject_partially_overlapping_networks" {
  command = plan
  variables {
    virtual_networks = {
      hub   = { address_space = ["10.0.0.0/16"] }
      spoke = { address_space = ["10.0.128.0/17"] }
    }
  }
  expect_failures = [terraform_data.validated]
}

run "reject_subnet_outside_its_network" {
  command = plan
  variables {
    virtual_networks = {
      hub = {
        address_space = ["10.0.0.0/16"]
        subnets       = { workload = ["10.1.0.0/24"] }
      }
    }
  }
  expect_failures = [terraform_data.validated]
}

run "reject_overlapping_subnets" {
  command = plan
  variables {
    virtual_networks = {
      hub = {
        address_space = ["10.0.0.0/16"]
        subnets = {
          first  = ["10.0.1.0/24"]
          second = ["10.0.1.128/25"]
        }
      }
    }
  }
  expect_failures = [terraform_data.validated]
}

run "reject_noncanonical_cidr" {
  command = plan
  variables {
    virtual_networks = { hub = { address_space = ["10.0.1.0/16"] } }
  }
  expect_failures = [var.virtual_networks]
}

run "accept_adjacent_networks_and_subnets" {
  command = plan
  variables {
    virtual_networks = {
      first = {
        address_space = ["10.0.0.0/24"]
        subnets       = { left = ["10.0.0.0/25"], right = ["10.0.0.128/25"] }
      }
      second = { address_space = ["10.0.1.0/24"] }
    }
  }
}

run "reject_empty_address_space" {
  command = plan
  variables {
    virtual_networks = { hub = { address_space = [] } }
  }
  expect_failures = [var.virtual_networks]
}

run "reject_ipv6_in_ipv4_stack" {
  command = plan
  variables {
    virtual_networks = { hub = { address_space = ["fd00::/64"] } }
  }
  expect_failures = [var.virtual_networks]
}

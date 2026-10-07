moved {
  from = module.tfstate_monitoring
  to   = module.tfstate_monitoring[0]
}

moved {
  from = module.subscription["midpoint-test"]
  to   = module.subscription["iam-test"]
}

moved {
  from = module.subscription["midpoint-prod"]
  to   = module.subscription["iam-prod"]
}

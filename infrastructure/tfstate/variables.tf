variable "environment" {
  type        = string
  description = "Stage of the deployment and environment (e.g. dev, test, prod)."

  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "The environment must be \"dev\", \"test\" or \"prod\"."
  }
}
variable "location" {
  type        = string
  default     = "westeurope"
  description = "The location to deploy the storage account containing the Terraform state."
}

variable "business_unit" {
  type        = string
  description = "Business unit tag for the state backend."
  default     = "Platform"
}

variable "tags" {
  type        = map(string)
  description = "Additional organization-specific tags."
  default     = {}
}

variable "resource_group_name" {
  type        = string
  description = "The Name which should be used for this Resource Group."
}
variable "group_display_name" {
  type        = string
  description = "The display name of the Azure AD group to use for the alert action."
}
variable "storage_account_id" {
  type        = string
  description = "The resource id of the terraform storage account."
}
variable "environment" {
  type        = string
  description = "Stage of the deployment and environment (e.g. dev, test, prod)."
}

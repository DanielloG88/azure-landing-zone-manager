variable "name" {
  type        = string
  description = "Container App name."
}

variable "container_name" {
  type        = string
  description = "Container name inside the Container App template."
}

variable "resource_group_name" {
  type        = string
  description = "Resource group name."
}

variable "container_app_environment_id" {
  type        = string
  description = "Container Apps environment ID."
}

variable "workload_profile_name" {
  type        = string
  description = "Optional workload profile name for the Container App."
  default     = null
}

variable "container_registry_login_server" {
  type        = string
  description = "ACR login server."
}

variable "identity_id" {
  type        = string
  description = "User-assigned identity ID."
}

variable "image_name" {
  type        = string
  description = "Container image repository name."
}

variable "image_tag" {
  type        = string
  description = "Container image tag."
}

variable "cpu" {
  type        = number
  description = "CPU cores."
  default     = 0.25
}

variable "memory" {
  type        = string
  description = "Memory size."
  default     = "0.5Gi"
}

variable "min_replicas" {
  type        = number
  description = "Minimum replicas."
  default     = 0
}

variable "max_replicas" {
  type        = number
  description = "Maximum replicas."
  default     = 1
}

variable "ingress_external_enabled" {
  type        = bool
  description = "Whether ingress is reachable from public internet."
  default     = true
}

variable "ingress_target_port" {
  type        = number
  description = "Application port exposed by ingress."
  default     = 3000
}

variable "ingress_allow_insecure" {
  type        = bool
  description = "Allow HTTP on ingress (in addition to HTTPS)."
  default     = true
}

variable "ingress_transport" {
  type        = string
  description = "Ingress transport mode (auto, http, http2, tcp)."
  default     = "auto"
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply."
  default     = {}
}

variable "env_vars" {
  type        = map(string)
  description = "Environment variables for the container."
  default     = {}
}

variable "aad_client_secret" {
  type        = string
  description = "AAD app client secret value for Easy Auth (optional)."
  default     = null
  sensitive   = true
}

variable "aad_client_secret_secret_id" {
  type        = string
  description = "Key Vault secret ID for AAD app client secret (optional)."
  default     = null
}

variable "aad_client_secret_setting_name" {
  type        = string
  description = "Container App secret name used by Easy Auth."
  default     = "aad-client-secret"
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the Worker and D1 database."
  type        = string
  sensitive   = true
}

variable "d1_database_name" {
  description = "Name for the production D1 database. Changing it replaces the database."
  type        = string
  default     = "kintai-note"
}

variable "d1_primary_location_hint" {
  description = "Optional primary-location hint. apac is appropriate for a Japan-based personal deployment."
  type        = string
  default     = "apac"
  nullable    = true
}

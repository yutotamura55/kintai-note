terraform {
  # Organization and workspace are supplied through environment variables.
  cloud {}

  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.24"
    }
  }
}

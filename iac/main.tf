provider "cloudflare" {}

resource "cloudflare_d1_database" "kintai_note" {
  account_id            = var.cloudflare_account_id
  name                  = var.d1_database_name
  primary_location_hint = var.d1_primary_location_hint

  # A replacement destroys all attendance records. Change deliberately, after backup.
  lifecycle {
    prevent_destroy = true
  }
}

output "d1_database_id" {
  description = "Set this value as d1_databases[0].database_id in ../wrangler.jsonc."
  value       = cloudflare_d1_database.kintai_note.id
}

output "wrangler_d1_binding" {
  description = "The D1 binding fragment for wrangler.jsonc."
  value = {
    binding       = "DB"
    database_name = cloudflare_d1_database.kintai_note.name
    database_id   = cloudflare_d1_database.kintai_note.id
  }
}

# Only the ruleset bundled with TFLint is used (tflint-ruleset-terraform v0.15.0 in TFLint v0.65.0),
# so no plugin is downloaded and CI and local runs behave the same. Without a plugin block, TFLint
# runs the bundled ruleset's recommended rules. The rules below are enabled in addition: the first
# three are the ones github-settings adds, and the last finds providers that are required but never
# used.
config {
  format = "compact"
}

rule "terraform_naming_convention" {
  enabled = true
}

rule "terraform_documented_variables" {
  enabled = true
}

rule "terraform_documented_outputs" {
  enabled = true
}

rule "terraform_unused_required_providers" {
  enabled = true
}

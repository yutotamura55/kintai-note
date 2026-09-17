# Cloudflare infrastructure

Terraform owns the production D1 database. Wrangler owns the application artifact (the Nuxt build) and applies its SQL schema.

## Prerequisites

- Terraform 1.6 or later
- A Cloudflare API token exported as `CLOUDFLARE_API_TOKEN`, with **D1:Edit** permissions for this account
- The account ID (not a zone ID)

## HCP Terraform and existing D1

Create a CLI-driven HCP Terraform workspace named `kintai-note-production` and set its Execution Mode to **Local**. GitHub Actions executes Terraform; HCP stores and locks the state. Do not also enable VCS-driven runs in HCP.

Use Terraform 1.11.4 to match CI. The organization and workspace are configured through environment variables:

```bash
export TF_CLOUD_ORGANIZATION='your-organization'
export TF_WORKSPACE='kintai-note-production'
export TF_VAR_cloudflare_account_id='your-cloudflare-account-id'
terraform login
read -rs -p 'Cloudflare API token: ' CLOUDFLARE_API_TOKEN
export CLOUDFLARE_API_TOKEN
terraform init
terraform import cloudflare_d1_database.kintai_note "${TF_VAR_cloudflare_account_id}/fafe0636-627d-415c-9007-01d110ff253c"
terraform plan
```

This project already has a production database. Import it rather than create another one. If existing local state already manages it, migrate that state during init and skip import. Check the plan for replacements/deletions and verify the ID matches `../wrangler.jsonc`. Commit the generated `.terraform.lock.hcl`.

Configure the GitHub environment as described in [CI/CD setup](../docs/github-cicd.md) before enabling automatic deployment. For deliberate manual deployments only:

```bash
npm run db:apply
npm run deploy
```

## Safety

`prevent_destroy` blocks accidental D1 deletion or replacement. Before intentional replacement, export the database and remove that lifecycle guard in a reviewed change. Terraform state is intentionally ignored by Git; back it up or configure a remote backend before collaborating.

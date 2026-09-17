# GitHubでの管理とCI/CD

`.github/workflows/ci.yml` が実行条件を管理し、`iac/` のTerraformがD1リソース、WranglerがWorkerのコードを管理します。

## 実行条件

- Pull Request: ローカルD1での統合テストとTerraformのfmt/validate。
- mainへのpush（PRのマージを含む）: 同じ検証に成功後、本番へデプロイ。
- Actionsからの手動実行: 検証のみ。

本番デプロイはRepository variable `PRODUCTION_DEPLOY_ENABLED` が `true` の場合だけ動きます。初回push前に設定を完了する必要はありません。

## GitHub側の設定

リポジトリを作成後、Settings → Environmentsで `production` を作り、デプロイ可能なブランチをmainに制限します。

production environmentに次を登録します。

| 種類 | 名前 | 内容 |
| --- | --- | --- |
| Secret | CLOUDFLARE_API_TOKEN | 対象アカウントに限定したWorkers Scripts:EditとD1:EditのAPIトークン |
| Variable | CLOUDFLARE_ACCOUNT_ID | CloudflareアカウントID |

Settings → Secrets and variables → Actions → Variablesに `PRODUCTION_DEPLOY_ENABLED=true` を登録すると自動デプロイが有効になります。トークン値をGitに保存しないでください。BOOTSTRAP_TOKENはCIでは不要です。

mainへの直接pushもデプロイ条件です。PR経由に限定したい場合は、GitHubのブランチ保護でPRを必須にし、`Local integration tests` と `Terraform validation` を必須チェックにします。利用できる保護設定はGitHubのプランによります。

## Terraformの自動適用について

PRではTerraformの構文検証を実行します。本番デプロイジョブではHCPのstateを使ってplan/applyした後、DBスキーマとWorkerを反映します。既存D1のimportが済んでいない場合は停止します。

HCP TerraformでCLI-driven workspace `kintai-note-production` を作り、Execution Modeを **Local** に設定します。ここでのLocalは実行場所がGitHub Actionsという意味です。stateはHCPに保存されます。HCP側のVCS自動実行は設定しません。

production environmentに次も登録します。

| 種類 | 名前 | 内容 |
| --- | --- | --- |
| Secret | TF_API_TOKEN | HCP Terraformのworkspaceへアクセスできるトークン |
| Variable | TF_CLOUD_ORGANIZATION | HCP Terraform organization名 |
| Variable | TF_WORKSPACE | kintai-note-production |

[初回import手順](../iac/README.md)を完了し、planを確認してから自動デプロイを有効にしてください。

## DB変更

現在のschema.sqlはCREATE TABLE IF NOT EXISTSによる初期スキーマです。デプロイ時に実行しますが、既存テーブルへの列追加などを自動反映するものではありません。今後スキーマを変更する際は、番号付きマイグレーションを導入してください。

## 参考

- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developer.hashicorp.com/terraform/cli/cloud

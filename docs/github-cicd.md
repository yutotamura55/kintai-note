# GitHubでの管理とCI/CD

`.github/workflows/ci.yml` が実行条件を管理し、`iac/` のTerraformがD1リソース、WranglerがWorkerのコードを管理します。

## 実行条件

- Pull Request: ローカルD1での統合テスト、`npm run check`（書式の確認・ESLint・型検査）、Terraformのfmt/validate。
- mainへのpush（PRのマージを含む）: 同じ検証に成功後、本番へデプロイ。
- Actionsからの手動実行: 検証のみ。

本番デプロイはRepository variable `PRODUCTION_DEPLOY_ENABLED` が `true` の場合だけ動きます。初回push前に設定を完了する必要はありません。

## GitHub側の設定

Settings → Environments → `production` の Deployment branches and tags は、カスタムの許可対象を `main` だけに設定しています。
別のブランチから `production` へのデプロイは許可しません。
環境を再作成する場合も、デプロイを有効にする前にこの設定を適用してください。
GitHub APIでは `deployment_branch_policy.custom_branch_policies=true` と、許可パターン `main` を確認できます。

production environmentに次を登録します。

| 種類 | 名前 | 内容 |
| --- | --- | --- |
| Secret | CLOUDFLARE_API_TOKEN | 対象アカウントに限定したWorkers Scripts:EditとD1:EditのAPIトークン |
| Variable | CLOUDFLARE_ACCOUNT_ID | CloudflareアカウントID |

Settings → Secrets and variables → Actions → Variablesに `PRODUCTION_DEPLOY_ENABLED=true` を登録すると自動デプロイが有効になります。トークン値をGitに保存しないでください。BOOTSTRAP_TOKENはCIでは不要です。

`main` には有効な `main-pr-and-ci` ruleset を設定し、PRと `Local integration tests`・`Static checks`・`Terraform validation` の成功を必須にしています。`Static checks` は 2026-10-25 に加えました。
旧Branch protection画面にルールがなくても、このrulesetが適用されます。
PRを手動でマージすると `main` へのpushで検証が始まり、成功後に `production` へ自動デプロイします。
`production` に追加の承認者は設定していません。

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

`db/schema.sql` は既存の初期スキーマとして維持し、追加変更は `migrations/` の番号付きSQLに記載します。`npm run db:apply` は初期スキーマの適用後、Wrangler の `d1 migrations apply kintai-note --remote` を実行します。CIはこの処理が成功した後にWorkerをデプロイします。ローカルでは `npm run db:local:apply` を使います。

`0001_original_attendance_times.sql` は初回打刻時刻の2カラムを追加します。既存レコードの時刻は変更せず、初回値は不明（NULL）のまま残します。新規DBにも既存DBにも、同じ「初期スキーマ → マイグレーション」の順で適用してください。`schema.sql` だけでは最新の構造になりません。

[Wranglerのマイグレーション管理](https://developers.cloudflare.com/d1/reference/migrations/)により、適用済みのファイルは再実行されません。適用済みSQLは変更せず、次の番号のファイルを追加してください。今回の変更はカラム追加のみのため、旧Workerも動作できます。ただし旧Workerへ戻すと、その間の打刻には初回値が保存されません。

## 参考

- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developer.hashicorp.com/terraform/cli/cloud

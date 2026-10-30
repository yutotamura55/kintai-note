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
必須チェックは strict の設定で、PRブランチが最新の `main` を取り込んだ状態で成功している必要があります。`main` が先に進んだら、PR画面の **Update branch** などで取り込み、その状態のチェックが成功してからマージします。
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

### マイグレーションの規則

デプロイの job は、人の承認なしに本番でマイグレーションを実行します。勤怠記録を失わないよう、次を守ります。

- **追加を先に出す。** 列やテーブルの追加だけを先の版で出し、列の削除や名前の変更は、古い列を使うコードがなくなった後の版で行います。
- **親のテーブルを `DROP TABLE` しない。** `users` と `invitations` は、他のテーブルから `ON DELETE CASCADE` で参照されています。`DROP TABLE` は行を削除してからテーブルを消すので、子のテーブルの行も消えます。D1 では外部キーの強制を止められません（[D1 の外部キー](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)）。公式資料にある `PRAGMA defer_foreign_keys = on` を使っても、連鎖削除は止まりません。2026-10-31 にローカルの D1 で、`users` を作り直すと `users` の行が残り、`attendance_records` の行が 0 件になることを確かめました。
- **`PRAGMA foreign_keys` をマイグレーションに書かない。** SQLite の一般的な作り直しの手順で使いますが、D1 では効きません。テストが失敗します。
- **`db/schema.sql` と矛盾させない。** デプロイのたびに `schema.sql` を適用し直します。ここにある索引の列を消すと、次のデプロイの `db:apply` が失敗します。
- **親を作り直すのは、列の追加で済まないときだけにする。** その場合は、依存するテーブルをすべてまとめて作り直します。今のスキーマの依存の順は、`users` → `invitations` → `passkeys`・`auth_challenges`・`sessions`・`attendance_records` です（`auth_challenges` は `users` と `invitations` の両方を参照します）。
  1. 新しいテーブル（`users_new` など）を依存の順に作ります。外部キーは、参照先の新しいテーブルに向けます。
  2. 依存の順に行をコピーします。
  3. 依存の逆順に、古いテーブルを `DROP TABLE` します。
  4. 依存の順に、新しいテーブルの名前を元に戻します。参照先の名前も自動で変わります。
  5. テーブルと一緒に消えた索引を作り直します。

  この手順は、2026-10-31 にローカルの D1 で、今のスキーマの全テーブルを使って確かめました。行が残り、作り直した後も連鎖削除が動きます。

`tests/migrations.test.ts` は、すべてのテーブルに 1 行ずつ入れた状態で各マイグレーションを実行し、行数が変わると失敗します。新しいテーブルを追加したら、テストの `seedRows` にも 1 行を足します。テーブルの廃止やデータの移行で行数が変わるのが正しいときは、テストを変え、理由を PR に書きます。

### マイグレーション前の復旧点

デプロイの job は、`npm run db:apply` の前に `wrangler d1 time-travel info kintai-note` を実行し、その時点のブックマークを job のログに残します。取得に失敗すると、マイグレーションもデプロイも実行しません。ログの見方：GitHub の Actions で該当の run を開き、`Deploy production` の `Apply schema and deploy Worker` にある `The current bookmark is` の行を探します。job を再実行した run では、最初の attempt のログを見ます。再実行で記録されるのは、マイグレーションの適用後のブックマークです。

本番を戻すときは、`docs/security-review.md` の「本番D1の復旧手順」に従います。この手順は、書き込みの止め方が決まるまで（#49）本番では実行できません。戻す前に、次の 2 点を確かめます。

- 原因のマイグレーションを `main` から取り除きます。適用の記録（`d1_migrations`）も一緒に戻るので、ファイルが残っていると次のデプロイで再び適用されます。
- 同じ job でデプロイした Worker が、戻した後のスキーマで動くかを確かめます。動かないなら、Worker も前の版に戻します。

ブックマークは Time Travel で戻せる期間（#49 で確認）を過ぎると使えません。

## 参考

- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developer.hashicorp.com/terraform/cli/cloud

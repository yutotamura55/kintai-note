# Kintai Note

少人数チーム向けのパスキー認証つき勤怠管理ツールです。Nuxt を Cloudflare Workers に、データを Cloudflare D1 に配置します。

## セットアップ

1. Node.js 22 以上を用意して `npm install`。
2. Cloudflare に D1 データベースを作成し、その ID を `wrangler.jsonc` の `database_id` に設定。
3. `wrangler d1 execute kintai-note --local --file=db/schema.sql` でローカル DB を作成。
4. `.dev.vars.example` を `.dev.vars` として複製し、初期管理者作成用トークンを設定。
5. `npm run dev` で起動し、`/setup` で最初の管理者を作成します。管理者作成後は `BOOTSTRAP_TOKEN` を削除してください。

## ローカル検証

Node.js 22 を使って、次のコマンドを実行します。

```bash
source ~/.nvm/nvm.sh
nvm use 22
npm run test:local
```

この検証は、ローカルD1へテスト用の利用者・セッション・勤怠記録を一時投入し、Workerを `http://127.0.0.1:8788` で起動して実行します。勤怠編集について、正常更新・日本時間での保存・不正な時刻順の拒否・未認証アクセスの拒否を確認します。終了時にはテスト用データを削除します。

`--local` を明示しているため、Cloudflare上のWorker・D1・シークレットには接続しません。ローカルの実データは `.wrangler/` に保存され、Git管理対象外です。

## 本番デプロイ

GitHub経由の自動検証・デプロイの設定は [GitHub CI/CD手順](docs/github-cicd.md) を参照してください。

Cloudflare リソースは [iac/](./iac/README.md) の Terraform で作成します。Terraform の出力した D1 ID を `wrangler.jsonc` に設定後、`npm run db:apply`、`npm run deploy` の順で実行します。本番環境では `RP_ID` を公開ホスト名（例: `kintai-note.example.com`）に設定してください。

> パスキーは RP ID とオリジンに結びつきます。本番運用前に独自ドメインへ移す場合は、先にそのドメインを確定してください。

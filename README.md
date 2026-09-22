# Kintai Note

少人数チーム向けのパスキー認証つき勤怠管理ツールです。Nuxt を Cloudflare Workers に、データを Cloudflare D1 に配置します。

## セットアップ

1. Node.js 22 以上を用意して `npm install`。
2. Cloudflare に D1 データベースを作成し、その ID を `wrangler.jsonc` の `database_id` に設定。
3. `npm run db:local:apply` でローカル DB の初期スキーマとマイグレーションを適用。
4. `.dev.vars.example` を `.dev.vars` として複製し、初期管理者作成用トークンを設定。
5. `npm run dev` で起動し、`/setup` で最初の管理者を作成します。管理者作成後は `BOOTSTRAP_TOKEN` を削除してください。

### Docker での開発

Docker と Docker Compose があれば、Node.js のバージョンや npm の依存関係をホストへインストールせずに開発できます。

```bash
docker compose up --build
```

ブラウザで `http://localhost:3000` を開きます。ソースコードはコンテナへマウントされるため、編集内容は自動的に反映されます。終了するときは `Ctrl+C` を押すか、別のターミナルで次を実行します。

```bash
docker compose down
```

単体テストは次のコマンドで実行できます。

```bash
docker compose run --rm app npm run test:unit
```

`.dev.vars` を使う場合は、リポジトリのホスト側に作成してください。`.dev.vars` や `.env` はイメージへコピーされません。Compose の設定は開発用であり、本番の Worker と D1 は従来どおり Wrangler と GitHub Actions からデプロイします。

## ローカル検証

Node.js 22 を使って、次のコマンドを実行します。

```bash
source ~/.nvm/nvm.sh
nvm use 22
npm run test:local
```

この検証は、勤務日の単体テストと本番ビルドを実行後、ローカルD1へテスト用の利用者・セッション・勤怠記録を一時投入し、Workerを `http://127.0.0.1:8788` で起動します。初回打刻時刻の保存・復元・既存データの移行・勤怠編集・日跨ぎ・既存の未退勤記録の引継ぎ・未退勤時の出勤拒否と解消後の出勤・二重打刻・PDF生成・認証を確認します。終了時にはテスト用データを削除します。

`npm run test:unit` では、日本時間の午前4時直前／ちょうど、月末・年末・うるう日、日時入力の検証と画面の操作テストを高速に実行できます。日時はテストに直接渡すため、PCの現在時刻・タイムゾーンに依存しません。本番APIにテスト用時刻の指定機能は追加していません。

`--local` を明示しているため、Cloudflare上のWorker・D1・シークレットには接続しません。ローカルの実データは `.wrangler/` に保存され、Git管理対象外です。

## 本番デプロイ

GitHub経由の自動検証・デプロイの設定は [GitHub CI/CD手順](docs/github-cicd.md) を参照してください。

Cloudflare リソースは [iac/](./iac/README.md) の Terraform で作成します。Terraform の出力した D1 ID を `wrangler.jsonc` に設定後、`npm run db:apply`、`npm run deploy` の順で実行します。本番環境では `RP_ID` を公開ホスト名（例: `kintai-note.example.com`）に設定してください。

> パスキーは RP ID とオリジンに結びつきます。本番運用前に独自ドメインへ移す場合は、先にそのドメインを確定してください。

## 元の打刻時刻への復元

月別の勤怠画面で、出勤・退勤それぞれの「元の打刻」を確認できます。「元の打刻時刻に戻す」を押すと、初回の打刻時刻がある項目を即時保存し、勤務日はそのまま維持します。片方だけ元の時刻がある場合、もう片方は変更しません。編集・再打刻・復元を繰り返しても初回の値は保持します。

導入前の記録や、打刻せず手入力した退勤には元の時刻がありません。現在の値を初回値として補完せず、「元の打刻時刻なし」と表示します。過去に上書きされた時刻をこの機能で取り戻すことはできません。

編集と復元は共通の検証・更新処理を使います。出退勤の逆転、未退勤の重複、処理中に発生した別の更新は拒否します。今後の休憩・離席機能（#2）では、この処理に休憩区間との整合性検証を追加し、修正・復元後の出退勤と休憩から実働時間を計算します。

## PDFの日本語フォント

PDFの氏名にはNoto Sans JPを埋め込みます。フォントは `app/public/fonts/` にライセンスとともに同梱し、Workersの `ASSETS` バインディングから読み込みます。外部CDNへの接続は不要です。PDFには使用した文字だけを埋め込み、フォント全体はWorkerのJavaScriptバンドルに含めません。

フォントの出典・生成手順は [fonts/README.md](app/public/fonts/README.md) を参照してください。日本語・かな・異体字の氏名を含むPDFの生成と文字抽出を単体テストで、配備したフォントを使うダウンロードをローカル統合テストで確認します。

# Kintai Note

少人数チーム向けのパスキー認証つき勤怠管理ツールです。Nuxt を Cloudflare Workers に、データを Cloudflare D1 に配置します。

## 公開コミットのメールアドレス

Gitのコミットに記録したauthor・committerのメールアドレスは、公開リポジトリの履歴から見えます。
このリポジトリのオーナーは、今後のコミット用にGitHubの`noreply`アドレスをローカルGit設定へ登録しています。
過去のコミット履歴は書き換えていません。

新しいクローンで作業するときは、GitHubの Settings → Emails で自分の`noreply`アドレスを確認してください。
そのクローンのルートで、次の形式のコマンドを実行します。山括弧の部分を自分のアドレスに置き換えます。

```bash
git config --local user.email '<自分の GitHub noreply アドレス>'
git config --local --get user.email
```

設定はクローンごとの`.git/config`に保存され、リポジトリには含まれません。
コミットする前に表示されたアドレスを確認してください。

## セットアップ

### VS Code Dev Container

Docker Desktop、WSL 連携、VS Code の Dev Containers 拡張機能を用意します。WSL 内でプロジェクトを開き、VS Code のコマンドパレットから `Dev Containers: Reopen in Container` を実行してください。初回のコンテナ作成時に `npm ci` が実行されます。ホストにNode.jsやnpmをインストールする必要はありません。

コンテナ内で次のセットアップを行います。

1. Cloudflare に D1 データベースを作成し、その ID を `wrangler.jsonc` の `database_id` に設定。
2. `npm run db:local:apply` でローカル DB の初期スキーマとマイグレーションを適用。
3. `.dev.vars.example` を `.dev.vars` として複製し、初期管理者作成用トークンを設定。
4. `npm run dev -- --host 0.0.0.0` で起動し、`/setup` で最初の管理者を作成します。管理者作成後は `BOOTSTRAP_TOKEN` を削除してください。

VS Code のターミナルと開発プロセスは `node` ユーザーで動きます。ソースコードと `.wrangler/state` はWSL内のプロジェクトフォルダに保存されます。ローカルD1のデータもこのフォルダに残り、コンテナを作り直しても保持されます。依存パッケージとNuxtの生成キャッシュはDockerの専用ボリュームに保存し、ホスト側のファイルと混在させません。`.wrangler/` はGit管理対象外です。

`package-lock.json` を更新したら、コンテナ内ターミナルで `npm ci` を実行して依存パッケージを更新してください。単体テストもコンテナ内で実行します。

```bash
npm run test:unit
```

開発サーバーは `http://localhost:3000` で開きます。終了するときは `Ctrl+C` を押してください。コンテナも停止する場合は、WSLのプロジェクトフォルダで `docker compose down` を実行します。

`.dev.vars` を使う場合はプロジェクトのルートに作成してください。VS Codeから接続したコンテナ内で利用できますが、`.dev.vars` や `.env` はイメージへコピーされません。Dev Container は開発専用であり、本番の Worker と D1 は従来どおり Wrangler と GitHub Actions からデプロイします。

### ホストで直接開発する場合

1. Node.js 22 以上を用意して `npm install`。
2. Cloudflare に D1 データベースを作成し、その ID を `wrangler.jsonc` の `database_id` に設定。
3. `npm run db:local:apply` でローカル DB の初期スキーマとマイグレーションを適用。
4. `.dev.vars.example` を `.dev.vars` として複製し、初期管理者作成用トークンを設定。
5. `npm run dev` で起動し、`/setup` で最初の管理者を作成します。管理者作成後は `BOOTSTRAP_TOKEN` を削除してください。

## コードの検査

コミットの前に、次のコマンドを実行します。Dev Container のターミナルでも、ホストで直接開発する場合でも同じです。

```bash
npm run check
```

`npm run check` は、次の 3 つを順に実行し、どれか 1 つでも失敗すると止まります。ESLint は警告も失敗として扱います。

| 順番 | 内容 | 単独で実行するコマンド | 自動で直すコマンド |
| --- | --- | --- | --- |
| 1 | 書式が Prettier の整形どおりかの確認 | `npm run format:check` | `npm run format` |
| 2 | ESLint（Nuxt の推奨ルール `@nuxt/eslint-config`）による誤りの検出 | `npm run lint` | `npx eslint . --fix`（自動で直せる指摘だけ） |
| 3 | 型検査（`nuxt typecheck`、vue-tsc）。画面・サーバー・共有コード・テストが対象 | `npm run typecheck` | なし |

GitHub Actions の `Static checks` ジョブでも同じ `npm run check` を実行し、失敗すると本番デプロイは行われません。

サーバー側の型は、`wrangler types` が生成した 2 つのファイルから読み込みます。どちらも手で編集しないでください。

| ファイル | 内容 | 作り直すとき | 作り直す方法 |
| --- | --- | --- | --- |
| `server/worker-runtime.d.ts` | `D1Database` などの Workers の実行環境の型 | `wrangler.jsonc` の互換日付・互換フラグを変えたとき、Wrangler を更新したとき | `npm run types:workers` |
| `server/cloudflare-env.d.ts` | `DB` などのバインディングを持つ `Env` の型 | `wrangler.jsonc` のバインディングを変えたとき | ファイルの 2 行目に書かれたコマンド（`wrangler types --include-runtime=false server/cloudflare-env.d.ts`） |

`npm run typecheck` は最初に `server/worker-runtime.d.ts` が `wrangler.jsonc` の互換日付・フラグと合っているかを確かめ、合っていなければ失敗します。`server/cloudflare-env.d.ts` は、ビルドの成果物と `.dev.vars` の有無で生成結果が変わるため、この確認の対象にしていません。

### 検査の対象外と例外

| 対象 | 内容 | 理由 |
| --- | --- | --- |
| Prettier | 生成ファイル 2 つ、`package-lock.json`、Markdown を整形しない（`.prettierignore`） | 生成ファイルは作り直したときの内容を保つため。Markdown は手書きの改行と表を保つため |
| ESLint | 生成ファイル 2 つを検査しない（`eslint.config.mjs`） | 同上 |
| ESLint | 書式に関わるルールを `eslint-config-prettier` で外す | 書式は Prettier が決め、両者が逆向きに直し合わないようにするため（例：`vue/html-self-closing`） |
| ESLint | `tests/` だけ `@typescript-eslint/no-explicit-any` と `@typescript-eslint/no-unsafe-function-type` を外す | テストは製品のソースを `new Function` で評価し、手作りの偽の部品を渡すため、扱う値に型がない |

書式を一括で整えたコミット（PR #46）は `.git-blame-ignore-revs` に登録しています。GitHub の blame 画面ではこのコミットが飛ばされます。手元の `git blame` で飛ばすには、一度だけ `git config blame.ignoreRevsFile .git-blame-ignore-revs` を実行してください。

### 今後厳しくする段階

型検査は Nuxt の既定で `strict` が有効です。次の順に、触るファイルから厳しくします。各段階は通常の作業とは別の Issue と PR で進めます。

1. テストの `any` と `Function` 型を具体的な型に置き換え、`tests/` の例外を外す。
2. typescript-eslint の型情報を使うルール（`recommendedTypeChecked`）を試し、既存コードの指摘の数を確かめてから有効にする。
3. TypeScript の `noUncheckedIndexedAccess`（配列や辞書の要素を `undefined` かもしれない値として扱う）を試し、指摘の数を確かめてから有効にする。

## ローカル検証

Node.js 22 を使って、次のコマンドを実行します。

```bash
source ~/.nvm/nvm.sh
nvm use 22
npm run test:local
```

この検証は、勤務日の単体テストと本番ビルドを実行後、ローカルD1へテスト用の利用者・セッション・勤怠記録を一時投入し、Workerを `http://127.0.0.1:8788` で起動します。初回打刻時刻の保存・復元・既存データの移行・勤怠編集・日跨ぎ・既存の未退勤記録の引継ぎ・未退勤時の出勤拒否と解消後の出勤・二重打刻・PDF生成・認証を確認します。終了時にはテスト用データを削除します。

続けて、パスキーの成功経路を実際の画面で確認します。ヘッドレスの Chromium に仮想のパスキー端末を付け、初期管理者のセットアップ、招待URLからの有効化、ログイン、パスキーの追加を順に操作します。招待URLの再使用、同じ端末へのパスキーの重複登録、無効化された利用者のログインが拒否されることも確認します。この検証は空のD1を実行ごとに `.wrangler/test-passkey-flow-*` に作り、Workerを `http://localhost:8789` で起動するため、普段使うローカルD1の利用者には影響しません。終了時にはこのディレクトリを削除します。

Chromium 本体は初回の実行時に `node_modules` 内へダウンロードされます。Chromium の動作に必要なシステムライブラリは Dev Container と GitHub Actions では用意済みです。ホストで直接実行する場合は、最初に一度 `npx playwright install-deps chromium` を実行してください。このコマンドは `sudo` で OS のパッケージをインストールします。

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

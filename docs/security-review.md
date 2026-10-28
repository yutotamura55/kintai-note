# kintai-note セキュリティレビュー

更新日: 2026-09-21

## 2026-10-25 の確認

PR #32 は 2026-10-24 に `main` へマージされ、同日の本番デプロイで反映されました。2026-10-25 時点の本番 Worker（`https://kintai-note.yutotamura.workers.dev`、バージョン `c89ff55d-e7f3-4c09-9edb-a9b45deba5a5`）で、本番のデータを書き換えない次の要求を送って確かめました。

| 要求 | 結果 |
| --- | --- |
| `GET /`、`GET /login` | `Strict-Transport-Security: max-age=31536000`、`Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Permissions-Policy: camera=(), microphone=(), geolocation=()` が付く |
| Cookie なしの `GET /api/auth/me` | 401（「ログインが必要です。」） |

認証オプションの発行と回数制限は、本番の D1 に challenge や回数の行を書き込むため、本番では試していません。認証の動作は、次のテストで確かめています。

| 確かめていること | テスト |
| --- | --- |
| ログアウト後に同じセッション Cookie が使えない、回数の上限を超えると 429 になる | ローカルの Worker + D1 の統合テスト（`scripts/test-local.mjs`） |
| challenge を一度しか使えない、初回管理者の同時作成で 1 人しか作られない、回数の記録が上限を超えて増えない、招待の同時使用でパスキーが 1 つしか登録されない | SQLite を使う単体テスト（`tests/auth-repository.test.ts`、`tests/invitation.test.ts`） |
| パスキーの登録とログイン、使用済みの招待 URL の拒否、2 回目の初期設定の拒否（同時ではなく順に送った場合）、無効化した利用者のセッションとログインの拒否 | 仮想のパスキー端末を使う画面テスト（`scripts/test-passkey-flow.mjs`） |

Cloudflare の WAF カスタムルールとレート制限ルールは、ゾーン（自分のドメイン）単位の機能で、`workers.dev` には設定できません（[WAF のフェーズと範囲](https://developers.cloudflare.com/waf/reference/phases/)、[workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)）。そのため、下の「2026-10-23 の対応状況」で未確認としていた WAF・Rate Limiting は、今の構成では使えないと分かりました。今の守りはアプリ側の接続元ごとの回数制限だけで、接続元を分散した大量の要求は防げません。

次の項目は、運用の確認や判断が必要なため #49 に分けました。独自ドメインへの移行の判断、デプロイ用 API トークンの権限と対象範囲、D1 を復旧するときの書き込みの止め方、契約プラン（Time Travel で戻せる期間と Workers の利用制限）です。

## 2026-10-23 の対応状況

以下の「結論」と「指摘事項」は、2026-09-21時点の静的レビュー記録です。
現在のコードでは、ログアウト時のD1セッション削除、チャレンジの単一SQL操作での消費、初期管理者の条件付き作成を追加しました。
認証オプション発行、招待確認、初期セットアップ、パスキー検証には、接続元ごとに5分間でそれぞれ10回、10回、5回、20回の上限を設けました。
期限切れのチャレンジとレート制限の記録は、認証オプション発行時または認証試行時に順次削除します。
アプリの応答にはフレーム埋め込み禁止、参照元情報の非送信などのヘッダーを付け、HTTPS応答にはHSTSを付けます。
招待URLの一回性は #24 で扱います。

これらはローカルD1・Workerと単体テストで確認したコード上の変更です。
本番Workerへの反映と、本番応答にヘッダーが付くことはPRのマージ・デプロイ後に確認します。
2026-10-23にWranglerで本番Workerの現行バージョンを確認しました。bindingは`ASSETS`と`DB`のみで、`wrangler secret list`も空です。`BOOTSTRAP_TOKEN`と`RP_ID`は登録されていません。D1にはユーザーが2件あり、`RP_ID`はリクエスト先のホスト名から決まる実装です。
D1は`production`ストレージで、Time Travelの現在・過去日時のブックマーク取得に成功しました。復旧操作そのものは本番データを上書きするため実行していません。CloudflareのWAF・Rate Limiting設定、デプロイ用APIトークンの実際の権限と対象範囲、Workers利用制限は未確認です。
アプリ内の接続元別制限だけでは、接続元を分散した大量の要求を抑えられません。

### 本番D1の復旧手順

誤更新が起きた場合は、まず新たな書き込みを遮断し、事故直前の日時と復旧で失われる更新範囲を確認します。このアプリには書き込みを止める専用機能がなく、公開経路の遮断方法も未整備です。Cloudflare Workers & Pagesの`kintai-note`の「Settings → Domains & Routes」で全公開経路を確認し、それぞれを遮断する運用を決めるまでは、本番復旧を実行しないでください。`workers.dev`だけを停止しても、カスタムドメインなど別の経路は残り得ます。

復旧先のブックマークは`npx wrangler d1 time-travel info kintai-note --timestamp="2026-10-20T00:00:00Z" --json`で取得します。この日時は形式例なので、実際の事故直前のUTC日時に置き換えます。JSONの`bookmark`値を記録します。実行直前には`npx wrangler d1 time-travel info kintai-note --json`で現在の`bookmark`値も記録します。

現在の状態も別に保存する場合は、`npx wrangler d1 export kintai-note --remote --output=<リポジトリ外の保存先>.sql`を実行します。SQLファイルには個人情報が含まれるため、保存先のアクセス権を制限します。

復旧を決めた場合に限り、`npx wrangler d1 time-travel restore kintai-note --bookmark=<復旧先のブックマーク>`を実行します。山括弧内は取得した値に置き換え、確認したブックマークを使用します。この操作は本番DBを指定時点の状態で上書きします。復旧後にユーザー数と主要な勤怠記録を確認してから書き込みを再開します。Time Travelの保持期間はWorkers Freeで7日、Paidで30日です。現在の契約プランは未確認なので、復旧可能期間は事前に確認してください。[Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

## 結論

Cloudflare Workers から D1 binding を利用する構成自体は妥当です。D1 をアプリケーションから直接公開している形跡はなく、SQL も基本的にバインドパラメータを使用しています。

一方、認証・初期設定の並行実行に対する整合性が不足しています。本番投入前に、招待登録の一回性、ログアウト時のサーバー側セッション失効、チャレンジ消費の原子性を優先して修正してください。

このレビューはリポジトリのコード、Wrangler/Terraform設定、GitHub Actionsを対象にした静的レビューです。Cloudflareダッシュボード、実際のWorkerレスポンス、D1のプラン・ストレージ世代・本番Secretは確認できていません。

## 指摘事項

この節のコードへのリンクは、指摘した時点のコード（コミット `14cc7ce`）の行を指します。その後の修正で、`main` の該当箇所は変わっています。

### 高: 招待URLの一回性が登録完了時に保証されない

`activate-options` は招待が未使用かを確認して登録チャレンジを発行しますが、登録完了時の `verifyRegistration` はチャレンジだけを消費し、招待の未使用・未期限切れを再確認しません。

そのため、同じ招待URLから複数の登録チャレンジを先に発行しておくと、最初の登録完了後でも別チャレンジで追加のパスキーを登録できる可能性があります。招待URLの入手が前提ですが、招待の一回性というデータモデルに反します。

該当箇所:

- [activate-options.post.ts](https://github.com/yutotamura55/kintai-note/blob/14cc7ce3dbc1404352f203e7965ca8cd0a2015f8/server/api/auth/activate-options.post.ts#L4)
- [webauthn.ts](https://github.com/yutotamura55/kintai-note/blob/14cc7ce3dbc1404352f203e7965ca8cd0a2015f8/server/utils/webauthn.ts#L68)
- [activate-verify.post.ts](https://github.com/yutotamura55/kintai-note/blob/14cc7ce3dbc1404352f203e7965ca8cd0a2015f8/server/api/auth/activate-verify.post.ts#L5)

登録完了時に、招待が未使用かつ期限内であることを条件に、招待の消費・ユーザー有効化・パスキー登録を原子的に処理する必要があります。

### 中: ログアウトがサーバー側セッションを失効させない

ログアウト処理はブラウザCookieを削除するだけで、D1の` sessions`行を削除していません。[auth.ts](https://github.com/yutotamura55/kintai-note/blob/14cc7ce3dbc1404352f203e7965ca8cd0a2015f8/server/utils/auth.ts#L29)

Cookieが複製・窃取されていた場合、ログアウト後も最大14日間利用できます。OWASPも、ログアウト時にはサーバー側のセッション状態を無効化することを求めています。[OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

現在のセッションCookieは`HttpOnly`、`Secure`、`SameSite=Strict`、`__Host-`接頭辞を使用しており、発行側の設定は良好です。修正対象はログアウト時のサーバー側削除と、削除用Cookieにも発行時と同じ安全属性を付けることです。

### 中: WebAuthnチャレンジの取得と削除が原子的ではない

チャレンジ消費は`SELECT`と`DELETE`という別々の操作です。[webauthn.ts](https://github.com/yutotamura55/kintai-note/blob/14cc7ce3dbc1404352f203e7965ca8cd0a2015f8/server/utils/webauthn.ts#L27)

同じCookieを持つ並行リクエストがSELECTを通過してからDELETEされると、同じチャレンジを複数の検証処理が利用できます。WebAuthn署名とカウンタ検証が別にあるため、直ちに認証突破を意味するものではありませんが、ワンタイムチャレンジの要件を満たしていません。

取得と削除を単一の条件付きDB操作にまとめ、削除できた行だけを有効なチャレンジとして扱うべきです。

### 中: 初期管理者作成に並行実行の競合がある

初期ユーザーが0人であることをSELECTで確認してから、別のINSERTを実行しています。[bootstrap.post.ts](https://github.com/yutotamura55/kintai-note/blob/14cc7ce3dbc1404352f203e7965ca8cd0a2015f8/server/api/admin/bootstrap.post.ts#L11)

同じ`BOOTSTRAP_TOKEN`を使った並行リクエストがあると、複数の管理者を作成できる可能性があります。通常は初期セットアップ時だけの問題ですが、初期状態の一意性をDBまたは単一トランザクションで保証すべきです。

### 中: 認証・初期設定エンドポイントにアプリ側のレート制限がない

ログインオプション、招待トークン検証、初期管理者セットアップなどに明示的なレート制限がありません。ログインオプション生成のたびに5分間有効な行が`auth_challenges`へ追加され、期限切れ行はログイン成功時の処理でしかまとめて削除されません。[webauthn.ts](https://github.com/yutotamura55/kintai-note/blob/14cc7ce3dbc1404352f203e7965ca8cd0a2015f8/server/utils/webauthn.ts#L19)

Cloudflare側のWAF/Rate Limiting設定は未確認なので、本番で無制限とは断定できません。アプリケーションまたはCloudflare側で、少なくとも認証試行・招待検証・初期セットアップに制限を設けるべきです。

### 低〜中: セキュリティレスポンスヘッダーの設定がソース上確認できない

Content-Security-Policy、`frame-ancestors`またはX-Frame-Options、Referrer-Policy、Permissions-Policy、HSTSの設定はソース上確認できません。

これは単独で直ちに脆弱性を示すものではありません。実際の本番レスポンスにCloudflare側またはNuxt側で付与されている可能性があるため、公開URLに対するヘッダー確認が必要です。

## 問題なしと判断した構成

- D1はWorkerの`DB` bindingから利用しており、DB接続情報をクライアントへ渡していない
- SQLは基本的にプレースホルダーを使用している
- 勤怠取得・更新時にユーザー所有権を条件に含めている
- セッションIDと各種IDは`crypto.randomUUID()`で生成している
- パスキー検証で期待するorigin、RP ID、challenge、user verificationを確認している
- セッションCookieの発行属性は`HttpOnly`、`Secure`、`SameSite=Strict`、`__Host-`である
- TerraformのD1リソースに`prevent_destroy = true`がある
- D1のread replicationを無効化している点は、小規模勤怠システムで整合性を優先する構成として妥当
- D1の保存時暗号化・通信暗号化はCloudflareが標準提供する[公式仕様](https://developers.cloudflare.com/d1/reference/data-security/)

## 過大評価として修正した事項

- `BOOTSTRAP_TOKEN`の残存は削除推奨だが、ユーザーが既に存在する場合はセットアップ処理が409を返すため、残存だけで直ちに管理者奪取とはいえない
- `BOOTSTRAP_TOKEN`を`secrets.required`にする提案は、初期セットアップ後にSecretを削除する運用と矛盾するため撤回する
- Cloudflare API Tokenの権限過多は、実際のToken設定を確認するまで脆弱性とは断定しない。Terraform用とWorkerデプロイ用の分離は改善案である
- D1のバックアップ設定が設定ファイルにないことは、バックアップが存在しないことを意味しない。D1 Time Travelのプラン・保持期間・復旧テストを確認する必要がある

## 未確認事項

- 本番Workerに`BOOTSTRAP_TOKEN`が残っているか
- 本番の`RP_ID`が実際の公開ホスト名と一致しているか
- 本番Workerの実レスポンスにセキュリティヘッダーがあるか
- Cloudflare側のWAF、Rate Limiting、Workers利用制限
- D1のプラン、ストレージ世代、Time Travel保持期間
- GitHub production Environmentの承認者・ブランチ制限
- Cloudflare API Tokenの実際の権限と対象アカウント範囲

## 推奨対応順

1. 招待登録の完了処理で、招待の再検証・一回性・パスキー登録を原子的に保証する
2. ログアウト時にD1セッションを削除し、`Secure`付きのCookieを失効させる
3. WebAuthnチャレンジを条件付き単一操作で消費する
4. 初期管理者作成を単一トランザクションまたはDB制約で一意化する
5. 認証系エンドポイントにレート制限と期限切れチャレンジの定期清掃を追加する
6. 本番レスポンス、Cloudflare設定、GitHub Environment、D1復旧手順を実環境で確認する

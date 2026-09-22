# kintai-note セキュリティレビュー

更新日: 2026-09-21

## 結論

Cloudflare Workers から D1 binding を利用する構成自体は妥当です。D1 をアプリケーションから直接公開している形跡はなく、SQL も基本的にバインドパラメータを使用しています。

一方、認証・初期設定の並行実行に対する整合性が不足しています。本番投入前に、招待登録の一回性、ログアウト時のサーバー側セッション失効、チャレンジ消費の原子性を優先して修正してください。

このレビューはリポジトリのコード、Wrangler/Terraform設定、GitHub Actionsを対象にした静的レビューです。Cloudflareダッシュボード、実際のWorkerレスポンス、D1のプラン・ストレージ世代・本番Secretは確認できていません。

## 指摘事項

### 高: 招待URLの一回性が登録完了時に保証されない

`activate-options` は招待が未使用かを確認して登録チャレンジを発行しますが、登録完了時の `verifyRegistration` はチャレンジだけを消費し、招待の未使用・未期限切れを再確認しません。

そのため、同じ招待URLから複数の登録チャレンジを先に発行しておくと、最初の登録完了後でも別チャレンジで追加のパスキーを登録できる可能性があります。招待URLの入手が前提ですが、招待の一回性というデータモデルに反します。

該当箇所:

- [activate-options.post.ts](/home/y-tamura/workspace/kintai-note/server/api/auth/activate-options.post.ts:4)
- [webauthn.ts](/home/y-tamura/workspace/kintai-note/server/utils/webauthn.ts:68)
- [activate-verify.post.ts](/home/y-tamura/workspace/kintai-note/server/api/auth/activate-verify.post.ts:5)

登録完了時に、招待が未使用かつ期限内であることを条件に、招待の消費・ユーザー有効化・パスキー登録を原子的に処理する必要があります。

### 中: ログアウトがサーバー側セッションを失効させない

ログアウト処理はブラウザCookieを削除するだけで、D1の` sessions`行を削除していません。[auth.ts](/home/y-tamura/workspace/kintai-note/server/utils/auth.ts:29)

Cookieが複製・窃取されていた場合、ログアウト後も最大14日間利用できます。OWASPも、ログアウト時にはサーバー側のセッション状態を無効化することを求めています。[OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

現在のセッションCookieは`HttpOnly`、`Secure`、`SameSite=Strict`、`__Host-`接頭辞を使用しており、発行側の設定は良好です。修正対象はログアウト時のサーバー側削除と、削除用Cookieにも発行時と同じ安全属性を付けることです。

### 中: WebAuthnチャレンジの取得と削除が原子的ではない

チャレンジ消費は`SELECT`と`DELETE`という別々の操作です。[webauthn.ts](/home/y-tamura/workspace/kintai-note/server/utils/webauthn.ts:27)

同じCookieを持つ並行リクエストがSELECTを通過してからDELETEされると、同じチャレンジを複数の検証処理が利用できます。WebAuthn署名とカウンタ検証が別にあるため、直ちに認証突破を意味するものではありませんが、ワンタイムチャレンジの要件を満たしていません。

取得と削除を単一の条件付きDB操作にまとめ、削除できた行だけを有効なチャレンジとして扱うべきです。

### 中: 初期管理者作成に並行実行の競合がある

初期ユーザーが0人であることをSELECTで確認してから、別のINSERTを実行しています。[bootstrap.post.ts](/home/y-tamura/workspace/kintai-note/server/api/admin/bootstrap.post.ts:11)

同じ`BOOTSTRAP_TOKEN`を使った並行リクエストがあると、複数の管理者を作成できる可能性があります。通常は初期セットアップ時だけの問題ですが、初期状態の一意性をDBまたは単一トランザクションで保証すべきです。

### 中: 認証・初期設定エンドポイントにアプリ側のレート制限がない

ログインオプション、招待トークン検証、初期管理者セットアップなどに明示的なレート制限がありません。ログインオプション生成のたびに5分間有効な行が`auth_challenges`へ追加され、期限切れ行はログイン成功時の処理でしかまとめて削除されません。[webauthn.ts](/home/y-tamura/workspace/kintai-note/server/utils/webauthn.ts:19)

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

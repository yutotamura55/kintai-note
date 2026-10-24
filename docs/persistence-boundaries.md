# 永続化処理の境界と段階的な移行方針

2026-10-24 時点の Issue #11 の設計判断。対象読者は、このリポジトリの API や認証処理を変更する開発者。現在の本番構成は Cloudflare Workers + D1 であり、この文書を読んだ後、どの処理をどの境界へ移し、何を検証してから次へ進むか判断できるようにする。これは移行方針であり、別データベースへの切替決定ではない。

## 利用者の操作から見た境界

勤務中の利用者が「休憩開始」を押すと、API はセッションを確認して打刻要求を読み取る。打刻処理は、指定された勤務記録がその利用者の**最も古い未退勤記録**で、まだ休憩中でない場合にだけ更新する。更新が確定すれば API は `{ ok: true }` を返し、競合などで更新できなければ現在の 409 応答を返す。この条件判定と更新は同じ SQL 文に残す。事前の読み取り結果だけで更新可否を決めると、同時リクエストで条件が変わり得るためである。現行の実装は `server/api/attendance/clock.post.ts` → `server/utils/attendance-punch.ts` にある。

この例では、**Application service（アプリケーションサービス）**が打刻という操作の順序と結果を担当し、**Repository（リポジトリ、永続化境界）**が D1 上で条件付き更新を実行する。API ハンドラーは HTTP の認証・入力・応答、D1 実装は SQL と D1 の結果形式を担当する。英語名は以降のインターフェース名と対応させる。

## 現状と対象範囲

`server/utils/db.ts` はリクエストから `DB` binding を取得するが、SQL の所有者は分散している。以下は `server/` の呼び出しを確認した結果である。

| 領域 | 現在の主な場所 | 保護すべき条件 |
| --- | --- | --- |
| 勤怠の打刻 | `attendance-punch.ts` | 二重出勤の拒否、最古の未退勤記録、休憩中の退勤拒否、初回打刻時刻の保持 |
| 勤怠の編集・復元・参照 | `attendance.ts`、`attendance/*.ts`、`reports/month.pdf.get.ts` | 利用者本人の記録だけを操作、初回値と編集値の区別、日跨ぎ勤務と勤務日の維持 |
| セッション・試行制限 | `auth.ts`、`auth-storage.ts` | 有効な利用者だけを認証、試行回数を原子的に更新、ログアウト後の再利用拒否 |
| 招待・パスキー | `webauthn.ts`、`invitation.ts`、`auth-storage.ts`、`admin/*.ts` | challenge の一度限りの消費、招待の一度限りの使用、利用者有効化との整合性 |

`server/utils/invitation.ts` は D1 の `batch()` と各文の条件を組み合わせて招待使用・パスキー追加・利用者有効化を扱う。D1 の `batch()` は複数文を順次実行するトランザクションで、文が失敗すれば全体をロールバックする。ただし、**条件に合わず更新件数が 0 の文は SQL エラーではない**。現行コードは全て 1 件更新したかを検査するため、移行時も「トランザクションで実行した」だけを成功条件にしない。[D1 `batch()` の仕様](https://developers.cloudflare.com/d1/worker-api/d1-database/)。

## 選択肢と決定

| 方針 | 要件適合・変更容易性 | 性能・費用 | 整合性・安全性 | 判断 |
| --- | --- | --- | --- | --- |
| A. 現状を維持 | 現在の D1 運用には最も単純。DB 変更時は各 API を横断する | 追加の層や呼び出しはない | 既存の条件付き SQL をそのまま保てる | 当面の基準線 |
| B. 操作単位の小さな境界を必要な箇所から導入 | HTTP、操作の順序、DB 固有の更新を分離できる。移行単位を独立してレビューできる | 同じ SQL とクエリ回数を保てば追加の DB 費用はない。実測で確認する | 条件付き更新と招待の複数文処理を Repository 側に残せる | **採用** |
| C. 全テーブルに汎用 CRUD Repository を一括導入 | 未使用メソッドや DB 差分の吸収が先行し、変更点が広い | 呼び出し数の増加や大きな依存追加を見落としやすい | 一つの原子的操作が複数の CRUD 呼び出しへ割れる危険がある | 現時点では採用しない |

方針 B は、別 DB 対応のための汎用 SQL 実行インターフェースを先に作る意味ではない。D1 を使い続ける間も、同じ操作の修正時に SQL と HTTP の関心が混ざらないことを主な効果とする。利用者に見える勤怠・認証の状態と Repository の操作単位を一致させる。

## 責務とインターフェース案

最初は打刻の経路に必要なメソッドだけを導入する。以下は契約案であり、この Issue では TypeScript ファイルを追加しない。各業務の移行時にその業務で使うメソッドだけを定義し、巨大な共通インターフェースにはしない。

```ts
type PunchCommand =
  | { userId: string; action: 'in'; atIso: string; workDate: string }
  | { userId: string; action: 'out' | 'break_start' | 'break_end'; atIso: string; recordId: string }
type SaveTimesCommand = {
  userId: string
  recordId: string
  expectedClockInAt: string | null
  expectedClockOutAt: string | null
  clockInAt: string
  clockOutAt: string | null
  breakMinutes: number | null
}
type ChallengeInput = {
  id: string
  challenge: string
  purpose: 'login' | 'register'
  userId: string | null
  invitationId: string | null
  expiresAt: string
}

interface AttendanceRepository {
  findOldestOpen(userId: string): Promise<AttendanceRecord | null>
  findOwned(userId: string, recordId: string): Promise<AttendanceRecord | null>
  applyPunch(command: PunchCommand): Promise<'applied' | 'unchanged'>
  saveTimes(command: SaveTimesCommand): Promise<'saved' | 'conflict'>
  findForWorkDate(userId: string, workDate: string): Promise<AttendanceRecord | null>
  listForMonth(userId: string, month: string): Promise<AttendanceRecord[]>
}

interface AuthRepository {
  findActiveSessionUser(sessionId: string, now: string): Promise<User | null>
  createSession(sessionId: string, userId: string, expiresAt: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  consumeAttempt(key: string, now: string, resetAt: string, limit: number): Promise<boolean>
  saveChallenge(challenge: ChallengeInput): Promise<void>
  consumeChallenge(id: string, purpose: 'login' | 'register', now: string): Promise<ChallengeInput | null>
  completeInvitation(passkey: InvitationPasskey): Promise<boolean>
}
```

`saveTimes` は現在の `saveAttendanceTimes` と同じ出退勤時刻の旧値比較で競合を検出する。休憩時間だけの同時編集は現在の比較対象に含まれず、最後の書き込みが残り得る。この条件を変えるなら、期待する旧休憩値または版番号を追加する別の仕様変更として扱う。`AttendanceRecord` は `shared/utils/attendance.ts`、`User` は `server/utils/types.ts` の既存の型を使う。Repository は D1 の行を既存の API 用 `AttendanceRecord` へ変換し、API の項目名を維持する。`ChallengeInput` は移行時に認証側へ定義し、`InvitationPasskey` は現行の `server/utils/invitation.ts` にある利用者・招待・パスキーの ID、認証鍵、カウンター、端末情報、登録時刻を持つ型である。

Application service は受け取った時刻から日本時間の勤務日と ISO 時刻を一度だけ決め、`PunchCommand` に渡す。休憩開始・終了で ID が省略された場合は、最古の未退勤記録を読み取って ID を補完する。退勤では現行どおり ID を必須とする。`applyPunch` の `unchanged` は「書き込みが成立しなかった」だけを表す。現在の打刻失敗メッセージは、対象 ID の有無、休憩状態、未退勤記録の有無なども使って決まる。Application service は必要なら失敗**後**に状態を読み、HTTP 層が既存の 400/409 と日本語メッセージへ変換する。表示や対象 ID の補完のために書き込み前に読む場合も、その結果を更新可否の根拠にせず、条件付き SQL で再確認する。競合後の診断結果は更新の成否を覆さない。Repository に H3 の `event`、HTTP ステータス、`createError` を渡さず、Application service に SQL、`D1Result`、`meta.changes` を渡さない。`applyPunch` 内では、最古の未退勤記録の選択と更新を必ず一文の条件付き SQL で行い、読み取り後の無条件更新へ置き換えない。`findOldestOpen` は画面表示と対象 ID の補完に使う読み取りであり、書き込みのガードにはしない。

AuthRepository のメソッドも一括実装しない。上の契約に含まれないパスキー検索・カウンター更新、招待検索・作成、初回管理者作成は、それぞれの経路を移す段階で操作単位のメソッドを追加する。`consumeAttempt` の `true` は許容範囲内、`false` は上限超過を表す。`saveChallenge` は現行と同じく期限切れの challenge を最大 100 件削除して新しい ID の challenge を保存する。同じ利用者・目的の古い未期限切れ challenge を無効化する操作ではない。パスキーの暗号学的検証、Cookie の設定、レート制限時の HTTP 応答は認証側の Application service / HTTP 側に残す。`completeInvitation` は招待・パスキー・利用者状態を一つの永続化操作として扱う。PostgreSQL 実装を作る場合は、D1 の `batch()` と同じ成功条件を明示したトランザクションで再現する。初回管理者作成の「利用者が 0 人なら作成」も単なる事前確認へ分割しない。

## 段階的な導入と各段階の完了確認

1. **基準線を固定する。** 現行の `npm run test:local` で単体テスト、Nuxt ビルド、ローカル Worker + D1 の認証・勤怠統合テストを確認する。API の JSON 形状、400/401/403/404/409、初回時刻・招待・challenge の一度限りの条件を移行前後で比較する。未網羅の競合操作は移行する経路ごとにテストを追加する。
2. **打刻を最初の縦断面にする。** `server/utils/attendance-punch.ts` の D1 文を D1 版 AttendanceRepository の打刻操作へ移し、打刻順序と失敗理由の判断を Application service に置く。`clock.post.ts` は認証、入力、HTTP 応答のみ。既存の SQL 文とクエリ回数を比較し、同時出勤、古い未退勤記録、休憩の連打、別利用者の記録 ID を指定した拒否、失敗時の無更新をローカル Worker + D1 で確認する。ここで境界が読みやすさやテストの切り分けに寄与しなければ拡大しない。
3. **勤怠の編集と読み取りを移す。** `attendance.ts` の保存処理、`today` / `month` / PDF の読み取りを、必要なメソッドから追加する。編集前後の初回値、日跨ぎ勤務、休憩計算、本人以外の記録 ID の拒否、PDF の値を確認する。PDF 描画と日付表示は Repository に入れない。
4. **認証を経路ごとに移す。** セッション → challenge / 試行制限 → 招待 / パスキーの順に、`auth-storage.ts` と `invitation.ts` の SQL を D1 実装に集める。Cookie と WebAuthn 検証は外に残す。challenge の再使用、招待の同時使用、初回管理者作成の競合、ログアウト後のセッション拒否を確認する。最後に `rg -n 'db\(event\)|\.prepare\(|\.batch\(|D1Database|\.env\.DB' server/api server/utils` で残存する D1 呼び出しを棚卸しし、例外を明記する。
5. **別 DB が必要になった時だけ実装する。** PostgreSQL の接続方法、DDL、データ移行、ロールバック、運用費用を別作業で設計する。D1 用の統合テストを PostgreSQL 接続版でも実行し、さらに同時打刻・招待の同時使用を PostgreSQL 上で検証してから切り替える。二重書き込みや本番 DB 切替は、この文書だけを根拠に実施しない。

Issue #11 はこの設計方針と検証条件の決定で完了する。段階 2〜4 の実装は Issue #4 で追跡し、各段階を独立した PR で検証する。まず段階 2 の打刻を対象とし、その結果から段階 3・4 を実施する価値を判断する。境界を増やしても読みやすさや変更容易性が改善しなければ、未実施の理由を Issue #4 に記録して移行を止める。別 DB への切替は Issue #4 に含めない。

## 実施状況（2026-10-25）

段階 2〜4 は Issue #4 の次の PR で実施した。どの PR も、移動前と同じ SQL・クエリ回数・HTTP 応答を保っている。

| 段階 | PR | 移したもの |
| --- | --- | --- |
| 2. 打刻 | #36 | 出勤・休憩・退勤の条件付き書き込み（`AttendanceRepository.applyPunch`）と、打刻の手順（`attendance-punch.ts`） |
| 3. 勤怠の編集・復元 | #37 | 出退勤時刻の保存（`AttendanceRepository.saveTimes`）と、編集・復元の手順（`attendance-edit.ts`） |
| 4 の前提 | #38 | パスキーの登録・ログインが成功する経路の画面テスト（`scripts/test-passkey-flow.mjs`） |
| 4. セッション | #39 | セッションの取得・作成・削除（`AuthRepository`） |
| 4. challenge・試行制限 | #40 | challenge の保存・一度限りの消費、試行回数の更新 |
| 4. 招待・パスキー | この節を追加した PR | パスキーの検索・使用記録・一覧・追加、招待の作成・検索・使用、初回管理者の作成と、その前の利用者一覧 |

設計案から変えた点：

- `findActiveSessionUser` は `findSessionUser` にした。利用者が `active` かどうかは、Repository ではなく `auth.ts` が判定するため。
- `SaveTimesCommand` と `saveChallenge` には、`updated_at` や期限切れの判定に使う現在時刻を加えた。時刻は呼び出し側が決める。
- 勤怠の失敗理由は、Application service がコードで返し、HTTP 層が既存の 400 / 404 / 409 と日本語メッセージに変換する（`clock.post.ts`、`attendance-edit-errors.ts`）。認証は手順と呼べる処理が少ないため、Application service を作らず、`auth.ts` と `webauthn.ts` が Cookie・時刻・WebAuthn の検証・HTTP エラーを受け持つ。

`rg -n 'db\(event\)|\.prepare\(|\.batch\(|D1Database|\.env\.DB' server/api server/utils` で棚卸しすると、Repository の D1 実装（`attendance-repository.ts`、`auth-repository.ts`）の外に SQL が残るのは次の読み取りだけである。どれも 1 文の SELECT を一か所で使うだけで、移しても関数が 1 段増えるだけなので、意図して残した（段階 3 の判断。Issue #4 のコメントに記録）。

| 場所 | 読み取るもの |
| --- | --- |
| `server/api/attendance/today.get.ts` | 今日の勤務記録 |
| `server/api/attendance/month.get.ts` | 月別の勤務記録 |
| `server/api/reports/month.pdf.get.ts` | 月別 PDF の勤務記録 |
| `server/utils/attendance.ts` の `openAttendance` | 最も古い未退勤記録。`today.get.ts` と `AttendanceRepository.findOldestOpen` が使う |

別の DB へ移す場合は、この 4 か所も Repository の読み取りメソッドに移す。

## 実行環境と費用の判断

- **現行 Workers + D1:** D1 は Worker の binding から利用できる。`prepare()` / `batch()` を D1 実装内で使い続ける。Repository を作るだけでクエリ数が減るわけではないため、移行前後で各操作の D1 呼び出し数、`meta.rows_read` / `rows_written`、Worker の CPU・バンドルサイズを比較する。D1 の課金指標は読み書き行数とストレージであり、数値の増減は実測する。[D1 binding](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[D1 の計測指標](https://developers.cloudflare.com/d1/platform/pricing/)、[Workers のバンドル制限](https://developers.cloudflare.com/workers/platform/limits/)。
- **Workers + PostgreSQL の候補:** DB 接続をリクエスト内で作る構成を検討し、接続プールと遅延には Hyperdrive を候補にする。Workers 上のグローバルな DB クライアント共有は採用しない。ドライバーの Worker 対応、バンドル、SQL 方言とトランザクションの違いを実装前に小さな検証で確かめる。[Hyperdrive の接続ライフサイクル](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/)、[PostgreSQL 接続例](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)。
- **Lambda + PostgreSQL の候補:** Lambda は実行環境の再利用時に接続を再利用できるが、再利用は保証されず、アイドル接続の切断も考慮する。Worker 用の接続管理をそのまま移植しない。Lambda 自体への移設、認証・静的資産・PDF の実行環境は別途検証する。[AWS Lambda のベストプラクティス](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)。

このリポジトリには PostgreSQL / Lambda の実装や測定値がない。したがって「将来の移行が簡単になる」「費用が下がる」という効果は現時点では確定しない。D1 の継続を前提に、変更が繰り返される操作の責務を先に明確にする。

## 導入しない範囲と再検討の条件

この Issue では、DB の切替、全テーブル一括移行、汎用 CRUD、ORM、DI コンテナ、複数 DB への同時書き込み、新しい本番 binding を導入しない。新しい依存関係も追加しない。各操作で D1 とアプリケーションの責務が明確で、変更が一箇所で完結するなら、インターフェースを増やさない。

別 DB の採用が具体化した場合、または同じ業務条件の修正が HTTP と複数の D1 呼び出し箇所に繰り返し必要になった場合に、次の境界を導入する。判断では、要件との適合、利用者の操作とデータ状態の一致、クエリ数・費用、競合時の整合性、安全性、初見の開発者が追える変更範囲を確認する。

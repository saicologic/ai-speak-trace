# AI Speak Trace

音声データを話者分離し、文字起こしを行うデスクトップアプリケーション。

## プロジェクト概要

- 1つの音声ファイルに含まれる2人の会話を話者分離し、日本語で文字起こしする
- macOS Podcastアプリの音声も文字起こし可能
- アプリ上で文字起こし結果を確認・選択できる
- キーワード抽出・要約・会話分析・発言の文脈・ディープサーチで会話内容を深掘りできる
- Claude に送る前に、Amazon Bedrock Guardrails で会話の個人情報を検出して伏せる

## 技術スタック

- **デスクトップ**: Tauri v2（Rust + WebView）
- **言語**: TypeScript（フロントエンド・バックエンド共通）
- **フロントエンド**: Vite + React
- **バックエンド**: NestJS（sidecarバイナリとしてバンドル）
- **AI / 音声**: ElevenLabs Scribe v2（Speech-to-Text）
- **AI / 分析**: Claude API（Anthropic）
- **個人情報・プロンプト攻撃の検出**: Amazon Bedrock Guardrails
- **バイナリ化**: @yao-pkg/pkg
- **開発環境**: Claude Code

## ディレクトリ構成

```
ai-speak-trace/
├── CLAUDE.md
├── package.json           # Tauri CLIスクリプト
├── src-tauri/             # Tauri（Rust）
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/      # パーミッション設定
│   ├── src/               # Rust sidecar管理コード
│   ├── binaries/          # NestJSバイナリ（ビルド時に生成）
│   └── icons/             # アプリアイコン
├── docs/
│   ├── users/             # 利用者向けのドキュメント（初期設定・使い方・トラブルシューティング）
│   └── developers/        # 開発者向けのドキュメント
├── frontend/              # フロントエンド（Vite + React）
└── backend/               # バックエンド API（NestJS）
    └── data/
        ├── audio/                # 音声ファイルの配置先
        └── transcriptions/       # 文字起こし結果の保存先
```

## 機能要件

### 1. 話者分離と文字起こし

- 音声ファイルをアプリ内でアップロードまたは選択して文字起こしする
- ElevenLabs Scribe v2 APIを使用
- 話者分離（Speaker Diarization）を行う
- 話者名はデフォルトで「Aさん」「Bさん」とする
- 話者名は後から編集可能にする

### 2. Podcast文字起こし

- ファイルを選ぶ画面を、macOS Podcastアプリのキャッシュフォルダで開く
- Podcast音声をそのまま文字起こし可能

### 3. 文字起こし結果の閲覧

- アプリ上で文字起こし結果を閲覧できる
- 単語のハイライト・選択ができる
- 文章の選択ができる
- 文章を選択すると、誰が話したかわかる

### 4. キーワード抽出 & フィルター

- 文字起こしテキストから専門用語・固有名詞を自動抽出
- キーワードのハイライト表示
- 選択したキーワードで発話を絞り込むフィルター機能

### 5. 要約（Claude API）

- 概要・キーポイント・決定事項の指示を編集して、会話を要約する

### 6. 会話分析（Claude API + Web検索）

- 話者ごとのキーワードを自動抽出
- 選択したキーワードからClaude APIで調査質問を自動生成
- Web検索付きの分析レポートを生成

### 7. 発言の文脈（Claude API）

- 選んだ複数の発言の意図・トピックを分析する

### 8. ディープサーチ

- 選んだ会話からキーワードを提案し、Web検索で調査
- 調査結果をClaudeで統合分析
- 根拠を確認できなかった文は表示から除く（詳細は `docs/developers/deep-search.md`）

### 9. 個人情報チェック（Amazon Bedrock Guardrails）

- 会話の個人情報を検出し、Claude に送る前に伏せる
- Claude への送受信を確認し、プロンプト攻撃や個人情報を含む場合は送らない・使わない

## 前提条件

- 文字起こしは日本語
- 音声ファイルはアプリ内でアップロードする（ファイルを選ぶ画面は macOS Podcastキャッシュで開く）
- デスクトップアプリのデータは `~/Library/Application Support/io.github.saicologic.ai-speak-trace/data/` に保存

## 開発ルール

- コードおよびコメントは日本語で記述する
- コミットメッセージは日本語で記述する
- mainブランチはブランチ保護（PR必須）が有効。直接プッシュ不可
- main以外のブランチ（release/*, fix/* など）は直接プッシュ可能。ただし Claude Code が `github.sh` で push できるのは `fix/*`・`feature/*`・`test/*` だけ（`release/*` はユーザーが push する）
- ブランチが保護されていてプッシュできない場合、新しいブランチを作成せず、ユーザーに報告する

### テスト駆動開発（TDD）

コードを変えるときは、テストを先に書いてから実装する。

1. **Red**: 直したい動き・足したい動きをテストに書き、実装する前に流して、期待どおりの理由で失敗することを確かめる（失敗した出力を報告に載せる）
2. **Green**: テストが通る最小限の実装を書き、流して通ることを確かめる
3. **Refactor**: テストが通ったまま、書き方を整える

- 始める前に、確かめたい場面（正しい入力・境界・エラー）の一覧を書き、1つずつテストにする（全部のテストを先にまとめて書かない）
- テストを先にコミットし、実装を後からコミットする（PR の履歴で、テストが先だったことが分かるようにする）
- コミットメッセージの頭で、コミットの種類を分ける: テストは `test:`、動きを変える実装は `fix:`・`feat:`、動きを変えない書き換えは `refactor:`・`style:`。動きを変える変更と変えない変更を、同じコミットに混ぜない
- Green では、テストを変えない。テストを直す必要が出たら、`test:` のコミットで直す（アサーションを消して通したり、実際に出た値を期待する値に貼り付けたりしない）
- テストのファイルの移動・分割も、`test:` のコミットでする（CI の `TDD` は、`test:` 以外のコミットで、テストのファイルごとに `expect(` が減っていないかを確かめるため）
- 動きを変えない書き換え（名前の変更・関数の切り出しなど）は、新しいテストを先に書かなくてよい。今あるテストが書き換えの前後で通ることを確かめ、報告に載せる。今あるテストがその動きを確かめていないときは、先にテストを足してから書き換える
- バグの修正では、まずバグを再現して失敗するテストを書く
- 実装のコミットの後、push する前に、`test-reviewer` サブエージェント（`.claude/agents/test-reviewer.md`）に、変えたファイルと確かめたい場面の一覧を渡して確かめてもらう
- 画面の見た目・CSP・外部 API につないだときの動きなど、自動テストで確かめにくいものは、実装の前に何を確かめるかを書き出し、PR の「## 手動確認項目」（または「## 自動テスト項目」）に入れる
- ドキュメント・設定だけの変更など、確かめる動きがないものは対象外

次の仕組みで、この決まりを確かめる。

- **CI の `TDD`**（`.github/workflows/tdd.yml`・`.github/scripts/check-tdd-order.sh`）: `main`・`release/*` 宛ての PR で、コミットを古い順に調べ、実装のファイル（`backend/src` の `.spec.ts` 以外・`frontend/src` の `.test.ts(x)` 以外・`backend/scripts/`）を変えたコミットより前にテストのファイルを変えたコミットがあるか、`test:` 以外のコミットでテストの `expect(` を減らしていないかを確かめる。`refactor:`・`style:` のコミットと、マージで入ったコミットは、順番の確認の対象外。テストを書けない変更だけの PR は、`no-tdd` のラベルを付けて飛ばす
  - その実装を参照している（import している・パスを書いている）テストがすでにあるときは、そのテストのどれかを、実装と同じかそれより前のコミットで変える必要がある（ほかのテストを変えただけでは通らない）。参照しているテストは `.github/scripts/related-tests.mjs` で探す
  - まだテストのない実装は、PR の中でそれより前にどれかのテストを変えていれば通る。テストが実装の動きを確かめているかは、`test-reviewer` とレビューで確かめる
- **push の前の確認**（`.claude/team/bin/tdd-push-gate.sh`）: Claude Code が `github.sh` で push するときに、PR の宛先と比べて同じ確認を手元で流し、通らなければ止める。PR がまだないときは止めない（CI で確かめる）。急ぎのときは、ユーザーの了承を得て `github.sh` に `--skip SKIP_TDD_CHECK` を付ける
  - サンドボックスの外で動くため、`install.sh` が `/opt/claude-code-team/bin/ci` に入れた `.github/scripts` を使う（作業ツリーのものは動かさない）。`.github/scripts` を変えたら、マージの後に、`docs/developers/claude-code-sandbox.md` の手順（GitHub から取った `install.sh`）でもう一度入れる
- **lint**（CI の `backend-test`・`frontend-test` で流す）: テストのファイルで、`.skip`・`.only`・`xit` などのテストを外す書き方を止める。OS などの理由で外すときは、`eslint-disable-next-line` に理由を書く

## ブランチ管理とリリースポリシー

### ブランチ命名規則

| ブランチ名 | 用途 |
|-----------|------|
| `release/vX.Y.Z` | バージョンアップ・リリース |
| `fix/*` | バグ修正・セキュリティパッチ |
| `feature/*` | 新機能追加 |

### セキュリティパッチのリリース方針

- セキュリティパッチは必ずバージョンを上げてリリースする
- DMGファイルはビルド時の依存関係が焼き込まれるため、パッチ適用済みバージョンを配布しないとユーザーが脆弱なバイナリを使い続けることになる
- パッチリリースはパッチバージョン（X.Y.**Z**）を上げる（例: v0.5.7 → v0.5.8）
- セキュリティ対応はパッチリリース（例: v0.8.x）に、新機能はマイナーリリース（例: v0.9.0）に分ける
- セキュリティ対応の `fix/*` は、出ている中で一番新しいパッチの `release/vX.Y.Z` から作る。新機能の `release/*` から作らない（新機能のバージョン更新などが混ざり、パッチリリースに入れられなくなる）
- パッチリリースを `main` にマージしたら、新機能の `release/*` から `fix/sync-main-into-release-vX.Y.Z` を作って `main` をマージし、新機能の `release/*` へPRを作る（`tauri.conf.json` のバージョンは新機能の側を残す）

### リリース手順

1. `fix/*` または `feature/*` ブランチで修正・実装する
2. `main` から `release/vX.Y.Z` ブランチを作成し `src-tauri/tauri.conf.json` のバージョンを更新（`main` にはリリース済みの内容だけがあるため、パッチリリースもマイナーリリースも `main` から作る）
3. `fix/*` または `feature/*` → `release/vX.Y.Z` へPR作成・マージ（新機能の `feature/*` は新機能の `release/*` へ）
4. `release/vX.Y.Z` → `main` へPR作成・マージ（PRタイトルは `release: vX.Y.Z`、本文に `## Summary` または `## 変更内容` を書く。リリースノートに使われる）
5. タグ自動作成・CI自動ビルド・DMG自動アップロードが実行される
   - `tag-release.yml` がマージコミットに `vX.Y.Z` タグを作成し、`release.yml` を起動する
   - ブランチ名（`release/vX.Y.Z`）と `tauri.conf.json` のバージョンが一致しない場合、タグは作成されない

`fix/*`・`feature/*` を直接 `main` にマージしない（`release/*` から作成したブランチも同様。PRの宛先が `release/vX.Y.Z` になっていることをマージ前に確認する）。DMGはビルド時に依存関係が焼き込まれるため、必ず `release/*` 経由でバージョン付きリリースとセットにする。

ただし、ビルドに影響しないファイル（Markdownファイル・`docs/` 等。下の「ビルド対象ファイルの管理」のビルド不要なファイル）だけを変える場合は、`main` へ直接PRを作ってよい。DMGの中身が変わらないため、`release/*` を経由させると中身が同じリリースが増えるだけになる。ビルドが必要なファイルを1つでも含む場合は、この例外を使わない。

`release/*` ブランチには直接コミットしない。必ず `fix/*` または `feature/*` ブランチを作成してPR経由でマージする。

## CIワークフロー管理

### ビルド対象ファイルの管理

`build.yml`（`main`・`release/*` 宛ての PR）と `test.yml`（`main` 宛ての PR）は、PR のたびに実行し、最初の `changes` ジョブで変更したファイルを調べて、必要なときだけビルド・テストする。必須チェック（`build`・`backend-test`・`frontend-test`）は、不要なときも成功として報告する。`release/*` 宛ての PR では、`test.yml` は PR では動かず、`backend/`・`frontend/`・`.nvmrc`・`.claude/team/`・`.claude/settings.json`・`.github/scripts/` を変えた push のときに動く。

- **ビルド不要なファイル**: `build.yml` の `changes` ジョブの一覧（Markdownファイル・`docs/`・`.github/`・`.claude/`・テストのファイル（`backend/src` の `.spec.ts`・`frontend/src` の `.test.ts(x)`）等）。これらのファイルだけを変えた PR では、macOS のビルドをしない
- **テスト不要なファイル**: `backend/`・`frontend/`・`.nvmrc`・`.claude/team/`・`.claude/settings.json`・`.github/scripts/` 以外のファイルと、Markdownファイル（`.claude/team/`・`.claude/settings.json`・`.github/scripts/` は `backend/src/lint` のテストが確かめるため、`backend-test` を動かす）
- 一覧にないファイルはビルドする。ビルド不要なファイルを新しく足す場合だけ、`changes` ジョブの一覧に足す

必須チェックのワークフローに `paths` を付けない。`paths` で飛ばすと、必須チェックが pending のままになり PR がマージできなくなる。

## ブラウザ操作（Claude Code）

ブラウザでの確認は、新しく足した機能を localhost の開発用の画面で見ることだけにし、Playwright MCP で行う。Claude in Chrome（普段のログイン中の Chrome を操作する）は使わない（managed-mcp.json で止まる）。

- Playwright MCP は、managed-mcp.json（`.claude/team/managed-mcp.json` を `install.sh` で入れたもの）から `/opt/claude-code-team/bin/playwright-mcp.sh` 経由で起動し、普段使いの Google Chrome とは別アプリの「Google Chrome for Testing」を使う
- Playwright MCP のブラウザは、localhost・127.0.0.1 にしかつながらない（つながらないプロキシを通し、localhost・127.0.0.1 だけを例外にしている）。外のサイト・公開ページは開けない。サーバーは開発者が `npm run dev` で起動しておく
- Playwright MCP はプロフィールを保存しない（`--isolated`）。ログイン状態は引き継がれない
- Playwright MCP での作業が終わったら `browser_close` でブラウザを閉じる

## CodeRabbit の枠切れ（Claude Code）

- CodeRabbit の枠切れの間は、レビューを動かす操作をしない。枠切れのまま投稿すると、レビューされないまま CodeRabbit のチェックが通ってしまうため
- `.claude/team/bin/cr-limit-gate.sh`（managed settings の hook と、`github.sh` が書き込む前の確認）が、`gh pr comment`（`@coderabbitai`）・`gh pr create`・`gh pr ready`・`git push`（`github.sh` が流すものを含む）と手元レビューの `cr-review.sh` を、枠が戻る時刻まで止めて通知する
- 戻る時刻は、直近の CodeRabbit のコメント（「Next included review available in N minutes」）と、`cr-review.sh` が記録した時刻から求める。調べられないときは止めない
- 急ぎで通すときは、ユーザーの了承を得てコマンドに `SKIP_CR_LIMIT=1` を付ける（`github.sh` では `--skip SKIP_CR_LIMIT`）

## サンドボックスと GitHub への操作（Claude Code）

- Claude Code の設定は、個人の設定ではなく、チームで共通の managed settings（`.claude/team/managed-settings.json`）と `.claude/settings.json` を使う。各開発者は、`docs/developers/claude-code-sandbox.md` の手順で、GitHub から取った `install.sh` をターミナルで実行して入れる（作業ツリーの `install.sh` を `sudo` で動かさない。Claude Code には実行させない）
- Bash はサンドボックスの中で動き、GitHub には届かない。push・PR・Issue の操作は、`/opt/claude-code-team/bin/github.sh` で行う。先頭に環境変数の代入・`cd`・リダイレクト・`$( )` を付けない（付けるとサンドボックスの中で動く）
  - push できるのは `fix/*`・`feature/*`・`test/*` だけ。PR は `--draft` だけ。本文は `--body-file` で渡す
- Claude Code はサンドボックスの中で、lint・テスト・ビルドを行う。`npm ci`・`npm install` とサーバーの起動（`npm run dev`）は、開発者が自分のターミナルで行う（`docs/developers/claude-code-sandbox.md` の「サンドボックスの中での開発」）。画面の確認は、開発者が起動したサーバーを Playwright MCP で開く
- 動かす MCP サーバーは managed-mcp.json で Playwright MCP だけに決める（プロジェクトの `.mcp.json`・プラグイン・claude.ai のコネクタ・Claude in Chrome は動かない）。開発はターミナルの Claude Code（CLI）で行う（Claude のデスクトップアプリのセッションでは、デスクトップアプリが渡すコネクタが managed-mcp.json で止まらないため、対象外にする）
- 手元の CodeRabbit レビューは `/opt/claude-code-team/bin/cr-review.sh`、PR の監視は `/opt/claude-code-team/bin/wait-pr-checks.sh` で行う（cr-loop Skill）
- サンドボックスの外で動くものは、`/opt/claude-code-team`（root の持ち物）に入れたものだけにする。hook もサンドボックスの外で動くため、リポジトリの `.claude/settings.json` には hook を書かず、managed settings からインストール先のものだけを動かす（作業ツリーのファイルは、サンドボックスの中から書き換えられるため）。`install.sh` も、インストーラーそのものと入れるものの両方を、作業ツリーではなく GitHub のブランチのコミットから取る
- 設定・スクリプトを変えるときは `.claude/team/` を変え、`.claude/team/tests/` のテスト（`backend/src/lint/claude-team-tools.spec.ts` から流す）を通す。サンドボックスを弱める変更（サンドボックスを切る・通信先を広げる・外で動かすものを増やす）は、理由を PR に書く

## PRの手動確認項目

CIの結果（`build`・`backend-test`・`frontend-test`・`tdd-order`）はPRのチェック欄と必須チェックで確認するため、PR本文には書かない。コードレビューはCodeRabbitが行う。

PR本文には、CIとコードレビューでは確認できない動作がある場合のみ「## 手動確認項目」を書く。例：

- 外部API（ElevenLabs・Claude・Amazon Bedrock Guardrails）につないだときの動作
- Tauriのデスクトップアプリとして起動したときの動作（sidecar・DMG）
- 画面の表示やユーザー操作

書く項目はすべて必須とし、「任意」「オプション」と記載しない。確認する必要がない場合はセクションごと省略する。

AI（Claude Code）で確かめられる項目は、「## 手動確認項目」ではなく「## 自動テスト項目」に書く。「自動テストで行えます」と書き、確かめる内容を含めた AI への依頼文だけを書く。書き方は `docs/developers/ai-testing.md`（AI に動作確認を頼む）に従う。

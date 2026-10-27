# AI Speak Trace

音声データを話者分離し、文字起こしを行うデスクトップアプリケーション。

## プロジェクト概要

- 1つの音声ファイルに含まれる2人の会話を話者分離し、日本語で文字起こしする
- macOS Podcastアプリの音声も文字起こし可能
- アプリ上で文字起こし結果を確認・選択できる
- キーワード抽出・会話分析・ディープサーチで会話内容を深掘りできる

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

- macOS Podcastアプリのキャッシュから音声ファイルを自動検出
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

### 5. 会話分析（Claude API + Web検索）

- 話者ごとのキーワードを自動抽出
- 選択したキーワードからClaude APIで調査質問を自動生成
- Web検索付きの分析レポートを生成

### 6. ディープサーチ

- 選んだ会話からキーワードを提案し、Web検索で調査
- 調査結果をClaudeで統合分析

## 前提条件

- 文字起こしは日本語
- 音声ファイルはアプリ内でアップロード、または macOS Podcastキャッシュから検出
- デスクトップアプリのデータは `~/Library/Application Support/io.github.saicologic.ai-speak-trace/data/` に保存

## 開発ルール

- コードおよびコメントは日本語で記述する
- コミットメッセージは日本語で記述する
- mainブランチはブランチ保護（PR必須）が有効。直接プッシュ不可
- main以外のブランチ（release/*, fix/* など）は直接プッシュ可能
- ブランチが保護されていてプッシュできない場合、新しいブランチを作成せず、ユーザーに報告する

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

`release/*` ブランチには直接コミットしない。必ず `fix/*` または `feature/*` ブランチを作成してPR経由でマージする。

## CIワークフロー管理

### ビルド対象ファイルの管理

`build.yml` と `test.yml` は PR のたびに実行し、最初の `changes` ジョブで変更したファイルを調べて、必要なときだけビルド・テストする。必須チェック（`build`・`backend-test`・`frontend-test`）は、不要なときも成功として報告する。

- **ビルド不要なファイル**: `build.yml` の `changes` ジョブの一覧（Markdownファイル・`docs/`・`.github/`・`.claude/` 等）。これらのファイルだけを変えた PR では、macOS のビルドをしない
- **テスト不要なファイル**: `backend/`・`frontend/`・`.nvmrc` 以外のファイルと、Markdownファイル
- 一覧にないファイルはビルドする。ビルド不要なファイルを新しく足す場合だけ、`changes` ジョブの一覧に足す

必須チェックのワークフローに `paths` を付けない。`paths` で飛ばすと、必須チェックが pending のままになり PR がマージできなくなる。

## ブラウザ操作（Claude Code）

Playwright MCP と Claude in Chrome を使い分ける。

| 用途 | 使うもの |
|------|---------|
| ログインが必要なページ、ボット対策があるサイト | Claude in Chrome（`claude --chrome` で起動） |
| 自動テスト、公開ページの確認 | Playwright MCP |

- Playwright MCP は `.mcp.json` から `.claude/scripts/playwright-mcp.sh` 経由で起動し、普段使いの Google Chrome とは別アプリの「Google Chrome for Testing」を使う。同じ Google Chrome を2つ同時に起動すると Claude in Chrome 拡張機能が使えなくなることがあるため
- Playwright MCP はプロフィールを保存しない（`--isolated`）。ログイン状態は引き継がれない
- Playwright MCP での作業が終わったら `browser_close` でブラウザを閉じる

## CodeRabbit の枠切れ（Claude Code）

- CodeRabbit の枠切れの間は、レビューを動かす操作をしない。枠切れのまま投稿すると、レビューされないまま CodeRabbit のチェックが通ってしまうため
- `.claude/hooks/cr-limit-gate.sh` が、`gh pr comment`（`@coderabbitai`）・`gh pr create`・`gh pr ready`・`git push` と手元レビューの `cr-review.sh` を、枠が戻る時刻まで止めて通知する
- 戻る時刻は、直近の CodeRabbit のコメント（「Next included review available in N minutes」）と、`cr-review.sh` が記録した時刻から求める。調べられないときは止めない
- 急ぎで通すときは、ユーザーの了承を得てコマンドに `SKIP_CR_LIMIT=1` を付ける

## PRの手動確認項目

CIの結果（`build`・`backend-test`・`frontend-test`）はPRのチェック欄と必須チェックで確認するため、PR本文には書かない。コードレビューはCodeRabbitが行う。

PR本文には、CIとコードレビューでは確認できない動作がある場合のみ「## 手動確認項目」を書く。例：

- 外部API（ElevenLabs・Claude・Amazon Bedrock Guardrails）につないだときの動作
- Tauriのデスクトップアプリとして起動したときの動作（sidecar・DMG）
- 画面の表示やユーザー操作

書く項目はすべて必須とし、「任意」「オプション」と記載しない。確認する必要がない場合はセクションごと省略する。

AI（Claude Code）で確かめられる項目は、「## 手動確認項目」ではなく「## 自動テスト項目」に書く。「自動テストで行えます」と書き、確かめる内容を含めた AI への依頼文だけを書く。書き方は README.md の「AI に動作確認を頼む」に従う。

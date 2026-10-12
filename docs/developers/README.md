# 開発者ガイド

## このガイドについて

| 目的 | 方法 |
|---|---|
| 開発に参加・コントリビュートしたい | このガイドの手順に従って `npm run dev` で開発環境を構築してください |
| 個人・社内向けにカスタマイズして使いたい | [リポジトリをフォーク](https://github.com/saicologic/ai-speak-trace/fork)して、自分のApple Developer証明書とGitHub Secretsを設定してください（[コード署名の設定手順](code-signing.md)を参照） |

## 前提条件

- Node.js（`.nvmrc` で指定されたバージョン。`nvm use` で切り替え可能）
- npm
- Rust（`rustup` でインストール）
- ElevenLabs APIキー
- Anthropic APIキー

## セットアップ

### 1. 依存関係のインストール

```bash
# ルート（Tauri CLI）
npm install

# バックエンド
cd backend
npm install

# フロントエンド
cd frontend
npm install
```

### 2. APIキーの設定

APIキーはアプリ起動後、「設定」画面から設定してください。

### 3. Rustのインストール（未インストールの場合）

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

## 開発モード起動

```bash
npm run dev
```

バックエンドはOSが自動でポートを割り当てるため、ポート競合を気にせず実行できます。
Ctrl+C でまとめて停止できます。

## プロダクションビルド

```bash
npm run build
```

生成物: `src-tauri/target/release/bundle/dmg/` に `.dmg` ファイルが生成されます。

> **注意:** バックエンドバイナリ（`nestjs-server`）は `@yao-pkg/pkg` で `--no-bytecode --jitless` オプションを使ってバイナリ化します。Apple Silicon (arm64) でのOOMクラッシュ対策と、JITレスによるメモリ削減のためです。`--jitless` 環境では `globalThis.fetch` が動作しないため、外部API通信は `axios` を使用しています。

## リリースビルドの実行

GitHub Releasesで配布されるSource code (zip)からビルドして実行できます。

### 1. Source codeのダウンロード

[Releases](https://github.com/saicologic/ai-speak-trace/releases) ページから最新バージョンの「Source code (zip)」をダウンロードし、展開します。

```bash
# または GitHub CLI でダウンロード
gh release download v0.5.0 --repo saicologic/ai-speak-trace --archive zip
unzip ai-speak-trace-0.5.0.zip
cd ai-speak-trace-0.5.0
```

### 2. セットアップとビルド

```bash
# Node.jsバージョンを合わせる
nvm use

# 依存関係のインストール
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# プロダクションビルド
npm run build
```

### 3. アプリの起動

ビルド完了後、以下のいずれかの方法で起動できます。

**方法1: dmgからインストール**

```bash
open src-tauri/target/release/bundle/dmg/*.dmg
```

Apple Developer証明書による署名・公証済みのため、Gatekeeperの許可手順は不要です。

**方法2: 直接実行**

```bash
./src-tauri/target/release/bundle/macos/AI\ Speak\ Trace.app/Contents/MacOS/ai-speak-trace
```

## プロダクションビルドのデバッグ

ターミナルからアプリを直接起動すると、バックエンド（sidecar）のログやエラーが表示されます:

```bash
./src-tauri/target/release/bundle/macos/AI\ Speak\ Trace.app/Contents/MacOS/ai-speak-trace
```

アプリ起動後、`Cmd + Option + I` で DevTools を開き、フロントエンドのエラーを確認できます。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| デスクトップ | Tauri v2（Rust + WebView） |
| フロントエンド | Vite + React + TypeScript |
| バックエンド | NestJS（sidecarバイナリとしてバンドル） |
| 音声認識 | ElevenLabs Scribe v2 |
| AI分析 | Claude API（Anthropic） |
| 日本語の解析（ベータ） | GiNZA（Python 3.12。初回利用時に uv で入れる） |
| バイナリ化 | @yao-pkg/pkg |

## アーキテクチャ

```
AI Speak Trace.app (Tauri)
├── WebView (frontend/dist)        ← Vite ビルド済みの React アプリ
├── Rust Core (src-tauri/)         ← Tauri 本体 + sidecar管理・ポート通知
└── Sidecar (nestjs-server)        ← NestJS を pkg でバイナリ化
    ├── HTTP API (127.0.0.1:動的ポート)
    └── Python (ginza/venv)        ← GiNZA のキーワード抽出（ベータ）。必要なときに子プロセスとして起動
```

- フロントエンドは WebView 内で動作し、NestJS sidecar と HTTP 通信
- NestJS は `listen(0)` でOSに空きポートを自動割り当て。Rust が stdout の `PORT=xxxxx` を検知してフロントへ通知
- Tauri の Rust 側で sidecar プロセスの起動・終了をライフサイクル管理
- データは `~/Library/Application Support/io.github.saicologic.ai-speak-trace/data/` に保存

### GiNZA のキーワード抽出（ベータ機能）

- DMG を大きくしないため、Python と GiNZA は同梱しない。利用者が初めて使うときに、バックエンド（`backend/src/ginza/ginza-env.service.ts`）が `settings.json` と同じフォルダの `ginza/` に入れる（開発時は `backend/ginza/`。git では無視する）
  1. uv をGitHubのリリースからダウンロードし、SHA-256 を確かめる（バージョンとハッシュはコードに固定）
  2. uv で Python 3.12 の仮想環境（`ginza/venv`）を作る（3.13 以降は Apple シリコン向けの高速化（`thinc-apple-ops`）が入らず、解析が約4倍遅くなるため 3.12 にしている）
  3. `backend/python/requirements.txt` を `--require-hashes --only-binary :all:` で入れる
  4. `backend/python/ginza_keywords.py --check` で GiNZA を読み込めることを確かめ、`ginza/installed.json` に記録する
- `requirements.txt` が変わったときだけ入れ直す。`ginza_keywords.py` だけが変わったときは、解析の前に写し直す
- 解析は `ginza_keywords.py` を子プロセスで起動し、発話のテキストを標準入力で渡す。発話ごとの結果を `data/ginza-keywords/` にキャッシュし、並べ替え（回数・TF-IDF・一般的な語の除外）は TypeScript（`backend/src/ginza/ginza-keywords.utils.ts`）で行う
- `backend/python/` の2つのファイルは、pkg の `assets`（`backend/package.json`）でバイナリに含める。Python からはバイナリの中のファイルを読めないため、`ginza/` に写してから使う
- Python のパッケージを更新するときは、`backend/python/requirements.in` を編集し、`requirements.txt` の先頭に書いたコマンドで作り直す（`--exclude-newer` で、公開から2週間以上たった版に限る。いまの GiNZA 5.3.0 は評価に使った版にそろえるための例外で、そのことも先頭に書いてある）
- API: `GET /api/ginza/status`・`POST /api/ginza/install`・`GET /api/ginza/transcriptions/:id/keywords`

## ディレクトリ構成

```
ai-speak-trace/
├── README.md
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
│   └── README.md
└── backend/               # バックエンドAPI（NestJS）
    ├── README.md
    ├── python/            # GiNZA のキーワード抽出（ベータ）のスクリプトとパッケージの一覧
    └── data/
        ├── audio/                # 音声ファイルの配置先
        ├── transcriptions/       # 文字起こし結果の保存先
        ├── documents/            # PDFファイルの保存先
        └── document-metadata/    # PDFメタデータの保存先
```

## Claude Code スキル

開発ワークフローを効率化するClaude Codeスキルが利用できます。

### スラッシュコマンド一覧

| コマンド | 説明 | 引数 |
|---|---|---|
| `/test` | テスト実行 | `backend` / `frontend` / なし（両方） |
| `/build` | ビルド確認 | なし |
| `/audit` | npm脆弱性チェック | なし |
| `/pr` | PRサマリー生成 | なし |
| `/release` | リリースPR作成 | バージョン（例: `v0.6.0`） |
| `/fix-issue` | Issue修正フロー | Issue番号（例: `42`） |
| `/research` | コードベース調査 | 調査トピック |

### 使用例

**テスト**
```
/test
/test backend
/test frontend
```

**ビルド確認**
```
/build
```

**脆弱性チェック**
```
/audit
```

**PRサマリー生成**
```
/pr
```

**リリースPR作成**
```
/release v0.6.0
```

**Issue修正**
```
/fix-issue 42
```

**コードベース調査**

複数ファイルにまたがる実装の全体像を把握したいときに使います。
Glob/Grepによる関連ファイルの検索、コードの読み込み、依存関係の追跡を自動で行い、構造化されたレポートを生成します。

ユースケース:
- 新機能追加前に、関連する既存コードの把握
- バグ修正時に、データフローや影響範囲の特定
- 特定機能の実装パターンやアーキテクチャの理解

```
/research 話者分離の処理フロー
/research ElevenLabs APIの呼び出し箇所
/research フロントエンドの状態管理
```

レポート形式:
1. 概要 — 調査トピックの全体像
2. 関連ファイル — ファイルパスと役割の一覧
3. 実装の詳細 — コードの動作や設計パターン
4. 依存関係 — 他のモジュールとの関係
5. 注意点 — 改善の余地やリスク

### 自動適用スキル

以下のスキルはスラッシュコマンドではなく、対象ファイルの編集時に自動的に適用されます。

| スキル | 対象 | 説明 |
|---|---|---|
| `api-conventions` | `backend/src/**` | NestJSのモジュール構成・設計規約 |

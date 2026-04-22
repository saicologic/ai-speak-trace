# 開発者ガイド

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

### 2. 環境変数の設定（オプション）

バックエンドのポート番号を変更したい場合は、ルートの `.env` を編集してください（デフォルト: 3100）:

```env
BACKEND_PORT=3100
```

APIキーはアプリの「設定」画面から設定してください。

### 3. Rustのインストール（未インストールの場合）

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

## 開発モード起動

```bash
npm run dev
```

起動時に前回のバックエンドプロセスを自動終了するため、ポート競合を気にせず実行できます。
Ctrl+C でまとめて停止できます。

## プロダクションビルド

```bash
npm run build
```

生成物: `src-tauri/target/release/bundle/dmg/` に `.dmg` ファイルが生成されます。

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

初回起動時に「システム設定 > プライバシーとセキュリティ」で許可が必要です。

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
| バイナリ化 | @yao-pkg/pkg |

## アーキテクチャ

```
AI Speak Trace.app (Tauri)
├── WebView (frontend/dist)        ← Vite ビルド済みの React アプリ
├── Rust Core (src-tauri/)         ← Tauri 本体 + sidecar管理
└── Sidecar (nestjs-server)        ← NestJS を pkg でバイナリ化
    └── HTTP API (localhost:3100)
```

- フロントエンドは WebView 内で動作し、localhost:3100 の NestJS sidecar と HTTP 通信
- Tauri の Rust 側で sidecar プロセスの起動・終了をライフサイクル管理
- データは `~/Library/Application Support/io.github.saicologic.ai-speak-trace/data/` に保存

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
    └── data/
        ├── outputs/              # 音声ファイルの配置先
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

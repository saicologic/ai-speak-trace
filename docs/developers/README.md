# 開発者ガイド

## 前提条件

- Node.js 20以上
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

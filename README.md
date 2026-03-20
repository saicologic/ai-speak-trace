# AI Speak Trace

音声データから話者分離・文字起こしを行い、会話内容をキーワード分析・Web検索付きで深掘りできるデスクトップアプリケーションです。

## サービス概要

### 話者分離 & 文字起こし
- 1つの音声ファイルに含まれる2人の会話を自動で話者分離し、日本語で文字起こし
- ElevenLabs Scribe v2 APIを使用
- 話者名は「Aさん」「Bさん」がデフォルト（編集可能）

### 文字起こし結果の閲覧
- ブラウザ上で文字起こし結果を確認
- 単語・文章の選択、話者の識別が可能
- 文字起こし履歴の保存・再表示

### キーワード抽出 & フィルター
- 文字起こしテキストから専門用語・固有名詞を自動抽出（右サイドバー）
- キーワードのハイライト表示
- 選択したキーワードで発話を絞り込むフィルター機能

### 会話分析（Claude API + Web検索）
- 話者ごとのキーワードを自動抽出
- 選択したキーワードからClaude APIで調査質問を自動生成
- Claude APIのWeb検索ツールを使い、各質問についてWeb検索付きの分析レポートを生成
- 分析結果はMarkdown→HTMLで見やすく表示、出典URLも表示

### ディープサーチ
- 会話データ・PDFドキュメント・Web検索を横断的に検索
- Amazon Bedrock Titan Embeddings V2によるベクトル検索（PDF）
- 検索結果をClaudeで統合分析

## 技術スタック

| レイヤー | 技術 |
|---|---|
| デスクトップ | Tauri v2（Rust + WebView） |
| フロントエンド | Vite + React + TypeScript |
| バックエンド | NestJS（sidecarバイナリとしてバンドル） |
| 音声認識 | ElevenLabs Scribe v2 |
| AI分析 | Claude API（Anthropic） |
| ベクトル検索 | Amazon Bedrock + S3 Vectors |
| バイナリ化 | @yao-pkg/pkg |

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

## 前提条件

- Node.js 20以上
- npm
- Rust（`rustup` でインストール）
- ElevenLabs APIキー
- Anthropic APIキー
- AWS認証情報（ディープサーチ機能を使用する場合）

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

### 2. 環境変数の設定

`backend/.env` に以下を設定:

```env
ELEVENLABS_API_KEY=your-api-key
ANTHROPIC_API_KEY=your-api-key

# ストレージ設定（デフォルト: local）
STORAGE_TYPE=local

# AWS設定（ディープサーチ機能を使用する場合）
AWS_REGION=ap-northeast-1
BEDROCK_EMBEDDING_MODEL=amazon.titan-embed-text-v2:0
BEDROCK_EMBEDDING_DIMENSIONS=256
```

### 3. Rustのインストール（未インストールの場合）

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

## 起動方法

### デスクトップアプリ（開発モード）

バックエンドとTauriをそれぞれ起動します。

```bash
# ターミナル1: バックエンド（ポート3000）
cd backend
npm run start:dev

# ターミナル2: Tauri開発モード（フロントエンドは自動起動）
source "$HOME/.cargo/env"
npm run tauri:dev
```

### Webアプリとして起動（Tauriなし）

```bash
# ターミナル1: バックエンド
cd backend
npm run start:dev

# ターミナル2: フロントエンド
cd frontend
npm run dev
```

ブラウザで http://localhost:5173 にアクセスしてください。

## プロダクションビルド

### デスクトップアプリ（.dmg）

```bash
# 1. NestJSバイナリを生成
npm run pkg:backend

# 2. Tauriビルド（.app / .dmg を生成）
source "$HOME/.cargo/env"
npm run tauri:build
```

生成物:
- `src-tauri/target/release/bundle/macos/AI Speak Trace.app`
- `src-tauri/target/release/bundle/dmg/AI Speak Trace_0.1.0_aarch64.dmg`

### Webアプリのみ

```bash
# バックエンド
cd backend
npm run build
npm run start:prod

# フロントエンド
cd frontend
npm run build
```

フロントエンドのビルド結果は `frontend/dist/` に出力されます。

## 使い方

1. アプリを起動する
2. 左サイドバーから音声ファイルを選択、または文字起こし履歴を選択
3. 文字起こし結果が中央に表示される
4. 右サイドバーのキーワード一覧からキーワードをクリックしてハイライト
5. 「フィルター」ボタンで選択キーワードを含む発話のみに絞り込み
6. 「会話分析」ボタンで会話分析ページに遷移
7. 話者を選択するとその話者のキーワードが表示される
8. キーワードを選択して「質問を生成」→ チェックボックスで質問を選択 → 「分析する」で実行
9. 「ディープサーチ」で会話・PDF・Webを横断検索

## アーキテクチャ（デスクトップアプリ）

```
AI Speak Trace.app (Tauri)
├── WebView (frontend/dist)        ← Vite ビルド済みの React アプリ
├── Rust Core (src-tauri/)         ← Tauri 本体 + sidecar管理
└── Sidecar (nestjs-server)        ← NestJS を pkg でバイナリ化
    └── HTTP API (localhost:3000)
```

- フロントエンドは WebView 内で動作し、localhost:3000 の NestJS sidecar と HTTP 通信
- Tauri の Rust 側で sidecar プロセスの起動・終了をライフサイクル管理
- データは `~/Library/Application Support/com.saicologic.ai-speak-trace/data/` に保存

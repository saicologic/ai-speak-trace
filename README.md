# AI Speak Trace

音声データから話者分離・文字起こしを行い、会話内容をキーワード分析・Web検索付きで深掘りできるデスクトップアプリケーションです。

## サービス概要

### 話者分離 & 文字起こし
- 1つの音声ファイルに含まれる2人の会話を自動で話者分離し、日本語で文字起こし
- ElevenLabs Scribe v2 APIを使用
- 話者名は「Aさん」「Bさん」がデフォルト（編集可能）

### Podcast文字起こし
- macOS Podcastアプリのキャッシュから音声ファイルを自動検出
- Podcast音声をそのまま文字起こし可能

### 文字起こし結果の閲覧
- アプリ上で文字起こし結果を確認
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

---

## 利用者ガイド

### インストール

1. `.dmg` ファイルを開く
2. `AI Speak Trace.app` を `Applications` フォルダにドラッグ&ドロップ
3. 初回起動時にセキュリティ警告が出た場合は「システム設定 > プライバシーとセキュリティ」から許可する

### 初期設定

アプリを使用するには、以下のAPIキーが必要です。

| キー | 用途 | 取得先 |
|---|---|---|
| ElevenLabs APIキー | 音声の文字起こし | https://elevenlabs.io |
| Anthropic APIキー | 会話分析・質問生成 | https://console.anthropic.com |

アプリ内の「設定」画面からAPIキーを設定してください。保存後すぐに反映されるため、アプリの再起動は不要です。

### 起動

`Applications` フォルダから `AI Speak Trace` をダブルクリックで起動します。
バックエンドサーバーはアプリ内で自動的に起動します。

### 使い方

1. アプリを起動する
2. 左サイドバーから音声ファイルを選択、または文字起こし履歴を選択
3. 文字起こし結果が中央に表示される
4. 右サイドバーのキーワード一覧からキーワードをクリックしてハイライト
5. 「フィルター」ボタンで選択キーワードを含む発話のみに絞り込み
6. 「会話分析」ボタンで会話分析ページに遷移
7. 話者を選択するとその話者のキーワードが表示される
8. キーワードを選択して「質問を生成」→ チェックボックスで質問を選択 → 「分析する」で実行

### データの保存先

文字起こし結果やアップロードした音声ファイルは以下に保存されます:

```
~/Library/Application Support/io.github.saicologic.ai-speak-trace/data/
├── outputs/          # 音声ファイル
├── transcriptions/   # 文字起こし結果
├── documents/        # PDFファイル
└── document-metadata/# PDFメタデータ
```

### 確認事項・トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| 起動直後に「サーバーに接続できません」と表示される | バックエンドの起動待ち中です。自動リトライされるので数秒お待ちください |
| 文字起こしが実行できない | 設定画面でElevenLabs APIキーが正しく設定されているか確認してください |
| 会話分析が実行できない | 設定画面でAnthropic APIキーが正しく設定されているか確認してください |
| `EADDRINUSE: address already in use :::3100` | `npm run kill` を実行してから再起動してください。または `.env` の `BACKEND_PORT` を別のポートに変更してください |

---

## 応用編

### ディープサーチ（AWS連携）

ディープサーチ機能でPDFドキュメントのベクトル検索を使用するには、AWS認証情報の設定が必要です。

#### 必要なAWSサービス
- Amazon Bedrock（Titan Embeddings V2）
- Amazon S3 Vectors

#### 環境変数の設定

`backend/.env` に以下を追加:

```env
AWS_REGION=ap-northeast-1
BEDROCK_EMBEDDING_MODEL=amazon.titan-embed-text-v2:0
BEDROCK_EMBEDDING_DIMENSIONS=256
```

AWS認証情報は `~/.aws/credentials` または環境変数（`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`）で設定してください。

---

## 開発者ガイド

### 前提条件

- Node.js 20以上
- npm
- Rust（`rustup` でインストール）
- ElevenLabs APIキー
- Anthropic APIキー

### セットアップ

#### 1. 依存関係のインストール

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

#### 2. 環境変数の設定（オプション）

バックエンドのポート番号を変更したい場合は、ルートの `.env` を編集してください（デフォルト: 3100）:

```env
BACKEND_PORT=3100
```

APIキーはアプリの「設定」画面から設定してください。

#### 3. Rustのインストール（未インストールの場合）

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

### 開発モード起動

```bash
npm run dev
```

起動時に前回のバックエンドプロセスを自動終了するため、ポート競合を気にせず実行できます。
Ctrl+C でまとめて停止できます。

### プロダクションビルド

```bash
npm run build
```

生成物: `src-tauri/target/release/bundle/dmg/` に `.dmg` ファイルが生成されます。

### 技術スタック

| レイヤー | 技術 |
|---|---|
| デスクトップ | Tauri v2（Rust + WebView） |
| フロントエンド | Vite + React + TypeScript |
| バックエンド | NestJS（sidecarバイナリとしてバンドル） |
| 音声認識 | ElevenLabs Scribe v2 |
| AI分析 | Claude API（Anthropic） |
| ベクトル検索 | Amazon Bedrock + S3 Vectors |
| バイナリ化 | @yao-pkg/pkg |

### アーキテクチャ

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

### ディレクトリ構成

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

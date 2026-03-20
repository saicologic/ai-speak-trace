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
- **ベクトル検索**: Amazon Bedrock + S3 Vectors
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
        ├── outputs/              # 音声ファイルの配置先
        ├── transcriptions/       # 文字起こし結果の保存先
        ├── documents/            # PDFファイルの保存先
        └── document-metadata/    # PDFメタデータの保存先
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

- 会話データ・PDFドキュメント・Web検索を横断的に検索
- Amazon Bedrock Titan Embeddings V2によるベクトル検索（PDF）
- 検索結果をClaudeで統合分析

## 前提条件

- 文字起こしは日本語
- 音声ファイルはアプリ内でアップロード、または macOS Podcastキャッシュから検出
- デスクトップアプリのデータは `~/Library/Application Support/io.github.saicologic.ai-speak-trace/data/` に保存

## 開発ルール

- コードおよびコメントは日本語で記述する
- コミットメッセージは日本語で記述する

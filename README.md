# AI Speak Trace

音声データから話者分離・文字起こしを行い、会話内容をキーワード分析・Web検索付きで深掘りできるWebアプリケーションです。

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

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | Vite + React 19 + TypeScript |
| バックエンド | NestJS 11 + TypeScript |
| 音声文字起こし | ElevenLabs Scribe v2 API |
| 会話分析 | Anthropic Claude API（Web検索ツール付き） |

## ディレクトリ構成

```
ai-speak-trace/
├── README.md
├── CLAUDE.md
├── frontend/          # フロントエンド（Vite + React）
└── backend/           # バックエンドAPI（NestJS）
    └── data/
        ├── outputs/          # 音声ファイルの配置先
        └── transcriptions/   # 文字起こし結果の保存先
```

## セットアップ

### 前提条件

- Node.js 18以上
- pnpm（バックエンド）/ npm（フロントエンド）
- ElevenLabs APIキー
- Anthropic APIキー

### 1. リポジトリのクローン

```bash
git clone <リポジトリURL>
cd ai-speak-trace
```

### 2. 環境変数の設定

```bash
cp backend/.env.example backend/.env
```

`backend/.env` に以下を設定します:

```env
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
STORAGE_TYPE=local
OUTPUTS_DIR=./data/outputs
TRANSCRIPTIONS_DIR=./data/transcriptions
```

本番（S3使用時）は以下を設定:

```env
STORAGE_TYPE=s3
S3_BUCKET=your-bucket-name
S3_AUDIO_PREFIX=outputs/
S3_TRANSCRIPTIONS_PREFIX=transcriptions/
AWS_REGION=ap-northeast-1
```

### 3. バックエンドのセットアップ

```bash
cd backend
pnpm install
```

### 4. フロントエンドのセットアップ

```bash
cd frontend
npm install
```

### 5. 音声ファイルの配置

分析したい音声ファイルを `backend/data/outputs/` フォルダに配置してください。

## 起動方法

### 開発モード

バックエンドとフロントエンドをそれぞれ起動します。

**バックエンド**（ポート3000）:

```bash
cd backend
pnpm run start:dev
```

**フロントエンド**（ポート5173）:

```bash
cd frontend
npm run dev
```

ブラウザで http://localhost:5173 にアクセスしてください。

### 本番ビルド

```bash
# バックエンド
cd backend
pnpm run build
pnpm run start:prod

# フロントエンド
cd frontend
npm run build
```

フロントエンドのビルド結果は `frontend/dist/` に出力されます。

## 使い方

1. ブラウザで http://localhost:5173 を開く
2. 左サイドバーから音声ファイルを選択、または文字起こし履歴を選択
3. 文字起こし結果が中央に表示される
4. 右サイドバーのキーワード一覧からキーワードをクリックしてハイライト
5. 「フィルター」ボタンで選択キーワードを含む発話のみに絞り込み
6. 「会話分析」ボタンで会話分析ページに遷移
7. 話者を選択するとその話者のキーワードが表示される
8. キーワードを選択して「質問を生成」→ チェックボックスで質問を選択 → 「分析する」で実行

# AI Speak Trace - Backend

音声ファイルの話者分離・文字起こし・会話分析を行うバックエンドAPIです。

## 技術スタック

| カテゴリ | 技術 | バージョン |
|---------|------|-----------|
| フレームワーク | NestJS | 11.x |
| 言語 | TypeScript | 5.7.x |
| 音声文字起こし | ElevenLabs Scribe v2 API | - |
| 会話分析 | Anthropic Claude API | - |
| ストレージ | ローカルファイル / AWS S3 | - |
| テスト | Jest | 30.x |
| リンター | ESLint + Prettier | - |

## セットアップ

### 依存パッケージのインストール

```bash
pnpm install
```

### 環境変数

`backend/.env` に以下を設定してください。

```env
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
STORAGE_TYPE=local
OUTPUTS_DIR=./data/outputs
TRANSCRIPTIONS_DIR=./data/transcriptions
```

S3ストレージを使用する場合は以下も追加してください。

```env
STORAGE_TYPE=s3
S3_BUCKET=your-bucket-name
S3_AUDIO_PREFIX=outputs/
S3_TRANSCRIPTIONS_PREFIX=transcriptions/
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
```

### 音声ファイルの配置

分析したい音声ファイルを `data/outputs/` フォルダに配置してください。

### 開発サーバーの起動

```bash
pnpm run start:dev
```

http://localhost:3100 で起動します。APIは `/api` プレフィックス付きです。

### ビルド

```bash
pnpm run build
pnpm run start:prod
```

### その他のコマンド

```bash
# ユニットテスト
pnpm run test

# E2Eテスト
pnpm run test:e2e

# テストカバレッジ
pnpm run test:cov

# リント
pnpm run lint

# フォーマット
pnpm run format
```

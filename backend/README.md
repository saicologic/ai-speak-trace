# AI Speak Trace - Backend

音声ファイルの話者分離・文字起こし・キーワード抽出・会話分析を行うバックエンドAPIです。

## 技術スタック

| カテゴリ | 技術 | バージョン |
|---------|------|-----------|
| フレームワーク | NestJS | 11.x |
| 言語 | TypeScript | 5.7.x |
| 音声文字起こし | [ElevenLabs Scribe v2](https://elevenlabs.io/docs/capabilities/speech-to-text) API | - |
| 会話分析 | [Claude API](https://docs.anthropic.com/ja/docs/welcome)（[Anthropic](https://www.anthropic.com/)） | - |
| ストレージ | ローカルファイル | - |
| テスト | Jest | 30.x |
| リンター | ESLint + Prettier | - |

## セットアップ

### 依存パッケージのインストール

```bash
npm install
```

### 環境変数

APIキーはアプリの「設定」画面から設定してください。

ポート番号を変更したい場合は、ルートの `.env` を編集してください（デフォルト: 3100）:

```env
BACKEND_PORT=3100
```

### 開発サーバーの起動

```bash
npm run start:dev
```

http://localhost:3100 で起動します。APIは `/api` プレフィックス付きです。

### ビルド

```bash
npm run build
npm run start:prod
```

### その他のコマンド

```bash
# ユニットテスト
npm run test

# E2Eテスト
npm run test:e2e

# テストカバレッジ
npm run test:cov

# リント
npm run lint

# フォーマット
npm run format
```

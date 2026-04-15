# AI Speak Trace - Backend

音声ファイルの話者分離・文字起こし・キーワード抽出・会話分析を行うバックエンドAPIです。

## 技術スタック

| カテゴリ | 技術 | バージョン |
|---------|------|-----------|
| フレームワーク | NestJS | 11.x |
| 言語 | TypeScript | 5.7.x |
| 音声文字起こし | [ElevenLabs Scribe v2](https://elevenlabs.io/docs/overview/capabilities/speech-to-text) API | - |
| 会話分析 | [Claude API](https://docs.anthropic.com/ja/docs/welcome)（[Anthropic](https://www.anthropic.com/)） | - |
| ストレージ | ローカルファイル | - |
| テスト | Jest | 30.x |
| リンター | ESLint + Prettier | - |

## 利用しているAPI

### ElevenLabs API

音声ファイルの文字起こしに使用しています。

- [APIクイックスタート](https://elevenlabs.io/docs/eleven-api/quickstart)
- [Speech to Text ドキュメント](https://elevenlabs.io/docs/overview/capabilities/speech-to-text)

| エンドポイント | 用途 | APIリファレンス |
|---|---|---|
| `POST /v1/speech-to-text` | 音声ファイルの文字起こし（Scribe v2） | [Convert](https://elevenlabs.io/docs/api-reference/speech-to-text/convert) |
| `GET /v1/user/subscription` | クレジット残量の確認 | [Subscription](https://elevenlabs.io/docs/api-reference/user/subscription) |
| `GET /v1/speech-to-text/transcripts/{id}` | 文字起こしステータスの確認 | [Get Transcript](https://elevenlabs.io/docs/api-reference/speech-to-text/get) |

### Claude API（Anthropic）

会話分析・質問生成・ディープサーチに使用しています。

- [APIドキュメント](https://docs.anthropic.com/ja/docs/welcome)
- [Web検索ツール](https://docs.anthropic.com/ja/docs/agents-and-tools/tool-use/web-search-tool)

| エンドポイント | 用途 | APIリファレンス |
|---|---|---|
| `POST /v1/messages` | 質問生成・会話分析・ディープサーチ（Web検索ツール併用あり） | [Messages](https://docs.anthropic.com/ja/api/messages) |

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

## テスト

### ユニットテスト

コアロジックのユーティリティ関数をテストしています。テストファイルは対象ファイルと同階層に `.spec.ts` として配置しています。

| テストファイル | テスト対象 | 内容 |
|--------------|-----------|------|
| `transcription/transcription.utils.spec.ts` | `mergeWordsIntoPhrases`, `buildSpeakers`, `groupWordsIntoUtterances` | 文字起こし結果の組み立てロジック |
| `transcription/chunked-transcription.utils.spec.ts` | `adjustTimestamps`, `resolveSpeakerMapping`, `mergeChunkResults` | 長時間音声のチャンク分割・結合処理 |
| `document/document.utils.spec.ts` | `chunkText`, `splitIntoSentences`, `truncateToBytes` | PDF検索用のテキスト分割処理 |

テスト対象の関数は `*.utils.ts` に純粋関数として切り出しており、外部依存なしで高速に実行できます。

### テスト実行

```bash
# ユニットテスト
npm run test

# カバレッジ付き
npm run test:cov

# ウォッチモード（ファイル変更時に自動実行）
npm run test:watch
```

### その他のコマンド

```bash
# リント
npm run lint

# フォーマット
npm run format
```

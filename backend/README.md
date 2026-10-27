# AI Speak Trace - Backend

音声ファイルの話者分離・文字起こし・キーワード抽出・要約・会話分析・発言の文脈・ディープサーチ・個人情報チェックを行うバックエンドAPIです。

## 技術スタック

| カテゴリ | 技術 | バージョン |
|---------|------|-----------|
| フレームワーク | NestJS | 11.x |
| 言語 | TypeScript | 5.7.x |
| 音声文字起こし | [ElevenLabs Scribe v2](https://elevenlabs.io/docs/overview/capabilities/speech-to-text) API | - |
| 要約・会話分析・ディープサーチ | [Claude API](https://docs.anthropic.com/ja/docs/welcome)（[Anthropic](https://www.anthropic.com/)） | - |
| 個人情報・プロンプト攻撃の検出、根拠の確認 | [Amazon Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html)（`@aws-sdk/client-bedrock-runtime`） | - |
| キーワード抽出（ベータ） | [GiNZA](https://megagonlabs.github.io/ginza/)（Python。初回利用時に uv で入れる。[開発者ガイド](../docs/developers/README.md#ginza-のキーワード抽出ベータ機能)） | 5.3.x |
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

要約・会話分析・質問生成・発言の文脈・ディープサーチに使用しています。Claude への送受信は、すべて `claude/claude-client.service.ts` を通し、送る前と受け取った後に Guardrails で確認します。

- [APIドキュメント](https://docs.anthropic.com/ja/docs/welcome)
- [Web検索ツール](https://docs.anthropic.com/ja/docs/agents-and-tools/tool-use/web-search-tool)

| エンドポイント | 用途 | APIリファレンス |
|---|---|---|
| `POST /v1/messages` | 要約・質問生成・会話分析・発言の文脈・ディープサーチ（会話分析とディープサーチは Web検索ツール併用あり） | [Messages](https://docs.anthropic.com/ja/api/messages) |

### Amazon Bedrock Guardrails

会話の個人情報チェックと、Claude に送る前・受け取った後の確認に使用しています（`privacy/guardrail.service.ts`）。AWS の認証情報は、設定画面の「AWS プロファイル」で指定した `~/.aws` のプロファイルを使います。

| API | 用途 | APIリファレンス |
|---|---|---|
| `ApplyGuardrail` | 個人情報・不適切な表現・プロンプト攻撃の検出、ディープサーチの根拠スコア（contextual grounding check） | [ApplyGuardrail](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ApplyGuardrail.html) |

## セットアップ

### 依存パッケージのインストール

```bash
npm install
```

### 環境変数

APIキーはアプリの「設定」画面から設定してください。

### 開発サーバーの起動

```bash
npm run start:dev
```

OSが自動で空きポートを割り当てて起動します。起動後に `PORT=xxxxx` が stdout に出力されます。APIは `/api` プレフィックス付きです。

### ビルド

```bash
npm run build
npm run start:prod
```

## テスト

### ユニットテスト

テストファイルは対象ファイルと同階層に `.spec.ts` として配置しています（`src/` の各フォルダにあります）。主なものは次のとおりです。

| テストファイル | 内容 |
|--------------|------|
| `transcription/transcription.utils.spec.ts` | 文字起こし結果の組み立てロジック |
| `transcription/chunked-transcription.utils.spec.ts` | 長時間音声のチャンク分割・結合処理 |
| `ginza/ginza-keywords.utils.spec.ts` | GiNZA で取り出した語の並べ替え（回数・TF-IDF・一般的な語の除外） |
| `claude/claude-client.service.spec.ts` | Claude への送受信と Guardrails の確認 |
| `privacy/privacy.service.spec.ts` | 個人情報チェックと伏せる文字列の扱い |
| `research/research.service.spec.ts` | ディープサーチの段階の進行と評価（根拠のない文を除く判定） |

ロジックは `*.utils.ts` に純粋関数として切り出し、外部依存なしで高速に実行できるようにしています。

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

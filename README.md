# AI Speak Trace

音声データから話者分離・文字起こしを行い、会話内容をキーワード分析・Web検索付きで深掘りできる macOS のデスクトップアプリケーションです。

![AI Speak Trace スクリーンショット](docs/screenshots/readme_top.jpg)

## できること

- 話者分離と日本語の文字起こし（ElevenLabs Scribe v2）
- 話者・キーワードでの発話の絞り込み
- 要約・会話分析・発言の文脈（Claude API）
- ディープサーチ：会話に出てきた用語を、Web の公式情報で調べて解説
- 個人情報チェック：Claude に送る前に、会話の個人情報を伏せる（Amazon Bedrock Guardrails）

## はじめかた

1. [GitHub Releases](https://github.com/saicologic/ai-speak-trace/releases/latest) から最新版をダウンロードして入れる
2. アプリ右上の `設定` から API キーなどを設定する → [インストールと初期設定](docs/users/setup.md)
3. 音声ファイルを選んで文字起こしする → [使い方](docs/users/usage.md)

会話の音声や文字起こしは、外部のAIサービス（ElevenLabs・Anthropic・AWS）に送って処理します。使う前に [PRIVACY.md](PRIVACY.md) を確認してください。

## ドキュメント

| 知りたいこと | ドキュメント |
|---|---|
| インストールと初期設定 | [docs/users/setup.md](docs/users/setup.md) |
| 各機能の使い方・データの保存先 | [docs/users/usage.md](docs/users/usage.md) |
| うまく動かないとき | [docs/users/troubleshooting.md](docs/users/troubleshooting.md) |
| 外部に送るデータ・保存するデータ・削除方法 | [PRIVACY.md](PRIVACY.md) |
| セキュリティ上の問題の報告 | [SECURITY.md](SECURITY.md) |
| 開発環境・ビルド・アーキテクチャ | [docs/developers/README.md](docs/developers/README.md) |
| ディープサーチの仕組み | [docs/developers/deep-search.md](docs/developers/deep-search.md) |
| AI に動作確認を頼む | [docs/developers/ai-testing.md](docs/developers/ai-testing.md) |
| バックエンド・フロントエンド | [backend/README.md](backend/README.md)・[frontend/README.md](frontend/README.md) |

## ライセンス

[MIT License](LICENSE)

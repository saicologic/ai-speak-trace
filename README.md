# AI Speak Trace

音声データから話者分離・文字起こしを行い、会話内容をキーワード分析・Web検索付きで深掘りできるデスクトップアプリケーションです。

## クイックスタート

### 1. インストール

[GitHub Releases](https://github.com/saicologic/ai-speak-trace/releases/latest) から最新版の `AI.Speak.Trace.dmg` をダウンロードしてください。

1. ダウンロードした `AI.Speak.Trace.dmg` をダブルクリックで開く
2. `AI Speak Trace.app` を `Applications` フォルダにドラッグ&ドロップ
3. コード署名されていないアプリのため、初回起動前にターミナルで以下を実行:

```bash
xattr -cr /Applications/AI\ Speak\ Trace.app
```

> **なぜこの操作が必要？**
> macOS Gatekeeper がコード署名のないアプリをブロックするため、手動で制限を解除する必要があります。

### 2. 初期設定

アプリを使用するには、以下のAPIキーが必要です。

| キー | 用途 | 取得先 |
|---|---|---|
| ElevenLabs APIキー | 音声の文字起こし | https://elevenlabs.io |
| Anthropic APIキー | 会話分析・質問生成 | https://console.anthropic.com |

アプリ内の「設定」画面からAPIキーを設定してください。保存後すぐに反映されるため、アプリの再起動は不要です。

### 3. 音声ファイルの準備

手持ちの音声ファイル（mp3, m4a, wav など）をそのまま使えます。

**Podcastアプリから取り込む場合**

macOSにはPodcastアプリがプリインストールされています。エピソードをダウンロードしてから、本アプリにアップロードしてください。

- [Podcastでエピソードを保存する/ダウンロードする（Mac）](https://support.apple.com/ja-jp/guide/podcasts/poda4f6be01/mac)
- [Podcastユーザガイド（Mac）](https://support.apple.com/ja-jp/guide/podcasts/welcome/mac)
- [iTunesでポッドキャストをダウンロードする（Windows）](https://support.apple.com/ja-jp/guide/itunes/itns3125/windows)

> Podcastアプリが見つからない場合は、[App Store](https://apps.apple.com/jp/app/apple-podcasts/id525463029) から再インストールできます。

**ファイルの場所**

| 種類 | パス |
|---|---|
| Podcast音声のキャッシュ | `~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache` |
| アプリのデータ保存先 | `~/Library/Application Support/io.github.saicologic.ai-speak-trace/data` |

ターミナルでアクセスする場合（スペースをエスケープ）:

```bash
# Podcast音声のキャッシュ
open ~/Library/Group\ Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache

# アプリのデータ保存先
open ~/Library/Application\ Support/io.github.saicologic.ai-speak-trace/data
```

### 4. 文字起こしを実行

1. `Applications` フォルダから `AI Speak Trace` をダブルクリックで起動
2. 左サイドバーの「音声ファイルの文字起こし」をクリック
3. 音声ファイルを選択し、クレジット残量を確認して「文字起こしを実行」
4. 完了後、メイン画面に文字起こし結果が表示される

---

## 主な機能

### 文字起こし・話者分離
- [ElevenLabs Scribe v2](https://elevenlabs.io/docs/capabilities/speech-to-text) APIで高精度な日本語文字起こし
- 1つの音声に含まれる2人の会話を自動で話者分離
- 話者名は「Aさん」「Bさん」がデフォルト（後から編集可能）
- 10分を超える長時間音声はチャンク分割（10分単位）で処理
- 中断・失敗した文字起こしジョブを途中から再開可能
- 文字起こし前にElevenLabsクレジット残量を確認し、不足時は警告表示

### キーワード抽出 & フィルター
- 話者ごとに色分けされた文字起こし結果を閲覧
- 専門用語・固有名詞を自動抽出してキーワード一覧に表示
- キーワードのハイライト表示・フィルター機能で発話を絞り込み
- 話者別フィルターで特定の話者の発話のみに絞り込み
- 話者フィルター中に発話をクリックすると、直前の別話者の発話をポップアップ表示
- 文字起こし履歴の保存・再表示

### 音声と会話の連動
- 🔍ボタンで現在の再生位置に該当する発話へ自動スクロール
- 発話のタイムスタンプをクリックすると、その位置から音声を再生
- 単語をクリックすると、その単語の位置に音声再生位置を移動

### 会話分析
- 話者ごとのキーワードを自動抽出
- 選択したキーワードから[Claude API](https://docs.anthropic.com/ja/docs/welcome)（[Anthropic](https://www.anthropic.com/)のAIモデル）で調査質問を自動生成
- Web検索付きの分析レポートを生成、出典URLも表示

---

## 使い方

### 文字起こしが中断・失敗した場合
1. 左サイドバーの「中断中のジョブ」をクリック
2. 対象のジョブを選択し、進捗画面で「途中から再開する」をクリック
3. 完了済みチャンクはスキップされ、未処理分から再開される

### 結果の閲覧・分析
1. 左サイドバーの履歴から文字起こし結果を選択
2. 右サイドバーのキーワード一覧からキーワードをクリックしてハイライト
3. 「フィルター」ボタンで選択キーワードを含む発話のみに絞り込み
4. 「会話分析」ボタンで会話分析ページに遷移
5. 話者を選択するとその話者のキーワードが表示される
6. キーワードを選択して「質問を生成」→ チェックボックスで質問を選択 → 「分析する」で実行
7. 音声を再生・停止し、🔍ボタンで該当する会話にジャンプ
8. タイムスタンプや単語をクリックして聞きたい箇所に移動

---

## データの保存先

文字起こし結果やアップロードした音声ファイルは以下に保存されます:

```
~/Library/Application Support/io.github.saicologic.ai-speak-trace/data/
├── outputs/          # 音声ファイル
├── transcriptions/   # 文字起こし結果
├── chunks/           # チャンク分割された音声ファイル（処理中のみ）
├── chunked-jobs/     # チャンク分割ジョブの状態
├── documents/        # PDFファイル
└── document-metadata/# PDFメタデータ
```

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| 起動直後に「サーバーに接続できません」と表示される | バックエンドの起動待ち中です。自動リトライされるので数秒お待ちください |
| 文字起こしが実行できない | 設定画面でElevenLabs APIキーが正しく設定されているか確認してください |
| 会話分析が実行できない | 設定画面でAnthropic APIキーが正しく設定されているか確認してください |
| `EADDRINUSE: address already in use :::3100` | `npm run kill` を実行してから再起動してください。または `.env` の `BACKEND_PORT` を別のポートに変更してください |
| `Port 5173 is already in use` | `npm run kill` を実行してから再起動してください。フロントエンド（Vite）のポートが占有されています |
| 長時間音声の文字起こし中に「Load failed」と表示される | WebViewのコネクションタイムアウトです。バックエンドは処理を継続しているため、進捗画面で完了を待つか、「中断中のジョブ」から再開してください |
| 中断中のジョブが表示されない | 同じファイル名で完了済みの文字起こしがある場合、中断ジョブは自動的に非表示になります |

---

## ベータ版

以下の機能は設定画面から個別に有効化できます（デフォルトは無効）。

### ディープサーチ
- 会話データ・PDFドキュメント・Web検索を横断的に検索
- Amazon Bedrock Titan Embeddings V2によるベクトル検索（PDF）
- 検索結果を[Claude API](https://docs.anthropic.com/ja/docs/welcome)で統合分析

### 発言の文脈
- 文字起こし結果から発言を複数選択して文脈を分析
- 各発言の意図・トピックを[Claude API](https://docs.anthropic.com/ja/docs/welcome)で解析

---

## 開発者向け

[開発者ガイド](docs/developers/)

---

## ライセンス

[MIT License](LICENSE)

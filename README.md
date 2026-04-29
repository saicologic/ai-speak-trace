# AI Speak Trace

音声データから話者分離・文字起こしを行い、会話内容をキーワード分析・Web検索付きで深掘りできるデスクトップアプリケーションです。

## クイックスタート

### 1. インストール

[GitHub Releases](https://github.com/saicologic/ai-speak-trace/releases/latest) から最新版をダウンロードしてください。

**dmgファイルの場合（推奨）**

1. `.dmg` ファイルをダブルクリック
2. 開いたウィンドウでアプリを `Applications` フォルダにドラッグ&ドロップ
3. Launchpadまたは `Applications` フォルダからアプリを起動

**tar.gzファイルの場合**

1. ターミナルで以下を実行してインストール:

```bash
# ダウンロードしたファイルを展開してApplicationsフォルダに配置
tar xzf ~/Downloads/AI.Speak.Trace_*.app.tar.gz -C /Applications
```

2. Launchpadまたは `Applications` フォルダからアプリを起動

### 2. 初期設定

アプリを使用するには、以下のAPIキーが必要です。

| キー | 用途 | 取得先 |
|---|---|---|
| ElevenLabs | 音声の文字起こし | https://elevenlabs.io/app/developers/api-keys |
| Anthropic | 会話分析・質問生成 | https://console.anthropic.com |

アプリ内の「設定」画面からAPIキーを設定してください。保存後すぐに反映されるため、アプリの再起動は不要です。

#### ElevenLabs APIキーのアクセス制限

**アクセスが必要な項目:**

| スコープ | 設定 | 理由 |
|---|---|---|
| スピーチ to テキスト | アクセス | 音声の文字起こし・ステータス確認に必要 |
| ユーザー | 読み取り | クレジット残量確認に必要 |

上記以外のスコープ（テキスト読み上げ、サウンドエフェクト、ボイス等）は全て「アクセスなし」に設定してください。

### 3. 音声ファイルの準備

手持ちの音声ファイル（mp3, m4a, wav など）をそのまま使えます。

**Podcastアプリから取り込む場合**

macOSにはPodcastアプリがプリインストールされています。エピソードをダウンロードしてから、本アプリにアップロードしてください。

- [Podcastでエピソードを保存する/ダウンロードする（Mac）](https://support.apple.com/ja-jp/guide/podcasts/poda4f6be01/mac)
- [Podcastユーザガイド（Mac）](https://support.apple.com/ja-jp/guide/podcasts/welcome/mac)

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

### 4. 使い方

セットアップが完了したら、[使い方](#使い方)に進んでください。

---

## 使い方

### 1. ファイルアップロード・文字起こし・結果確認

1. 左サイドバーの「音声ファイルの文字起こし」をクリック
2. 音声ファイルを選択し、クレジット残量を確認して「文字起こしを実行」
3. 完了後、メイン画面に話者ごとに色分けされた文字起こし結果が表示される
4. 音声を再生・停止し、🔍ボタンで現在の再生位置に該当する発話へ自動スクロール
5. 発話のタイムスタンプや単語をクリックすると、その位置から音声を再生

### 2. 話者フィルター

1. 文字起こし結果画面で「話者」ボタンをクリック
2. 特定の話者を選択すると、その話者の発話のみに絞り込み表示
3. フィルター中に発話をクリックすると、直前の別話者の発話をポップアップ表示

### 3. キーワードフィルター

1. 右サイドバーに専門用語・固有名詞が自動抽出されたキーワード一覧が表示される
2. キーワードをクリックするとハイライト表示
3. 「フィルター」ボタンで選択キーワードを含む発話のみに絞り込み

### 4. 会話分析

1. 「会話分析」ボタンで会話分析ページに遷移
2. 話者を選択するとその話者のキーワードが表示される
3. キーワードを選択して「質問を生成」→ チェックボックスで質問を選択 →「分析する」で実行
4. [Claude API](https://docs.anthropic.com/ja/docs/welcome)がWeb検索付きの分析レポートを生成し、出典URLも表示

### 5. ベータ版の機能

以下の機能は設定画面から個別に有効化できます（デフォルトは無効）。

**ディープサーチ**
- 会話データ・PDFドキュメント・Web検索を横断的に検索
- Amazon Bedrock Titan Embeddings V2によるベクトル検索（PDF）
- 検索結果を[Claude API](https://docs.anthropic.com/ja/docs/welcome)で統合分析

**発言の文脈**
- 文字起こし結果から発言を複数選択して文脈を分析
- 各発言の意図・トピックを[Claude API](https://docs.anthropic.com/ja/docs/welcome)で解析

---

## データの保存先

文字起こし結果やアップロードした音声ファイルは以下に保存されます:

```
~/Library/Application Support/io.github.saicologic.ai-speak-trace/data/
├── audio/            # 音声ファイル
├── transcriptions/   # 文字起こし結果
├── chunks/           # チャンク分割された音声ファイル（処理中のみ）
├── chunked-jobs/     # チャンク分割ジョブの状態
├── documents/        # PDFファイル
└── document-metadata/# PDFメタデータ
```

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| 文字起こしが中断・失敗した | 左サイドバーの「中断中のジョブ」→ 対象ジョブを選択 →「途中から再開する」をクリック。完了済みチャンクはスキップされます |
| 起動直後に「サーバーに接続できません」と表示される | バックエンドの起動待ち中です。自動リトライされるので数秒お待ちください |
| 文字起こしが実行できない | 設定画面でElevenLabs APIキーが正しく設定されているか確認してください |
| 会話分析が実行できない | 設定画面でAnthropic APIキーが正しく設定されているか確認してください |
| 長時間音声の文字起こし中に「Load failed」と表示される | WebViewのコネクションタイムアウトです。バックエンドは処理を継続しているため、進捗画面で完了を待つか、「中断中のジョブ」から再開してください |
| 中断中のジョブが表示されない | 同じファイル名で完了済みの文字起こしがある場合、中断ジョブは自動的に非表示になります |

## 開発者向け

[開発者ガイド](docs/developers/)

---

## ライセンス

[MIT License](LICENSE)

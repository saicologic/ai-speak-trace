# インストールと初期設定

[README に戻る](../../README.md)

## 1. インストール

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

## 2. 初期設定

アプリ右上の `設定` ボタンから、使う機能に合わせて設定してください。保存後すぐに反映されるため、アプリの再起動は不要です。

| 設定画面の項目 | 使える機能 | 必要な設定 | 取得先 |
|---|---|---|---|
| 文字起こし | 文字起こし・結果の表示・キーワード | ElevenLabs の API キー | https://elevenlabs.io/app/developers/api-keys |
| AI 分析（Claude と AWS） | 要約・会話分析・発言の文脈・ディープサーチ | 「AI 分析を使う」を ON ＋ Anthropic の API キー ＋ Amazon Bedrock Guardrails（Guardrail ID・AWS プロファイル） | https://console.anthropic.com ・ AWS のコンソール（Bedrock の Guardrails） |
| キーワード | GiNZA のキーワード抽出（ベータ） | なし（初めて使うときに GiNZA をダウンロード） | |

AI 分析は、Claude に送る前に Guardrails で個人情報やプロンプト攻撃を確認するため、AWS が必要です。要約・会話分析・発言の文脈・ディープサーチのボタンはいつも表示し、「AI 分析を使う」が OFF のときや、Anthropic の API キー・Guardrail ID が足りないときは押せない状態にします。押せないときは、要約・会話分析・発言の文脈では右サイドバーのボタンの上に理由（OFF か、足りない設定）を表示し、左サイドバーのディープサーチではボタンにマウスを重ねると理由を表示します（使えるときは何も表示しません）。OFF のときは、Claude にも AWS にも何も送りません。新しく入れたときは OFF です（以前のバージョンで API キーと Guardrail ID を設定していた場合は ON）。AWS の認証情報は、この Mac の `~/.aws`（設定画面の「AWS プロファイル」で指定したプロファイル）を使います。

### ElevenLabs APIキーのアクセス制限

**アクセスが必要な項目:**

| スコープ | 設定 | 理由 |
|---|---|---|
| スピーチ to テキスト | アクセス | 音声の文字起こし・ステータス確認に必要 |
| ユーザー | 読み取り | クレジット残量確認に必要 |

上記以外のスコープ（テキスト読み上げ、サウンドエフェクト、ボイス等）は全て「アクセスなし」に設定してください。

## 3. 音声ファイルの準備

手持ちの音声ファイル（mp3, m4a, wav など）をそのまま使えます。

**Podcastアプリから取り込む場合**

macOSにはPodcastアプリがプリインストールされています。エピソードをダウンロードしてから、本アプリにアップロードしてください。デスクトップアプリでは、ファイルを選ぶ画面が最初から Podcast のキャッシュフォルダ（下の表）を開きます。

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


セットアップが終わったら、[使い方](usage.md)に進んでください。

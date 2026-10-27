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

AI 分析について:

- **AWS が必要な理由**: Claude に送る前に、Guardrails で個人情報やプロンプト攻撃を確認するためです。準備のしかたは下の「Amazon Bedrock Guardrails の準備」を参照してください。
- **OFF のとき**: Claude にも AWS にも何も送りません。新しく入れたときは OFF です（以前のバージョンで API キーと Guardrail ID を設定していた場合は ON）。
- **ボタンを押せないとき**: 要約・会話分析・発言の文脈・ディープサーチのボタンはいつも表示し、「AI 分析を使う」が OFF のときや、Anthropic の API キー・Guardrail ID が足りないときは押せない状態にします。理由は次の場所に表示します（使えるときは何も表示しません）。
  - 要約・会話分析・発言の文脈: 右サイドバーのボタンの上
  - ディープサーチ: 左サイドバーのボタンにマウスを重ねたとき
- **AWS の認証情報**: この Mac の `~/.aws`（設定画面の「AWS プロファイル」で指定したプロファイル）を使います。

### Amazon Bedrock Guardrails の準備

AI 分析を使うには、AWS アカウントに Guardrail を1つ作り、その ID を設定画面に入れます。

1. **Guardrail を作る**: AWS のコンソールで、東京リージョン（`ap-northeast-1`）の Amazon Bedrock → Guardrails から作ります。アプリは東京リージョンの Guardrail を呼びます。
   - **クロスリージョン推論**: 有効にし、Guardrail プロファイルに `apac.guardrail.v1:0` を選ぶ（日本語を確認できる Standard ティアに必要です）
   - **コンテンツフィルター**: Standard ティアにし、「プロンプト攻撃」を有効にする。ヘイト・侮辱などのフィルターも有効にすると、Claude の応答に不適切な表現がないかも確認します
   - **機密情報フィルター**: 検出したい個人情報の種類（氏名・住所・電話番号・メールアドレスなど）を選ぶ
   - **根拠の確認（contextual grounding check）**: ディープサーチの根拠スコアに使います。使わない場合は有効にしなくてもかまいません
   - **動作**: どのフィルターも「検出のみ」にする（ブロックしない）。伏せる・送らないの判断はアプリが行います
2. **バージョンを作る**: 作った Guardrail のバージョンを作り、その番号（`1` など）を設定画面の「バージョン」に入れます。空の場合は DRAFT を使いますが、コンソールで編集するとすぐに変わるため、バージョンの指定を勧めます。
3. **IAM の権限を付ける**: 使う IAM ユーザーに、Guardrail と、Guardrail プロファイルの送り先のリージョンへの `bedrock:ApplyGuardrail` を許可します。

   ```json
   {
     "Effect": "Allow",
     "Action": ["bedrock:ApplyGuardrail"],
     "Resource": [
       "arn:aws:bedrock:ap-northeast-1:<アカウントID>:guardrail/<Guardrail ID>",
       "arn:aws:bedrock:*:<アカウントID>:guardrail-profile/apac.guardrail.v1:0"
     ]
   }
   ```

4. **プロファイルを作る**: `aws configure --profile <名前>` で、その IAM ユーザーのアクセスキーを `~/.aws/credentials` に保存します（SSO には対応していません）。設定画面の「AWS プロファイル」にその名前を入れます（空の場合は `default`）。
5. **確かめる**: `aws sts get-caller-identity --profile <名前>` で認証情報が使えることを確かめてから、設定画面で保存します。保存するときに、アプリが指定した Guardrail を呼べることを確かめます。

会話の本文は、クロスリージョン推論により APAC のリージョン内（東京・大阪・ソウル・ムンバイ・シンガポール・シドニー）で処理されることがあります。詳しくは [PRIVACY.md](../../PRIVACY.md) を参照してください。

参考（AWS の公式ドキュメント）: [Guardrail を作る](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-components.html)・[クロスリージョン推論の権限](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrail-profiles-permissions.html)・[Guardrail プロファイルとリージョン](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-cross-region-support.html)・[対応言語](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-supported-languages.html)

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

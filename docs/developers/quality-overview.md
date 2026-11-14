# 精度・速度・評価・脆弱性への対応

AI Speak Trace が、精度・速度・評価・脆弱性のそれぞれにどう対応しているかを 1 枚にまとめます。
対応しているものは、使っているサービス・ツール・ライブラリを書きます。対応していないもの・弱いものも、そのまま書きます。

状態の書き方は次のとおりです。

| 状態 | 意味 |
|---|---|
| 対応している | `main` のコードに入っている |
| 一部 | 入っているが、対象が限られる |
| 作業中 | ブランチで作っていて、まだ `main` にない |
| 対応していない | 仕組みがない |

## まとめ

| 観点 | 主な対応 | 足りないもの |
|---|---|---|
| 精度 | ElevenLabs Scribe v2 の話者分離、GiNZA のキーワード抽出、ディープサーチの引用の突き合わせ・別モデルの審査・Guardrails の根拠スコア | 文字起こし・話者分離・要約の精度を数字で測っていない（作業中） |
| 速度 | ffmpeg で長い音声を分割、ディープサーチのプロンプトキャッシュ | 処理時間の計測・ベンチマークがない。分割した音声を 1 つずつ処理している |
| 評価 | ディープサーチの評価の指標、根拠スコアのしきい値の検証、誤りの報告 | 文字起こし・要約の評価がない（作業中）。費用・時間の記録は作業中 |
| 脆弱性 | Guardrails の個人情報・プロンプト攻撃、egress-guard、API トークン、キーチェーン、CSP、Dependabot、コード署名・公証 | 自動アップデートがない。CI の依存の脆弱性検査と actions の SHA 固定は `main` にまだない |

## 1. 精度

| 対象 | 状態 | 何をしているか | 使っているもの |
|---|---|---|---|
| 文字起こし | 対応している | 日本語を指定し、単語ごとの時刻と音のイベント（笑い声など）を付けて文字起こしする | ElevenLabs Scribe v2（`scribe_v2`・`language_code=ja`・`timestamps_granularity=word`・`tag_audio_events`） |
| 話者分離 | 対応している | 文字起こしと同時に話者を分ける。話者名は後から直せる | ElevenLabs Scribe v2 の `diarize` |
| 分割した音声の話者の対応 | 一部 | 長い音声を分けると、話者の番号が部分ごとに振り直される。前の部分の終わりと次の部分の始まりの話者を比べ、必要なら入れ替える（`resolveSpeakerMapping`）。2 人の会話を前提にした推測で、正しさは測っていない | 自前のコード（`chunked-transcription.utils.ts`） |
| キーワード抽出（標準） | 対応している | カタカナ語・英字の略語・複合語を正規表現で拾い、出てきた回数で並べる | 自前のコード（`frontend/src/utils/keywords.ts`） |
| キーワード抽出（ベータ） | 対応している | 日本語の形態素解析で固有名詞・専門用語を拾う。初めて使うときにモデルをダウンロードする | GiNZA（Python。`backend/src/ginza/`） |
| ディープサーチの引用 | 対応している | Claude が根拠に挙げた会話の引用が、実際の発言にあるかを文字列で突き合わせ、ない引用は捨てる（`verifyQuotes`）。統合分析は発言ごとに引用を付けさせる | Claude API の Citations、自前のコード |
| ディープサーチの審査 | 対応している | 分析とは別のモデルが、文ごとに引用で裏付けられているかを判定し、裏付けのない文を除く | `claude-haiku-5-5`（LLM-as-a-Judge） |
| ディープサーチの根拠スコア | 一部 | 英語の文だけ、Web の抜粋に沿っているかを点数にし、`0.8` 未満を「根拠と合わない」とする。日本語の文は審査モデルの判定だけ | Amazon Bedrock Guardrails の contextual grounding check |
| ディープサーチの出典 | 対応している | 公式サイトを優先して検索し、選んだサイト以外の結果はコードで除く | Claude API の `web_search` ツール |
| 要約・会話分析・発言の文脈 | 一部 | 指示を編集でき、要約はモデルを選べる。出力が正しいかは確かめていない | `claude-sonnet-5-5`（要約は `claude-haiku-5-5`・`claude-opus-5-5` も選べる） |

詳しい判定の組み合わせは [ディープサーチの設計](deep-search.md) を見てください。

## 2. 速度

| 対象 | 状態 | 何をしているか | 使っているもの |
|---|---|---|---|
| 長い音声の分割 | 対応している | 10 分（`DEFAULT_CHUNK_DURATION_SEC` = 600 秒）を超える音声を分けて文字起こしする。止まっても、終わっていない部分から再開できる | ffmpeg（`audio-splitter.service.ts`） |
| 分割した音声の処理の順番 | 一部 | 分けた音声を 1 つずつ順に送り、部分の間に 1 秒待つ（`INTER_CHUNK_DELAY_MS`）。並べて送らないため、長い音声ほど時間がかかる | 自前のコード（`chunked-transcription.service.ts`） |
| プロンプトキャッシュ | 一部 | ディープサーチで、会話の文書の最後に `cache_control` を付け、同じ会話を何度も送る段階の費用と時間を抑える。要約・会話分析・発言の文脈には付けていない | Claude API の prompt caching |
| Web 調査の再開 | 対応している | `pause_turn` で止まった Web 調査を最大 3 回まで続ける。一部のキーワードが失敗しても、残りで続ける | Claude API |
| 処理時間の計測 | 一部 | 文字起こしの所要時間はログに出すだけで、保存も集計もしない。Claude の呼び出しの所要時間の記録は作業中（下の「費用と時間の記録」） | なし |
| ベンチマーク | 対応していない | 音声の長さ・機能ごとの処理時間を比べる仕組みがない | なし |

## 3. 評価

### 今あるもの

| 対象 | 状態 | 何をしているか | 使っているもの |
|---|---|---|---|
| ディープサーチの指標 | 対応している | 調査ごとに、引用が付いた文の割合（`citationCoverage`）・裏付けがあった割合（`supportedRate`）・公式サイトの出典の割合（`officialSourceRate`）を返す | 自前のコード（`research.service.ts`） |
| 根拠スコアのしきい値 | 対応している | しきい値 `0.8` は、66 件の主張（正しい主張と、事実を 1 か所変えた主張）で、正解率が最も高かった値（98%）を選んだ | Amazon Bedrock Guardrails |
| 誤りの報告 | 対応している | 利用者が AI の結果の誤りを、この Mac にメモとして残せる。外部には送らない。集計はしていない | 自前のコード（`backend/src/feedback/`） |
| Claude の送受信の記録 | 対応している | Claude への送受信ごとに、Guardrails の確認の結果と、送ったか止めたかを残す（検出した文字列は残さない） | 自前のコード（`claude-audit.store.ts`） |

### 費用と時間の記録（作業中: `feature/claude-usage-cost`）

Claude の呼び出しの記録（`claude-audit.store.ts`）に、次の項目を足します。モデルの ID と単価は `backend/src/claude/models.ts` にまとめます。

| 記録する項目 | 何を入れるか |
|---|---|
| トークン数 | 入力・出力・キャッシュの書き込み・キャッシュの読み込み・Web 検索の回数（応答の `usage` から） |
| 費用の目安 | モデルごとの単価で計算した米ドル。長い入力の単価・米国内の推論の割増・Web 検索の料金を含む。単価の表にないモデルは「不明」 |
| 所要時間 | Claude の呼び出しにかかったミリ秒（Guardrails の確認の時間は含めない） |

- 応答の確認で止めたときも、Claude には課金されているため記録する
- 単価は Anthropic の公式の料金ページから取る。単価が変わったら `models.ts` を直す

### 精度の評価（作業中: `feature/accuracy-eval`）

`backend/src/eval/` に、精度を数字で測る仕組みを作ります。今は、文字の誤り率を比べる前に文をそろえる処理（空白・句読点・記号・音のタグを除き、NFKC でそろえる）のテストを書いたところです。

| 評価すること | 何と比べるか | 指標 | 結果 |
|---|---|---|---|
| 文字起こしの正しさ | 人が直した正解の文 | CER（文字の誤り率） | （評価の後に記入） |
| 話者の取り違え | 人が付けた正解の話者 | 話者を取り違えた発話の割合 | （評価の後に記入） |
| 根拠の確認の正しさ | 正しい主張と、事実を変えた主張 | 審査モデル・根拠スコアの正解率 | （評価の後に記入） |
| 要約のモデルの比較 | 同じ会話を各モデルで要約した結果 | 内容の正しさ・費用の目安・所要時間 | （評価の後に記入） |

## 4. 脆弱性

### アプリ

| 対象 | 状態 | 何をしているか | 使っているもの |
|---|---|---|---|
| 会話の個人情報 | 対応している | Claude に送る前に会話の個人情報を検出し、利用者の選択に沿って伏せる | Amazon Bedrock Guardrails の sensitive information filters |
| Claude への送受信の確認 | 対応している | 送る内容と返ってきた内容を確認し、プロンプト攻撃や個人情報を含むときは送らない・使わない | Amazon Bedrock Guardrails（`PROMPT_ATTACK` を含む） |
| 外への通信 | 対応している | バックエンドから外への通信を、Anthropic・ElevenLabs・AWS の決まった宛先（HTTPS）だけに絞り、記録する | 自前のコード（egress-guard。[外への通信の制限と記録](network-egress.md)） |
| バックエンドの API | 対応している | 起動のたびに作るトークンを、アプリの画面だけが持つ。トークンのないリクエストは受け付けない | 自前のコード（`api-token.ts`。Tauri の sidecar に渡す） |
| API キーの保存 | 対応している | API キーを `settings.json` に平文で置かず、キーチェーンに入れる。値はコマンドの引数に載せない | macOS のキーチェーン（`/usr/bin/security`） |
| ファイルのパス | 対応している | 保存先の外を指す ID・ファイル名では、読み書き・削除をしない | 自前のコード（`safe-path.ts`） |
| 画面に出す AI の回答 | 対応している | Markdown から作った HTML のスクリプト・イベント属性・不許可のリンク先などを取り除いて表示する | `DOMParser` を使った自前のフィルター（`frontend/src/utils/sanitizeHtml.ts`） |
| 画面が読み込めるもの | 対応している | 読み込める先を自分と localhost のバックエンドに絞り、外のスクリプト・iframe を止める。リリース版では Web インスペクタを開けない | Tauri の CSP |
| MCP サーバー | 対応している | データのフォルダを読み、監査ログを書くことだけを許し、外への通信を止めて起動する | macOS の `sandbox-exec`（[MCP サーバーの設計](mcp-server.md)） |
| 自動アップデート | 対応していない | 新しい版は利用者が GitHub Releases から入れ直す。脆弱性を直した版が出ても、古い版を使い続けることがある | なし |

### 依存と配布

| 対象 | 状態 | 何をしているか | 使っているもの |
|---|---|---|---|
| 依存の更新 | 対応している | backend・frontend の npm と src-tauri の cargo の依存を毎週調べ、更新の PR を作る | Dependabot |
| CI の依存の脆弱性検査 | 作業中 | 依存を変えた PR と毎週月曜に、npm（high 以上で失敗）と cargo の依存を調べる。`release/v0.9.1` に入っていて、`main` にはまだない | npm audit、cargo audit（RustSec） |
| actions の SHA 固定 | 作業中 | ワークフローの actions を、タグではなくコミットの SHA で固定し、Dependabot で更新する。`release/v0.9.1` に入っていて、`main` にはまだない | GitHub Actions、Dependabot |
| コード署名・公証 | 対応している | リリースの DMG に署名し、Apple の公証を通す | Apple Developer ID、notarization（[コード署名](code-signing.md)） |
| セキュリティパッチのリリース | 対応している | 依存が DMG に焼き込まれるため、パッチは必ずバージョンを上げてリリースする | GitHub Releases |

### 開発環境

| 対象 | 状態 | 何をしているか | 使っているもの |
|---|---|---|---|
| Claude Code のサンドボックス | 対応している | チーム共通の設定で Bash をサンドボックスの中で動かし、GitHub への操作は決まったスクリプトだけで行う | Claude Code の sandboxing、managed settings（[Claude Code のサンドボックス](claude-code-sandbox.md)） |
| テストを先に書く決まり | 対応している | PR で、実装より前にテストを変えたか、テストを減らしていないかを確かめる | CI の `TDD`（`tdd.yml`） |

## 弱いところ・まだないもの

- 文字起こし・話者分離・要約の精度を数字で測っていない。`feature/accuracy-eval` で作っている
- 処理時間を保存・集計しておらず、ベンチマークもない。Claude の呼び出しの所要時間は `feature/claude-usage-cost` で記録を足す
- 分割した音声を 1 つずつ順に処理しているため、長い音声ほど待ち時間が延びる
- 分割した音声の話者の対応は、境目の話者を比べる推測で、3 人以上の会話は考えていない
- プロンプトキャッシュはディープサーチだけで、要約・会話分析・発言の文脈には付けていない
- 根拠スコアは英語の文だけで、日本語の文は審査モデルの判定だけで扱う
- 誤りの報告は手元に残すだけで、集計して改善につなげる仕組みはない
- 自動アップデートがない
- CI の依存の脆弱性検査と actions の SHA 固定は、`main` にはまだ入っていない

## 参考（公式のドキュメント）

| 内容 | リンク |
|---|---|
| ElevenLabs Speech to Text | https://elevenlabs.io/docs/capabilities/speech-to-text |
| GiNZA | https://megagonlabs.github.io/ginza/ |
| Claude API の Citations | https://platform.claude.com/docs/en/build-with-claude/citations |
| Claude API の prompt caching | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| Claude API の Web search tool | https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool |
| Claude API の料金 | https://platform.claude.com/docs/en/about-claude/pricing |
| Amazon Bedrock Guardrails | https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html |
| Guardrails の contextual grounding check | https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-contextual-grounding-check.html |
| Tauri の CSP | https://v2.tauri.app/security/csp/ |
| Dependabot | https://docs.github.com/en/code-security/dependabot |
| npm audit | https://docs.npmjs.com/cli/commands/npm-audit |
| RustSec（cargo audit） | https://rustsec.org/ |
| GitHub Actions のセキュリティ強化（SHA 固定） | https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions |
| macOS のアプリの公証 | https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution |
| Claude Code の sandboxing | https://code.claude.com/docs/en/sandboxing |

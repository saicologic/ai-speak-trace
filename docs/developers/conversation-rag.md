# 会話を横断して質問する機能（RAG）の設計案

> 状態: **設計案（未実装）**。ユーザーが「ユーザーに決めてほしい点」を決めてから、下の「並行開発のためのインターフェース」に沿って子ブランチで実装する。

保存した複数の会話を横断して、「過去の会話で、○○について話していたのはどこ？ 誰が何と言っていた？」のような質問に答える。回答には根拠の発話を引用として付け、引用を押すとその会話を開いて該当の時刻から音声を再生する。

## 前回の実装の問題のまとめ

以前（v0.6 まで）の会話検索は、ディープサーチの1段として入れ、次の理由で外した。

| # | 前回の問題 | 該当するコミット | 今回の避け方 |
|---|---|---|---|
| 1 | 会話の発話を、**Guardrails も伏せ字も通さずに** Titan に送っていた | 1ce13d3（導入）、#188 の中で削除 | 個人情報チェック済みの会話だけを対象にし、`maskForSending` と同じ伏せ字にしたテキストだけを送る。AI 分析が OFF なら送らない |
| 2 | 検索結果は「関連する発話の一覧」で、答えを出す仕組みがなかった。会話が Claude の入力に収まるため、ディープサーチは全文を渡す方式（506d20c）に作り直し、ベクトル検索は使われなくなった | 506d20c、ea0479f（#188） | 用途を「全文に収まらない量の会話を横断する質問」に絞り、ディープサーチとは別の画面にする（下の「ディープサーチとの使い分け」） |
| 3 | 評価が Python の別の仕組み（`eval/`、uv・MLflow）で、HTTP API を呼んでいたため、API を消したら動かなくなった。CI でも動いていなかった。評価セットは実際の会話から LLM で作っていた | 9004a5a、d5c3a91、ddf7c6b | 評価を TypeScript で backend の jest と同じ場所に置き、検索の関数を直接呼ぶ。CI では偽の埋め込みで毎回動かす。評価用の会話は架空のものをリポジトリに置く |
| 4 | 類似度の下限 0.4・キーワードの加点 0.1・会話ごとの上位5件を、評価の数字なしで決めていた。類似度とキーワードの加点を同じ尺度で足していた | 1ce13d3、79a25bb、325c14d | 順位を Reciprocal Rank Fusion で合わせ（尺度の違う値を足さない）、下限はモデルごとに評価の数字から決める |
| 5 | 発話1つを1単位にしたため、「はい」「そうですね」のような短い発話が上位に来たり、長い発話の中の話題が薄まったりした | 1ce13d3、79a25bb | 短い発話は前後とまとめ、長い発話は文の切れ目で分けたチャンクにする |
| 6 | ベクトルのキャッシュは伏せる前の本文から作り、数値の配列を JSON で保存していた。削除と生成が重なって削除した会話のベクトルが残る不具合もあった | 79a25bb、91bfe10、4190823 | 伏せ字にした本文から作り、チャンクごとのハッシュで古いベクトルを使わない。`wasDeletedSince` で削除と重なった保存を止める。ベクトルは Float32 のバイナリで保存する |
| 7 | PDF 検索のために S3 Vectors を使い、AWS の構成と依存が増えた | 325c14d、85e07ed | ベクトルはローカルにだけ保存する。会話の件数なら全件の総当たりで十分速い（下の「ベクトルの保存」） |
| 8 | ベクトル化に失敗すると、何も示さずキーワード一致に切り替えていた | 1ce13d3 | キーワードだけで検索したときは、画面と応答にそのことを示す（`mode: 'keyword'`） |

## ディープサーチとの使い分け

| | ディープサーチ（`backend/src/research/`） | 会話を横断して質問（この設計） |
|---|---|---|
| 目的 | 選んだ会話に出てきた用語を Web で調べ、解説を作る | 多くの会話の中から、ある話題の発言を探し、誰が何と言ったかを答える |
| 会話の渡し方 | 選んだ会話の**全文**を Claude に渡す | 検索で選んだ**チャンクだけ**を渡す |
| 扱える量 | 合計 `MAX_TRANSCRIPT_CHARS`（30万文字）まで | 保存したすべての会話（上限なし。Claude に渡すのは上位のチャンクだけ） |
| 外部への送信 | Anthropic・Guardrails | Bedrock（埋め込み）・Anthropic・Guardrails |

全文を渡すほうが、検索の取りこぼしがなく正確なため、量が収まる場合はディープサーチ（全文）を使う。1時間の会話はおよそ2万文字になり、15本ほどで30万文字を超える。それより多い会話を横断する質問は全文では渡せないため、検索（RAG）で必要な部分だけを選ぶ。

## 全体の流れ

```
[索引を作る]  会話を選んで「検索できるようにする」
  文字起こし ─→ 個人情報チェック済みか確認 ─→ maskTranscription で伏せる ─→ チャンクに分ける
            ─→ Bedrock で埋め込み ─→ data/utterance-embeddings/ に保存（Float32 + メタデータ）

[質問する]
  質問 ─→ 伏せ字（全対象の会話の「伏せる」の文字列）─→ Bedrock で埋め込み ─→ ベクトルの順位
     └─→ GiNZA（なければ文字の2-gram）で語を取り出す ─→ キーワードの順位（BM25）
  2つの順位を RRF で合わせる ─→ 類似度の下限で足切り ─→ 0件なら「見つからなかった」（Claude は呼ばない）
                            ─→ 上位 N 件のチャンクだけを Claude に渡す（createMessage・Guardrails）
  Claude の引用をチャンクの本文と照合 ─→ 一致しない引用を除く ─→ 回答・引用・検索結果を保存
```

## 検索

### チャンクの単位

発話（`Utterance`。同じ話者の連続した発言）を元にする。

- **短い発話はまとめる**: 本文が `MIN_CHUNK_CHARS`（40文字）に満たない発話は、次の発話と合わせて40文字以上になるまでまとめる（最後のチャンクだけは前とまとめる）。「はい」だけのチャンクを作らないため。ただし `MAX_CHUNK_CHARS` を超えるまではまとめない
- **長い発話は分ける**: `MAX_CHUNK_CHARS`（400文字）を超える発話は、「。」「？」「！」の切れ目で400文字以内に分ける。分けた部分の開始・終了秒は、その部分の単語（`words`）の時刻から取る。400文字は Cohere Embed Multilingual v3 の上限（512トークン）に収まり、話題が1つに絞られる長さとして決めた（評価で 200・400・800 を比べて見直す）
- 空の発話と `audio_event` だけの発話は使わない
- チャンクは次を持つ: `transcriptionId`、発話番号の範囲（`fromUtterance`〜`toUtterance`、分けた場合は `part`）、話者名（複数のこともある）、開始秒・終了秒、伏せ字にした本文、本文のハッシュ
- **埋め込みに送る本文に話者名を入れない**。話者名を変えても埋め込みを作り直さずに済むため。話者名は Claude に渡すときにだけ付ける
- チャンクの作り方を変えたら `CHUNKER_VERSION` を上げ、保存したベクトルを作り直す

### ハイブリッドにした理由

- **ベクトル検索だけでは足りない**: 製品名・略語・人名のような固有の語は、埋め込みでは近い別の語と区別されにくい。また、伏せ字にした語（`[氏名]`）は埋め込みでは探せない
- **キーワード検索だけでは足りない**: 言い換え（「ベクトル検索」と「埋め込みで探す」）が見つからない。よく出る語では無関係な発話が多く混ざる（前回の問題 #4 の元の理由）
- キーワードの検索は**この Mac の中だけ**で、伏せる前の本文に対して行う。人名で質問しても、外部に送らずに該当の発言を見つけられる
- 2つの値（cosine 類似度と BM25 のスコア）は尺度が違うため、足さずに順位だけを **Reciprocal Rank Fusion**（`score = Σ 1 / (k + 順位)`、`k = 60`）で合わせる。前回の「類似度 + 0.1」のような尺度の混ぜ方をしない

キーワード側の語は、GiNZA のキャッシュ（`data/ginza-keywords/`、発話ごとの正規化した語）を使う。GiNZA はベータ機能で入っていないことがあるため、そのときは文字の2-gram で代わりにする。質問文の語も同じ方法で取り出す（GiNZA は子プロセスで、外部に送らない）。

### 類似度の下限

- 足切りは**ベクトルの cosine 類似度**で行う（RRF のスコアは順位から作るため、関係のない質問でも上位は必ず高くなり、足切りに使えない）
- チャンクを候補に残す条件: 類似度が `minSimilarity` 以上、または「質問の語（一般的な語を除く）を含み、かつ類似度が `minSimilarityWithKeyword` 以上」
- 候補が0件なら「見つからなかった」と答え、**Claude は呼ばない**（関係のない発話を渡して、もっともらしい答えを作らせないため）
- 値は**モデルと次元数ごと**に持つ（`RAG_THRESHOLDS`）。モデルが変わると類似度の分布が変わるため
- **決め方**: 評価セットには、答えのある質問と**答えのない質問**（どの会話にも出てこない話題）を入れる。下限を 0.05 刻みで動かし、「答えのある質問の Hit@5 が下限なしの 95% 以上を保つ」中で、答えのない質問を「見つからなかった」にできる割合が最も高い値を選ぶ。`npm run eval:rag` がこの表を出力する
- 実装したばかりの初期値は、前回の Titan で使った 0.4 にし、評価後に置き換える

## 埋め込み

### 候補の比較

東京リージョン（`ap-northeast-1`）で `aws bedrock list-foundation-models --by-output-modality EMBEDDING --profile ai-speak-trace` を実行して、オンデマンドで使えることを確かめた（2026-10-20。モデル一覧の取得だけで、会話のデータは送っていない）。

| | Titan Text Embeddings V2 | Cohere Embed Multilingual v3 | Cohere Embed v4 |
|---|---|---|---|
| モデル ID | `amazon.titan-embed-text-v2:0` | `cohere.embed-multilingual-v3` | `cohere.embed-v4:0` |
| 東京でオンデマンド | ○ | ○ | ○ |
| 次元数 | 256 / 512 / 1024 | 1024（固定） | 256 / 512 / 1024 / 1536 |
| 1件の長さの上限 | 8,192 トークン | 512 トークン | 128K トークン |
| 1回で送れる件数 | 1件 | 96件 | 96件 |
| 文書と質問の区別 | なし | あり（`search_document` / `search_query`） | あり（同左） |
| 日本語 | 多言語対応 | 多言語向けのモデル | 多言語対応 |
| モデルアクセスの手続き | Amazon のモデル | Marketplace での利用の同意が必要 | Marketplace での利用の同意が必要 |
| 料金 | 3つの中で最も安い（金額は実装時に AWS の料金ページで確かめる） | 実装時に確かめる | 実装時に確かめる |
| Hit@1 / Hit@3 / Hit@5 / MRR | （実装後に追記） | （実装後に追記） | （実装後に追記） |
| 決めた下限（`minSimilarity`） | （実装後に追記） | （実装後に追記） | （実装後に追記） |

比べなかったもの: Titan Embeddings G1（V2 の前の版）、Cohere Embed English（英語だけ）、Amazon Nova Multimodal Embeddings と TwelveLabs Marengo（東京では使えず、会話を日本の外のリージョンに送ることになるため）。`global.` から始まる推論プロファイルも、送り先のリージョンを選べないため使わない。

選び方: 3つすべてを `npm run eval:rag` で比べ、Hit@5 と MRR が最も高いものを選ぶ。差が小さい（MRR で 0.03 未満）なら、索引を作る速さ（1回で96件送れる Cohere が有利）と料金で選ぶ。評価の前の初期値は **Cohere Embed v4（1024次元）** を勧める（下の「ユーザーに決めてほしい点」1）。

### 送るテキストと伏せ字

- **個人情報チェックをまだしていない会話は対象にしない**（`readPrivacyScan` が `null` の会話は索引を作らない。画面には「個人情報チェックがまだ」と示す）
- 送る本文は、`PrivacyService.maskForSending` と同じ方法（`maskTranscription(transcription, scan.findings)`）で伏せ字にしたチャンクの本文。DI に依存しない形で使うため、MCP ブランチの `readPrivacyScan` と既存の `maskTranscription`（`privacy.utils.ts`）を組み合わせる
- 「要確認」のまま（`mask: false`・`needsReview: true`）の文字列は、ディープサーチと同じく伏せずに送る。画面に件数を示す（下の「ユーザーに決めてほしい点」4）
- **質問文も伏せる**: 対象のすべての会話の「伏せる」の文字列（`mask: true`）で `maskText` をかけてから送る。会話の側が `[氏名]` になっているため、質問の側もそろえないと近さが測れない
- 埋め込みのための Bedrock の呼び出しには ApplyGuardrail を通さない。送る本文は、すでに Guardrails で検出した結果で伏せたものであり、埋め込みのモデルは指示に従わない（プロンプト攻撃の対象にならない）ため。二重に確認すると Guardrails の料金が倍になる
- 設定画面の「AI 分析を使う」が OFF なら、Bedrock にも送らない（`isAiAnalysisEnabled()`）。キーワードだけの検索は使える（外部に送らないため）
- 認証情報は `awsCredentials()`（`backend/src/aws/aws-credentials.ts`）、リージョンは Guardrails と同じ `AWS_REGION`（既定 `ap-northeast-1`）を使う。`@aws-sdk/client-bedrock-runtime` はすでに依存にある

## ベクトルの保存

`UtteranceEmbeddingStore`（`backend/src/transcription/utterance-embedding-store.service.ts`。今は使われていない）を作り直す。保存先は今と同じ `data/utterance-embeddings/` にする（PRIVACY.md の一覧と削除の手順をそのまま使えるため）。

- 会話ごとに2つのファイル: `<transcriptionId>.json`（メタデータ）と `<transcriptionId>.f32`（Float32 のベクトルを並べたバイナリ）
- メタデータ: `formatVersion: 2`、`modelId`、`dimensions`、`chunkerVersion`、チャンクの一覧（ID・発話番号の範囲・開始/終了秒・本文のハッシュ）。本文そのものは保存しない（文字起こしと「伏せる」の選択から作り直せるため）
- **作り直す条件**: `modelId`・`dimensions`・`chunkerVersion` のどれかが今の設定と違う → 全部作り直す。チャンクの本文のハッシュが違う → そのチャンクだけ作り直す
- 以前の形式（`formatVersion` がない v0.6 までのもの。伏せずに作ったベクトル）は、読み込むときに削除する
- 大きさ: 1時間の会話（約2万文字）でおよそ 60 チャンク、1024 次元で約 240KB。100 本でも 24MB で、全件の総当たりの計算は数十ミリ秒で済む。S3 Vectors などは使わない
- 書き込みは一時ファイルから置き換える（今と同じ）。保存の前に `wasDeletedSince` で、作っている間に会話が削除されていないかを確かめる（前回の 4190823 と同じ問題を防ぐ）

### 消す・作り直すとき

| 出来事 | すること | 担当する場所 |
|---|---|---|
| 会話の削除 | ベクトルを削除する | 今の `TranscriptionStoreService.delete` が呼んでいる `UtteranceEmbeddingStore.delete` をそのまま使う |
| 話者名の変更 | 埋め込みの本文に話者名を入れないため、そのままでは作り直さない。話者名の変更で個人情報チェックがやり直され（`rescanIfChecked`）、伏せる文字列が変われば下の行と同じ | — |
| 「伏せる」の選択の変更・個人情報チェックのやり直し | 本文のハッシュが変わったチャンクのベクトルを消し、索引済みの会話ならその部分だけ作り直す | `PrivacyService` に「検出結果が変わった」ことを知らせる仕組み（`onFindingsChanged`）を足し、ストアが受け取る（モジュールの循環を避けるため、`PrivacyService` からストアを直接呼ばない） |
| 埋め込みのモデル・次元数の変更 | 全部作り直す（検索のときに古いものは使わない） | ストアの読み込み |

検索のときにも、今の本文のハッシュと合わないチャンクのベクトルは使わない。知らせが届かなかった場合でも、古い本文から作ったベクトルで答えないため。

## 回答

- Claude には、足切りを通った上位 `ANSWER_CHUNKS`（8件）のチャンクだけを渡す。各チャンクには番号・会話名・話者名・時刻を付ける（本文は伏せ字にしたもの）
- 呼び出しは `ClaudeClientService.createMessage`（Guardrails の確認・AI 倫理の指示・監査ログは今と同じ）。`purpose: 'rag-answer'`、チャンクの本文と質問文は `untrusted` に渡す。モデルは `CLAUDE_MODEL`
- Claude には JSON で答えさせる: 要点（`points`）ごとに、本文と根拠の引用（チャンク番号と、チャンクの本文からそのまま抜き出した文字列）
- **引用の照合**: `verifyQuotes` と同じ考え方で、`normalize` した引用が、指定したチャンクの `normalize` した本文に含まれるかを確かめる。含まれない引用は出さない。チャンクの中のどの発話に含まれるかを探し、その発話の番号と開始秒を引用に付ける（クリックで再生する位置）
- 根拠の引用が1つも残らなかった要点は、本文から除き「根拠を確認できなかった内容」として分けて示す（ディープサーチと同じ見せ方）
- 回答の保存: `data/rag-answers/<id>.json` に、質問・回答・引用・検索結果を保存する。`transcriptionIds` を持たせ、`DERIVED_LOG_DIRS` に `rag-answers` を足して、会話を削除したら一緒に消す
- 監査ログ: `ClaudeAuditRecord` に省略できる `retrieval` を足し、`CreateMessageOptions.retrieval` で渡す。中身は**会話の内容を含まない** ID と数値だけ: 埋め込みのモデル・次元数、検索の方式（`hybrid` / `keyword`）、チャンクごとの順位（ベクトル・キーワード・RRF）と類似度、Claude に渡したチャンクの ID と順位、引用の照合で残した数と除いた数。今の監査ログと同じく月ごとの `claude-audit-logs/YYYY-MM.jsonl` に入る。「見つからなかった」で Claude を呼ばなかったときは、監査ログには記録しない（監査ログは Claude の呼び出しの記録のため）。回答の保存には残す

## 画面

- 左の「ディープサーチ」の下に「会話を横断して質問」のボタンを置き、`page = 'conversation-qa'` に切り替える。AI 分析が OFF のときは、ディープサーチと同じく押せない（ただし、キーワードだけの検索を許すかは「ユーザーに決めてほしい点」5 で決める）
- 画面の上: 対象の会話の一覧（会話名・個人情報チェックの状態・「要確認」の件数・索引の状態）。チェックを入れた会話について「検索できるようにする」を押すと索引を作る。送る先（Amazon Bedrock、東京リージョン）と送る内容（伏せ字にした発言）をボタンの近くに書く
- 画面の中: 質問の入力欄と「質問する」ボタン
- 画面の下: 回答。要点ごとに引用（「〜」 Aさん 会話名 12:34）を並べ、押すとその会話を開いて該当の発話までスクロールし、その時刻から再生する。`AiGeneratedNotice`（`basis="引用した元の発言"`、`model`、`warnings`）と `FeedbackButton` を付ける。キーワードだけで検索したときは、そのことを示す
- 「見つからなかった」ときは、その旨と、索引のない会話・個人情報チェックがまだの会話の数を示す
- 引用を押したときの動き: `App.tsx` の `handleOpenFromResearch(id, utteranceIndex)` を元に、開いた後に `audioRef.current.currentTime = start` にして `play()` する関数（`handleOpenAndPlay`）を足す

## MCP との関係

- 検索の処理（チャンク・キーワードの順位・ベクトルの順位・RRF・下限）は `backend/src/rag/core/` に、NestJS に依存しない関数として置く。依存するもの（会話の読み込み・埋め込み・ベクトルの読み書き）は引数（`RagSearchDeps`）で受け取る
- MCP（`feature/mcp-server`）の `listTranscriptionIds`・`readTranscriptionFile`・`readPrivacyScan`・`readGinzaKeywordCache` を `RagCorpusReader` に合わせて使う。NestJS 側も同じ読み込み関数を使い、二重に実装しない
- MCP の `search_utterances` は、`searchUtterances(deps, { ..., mode })` を呼ぶ形に差し替えられる。MCP は読み取り専用のため、**新しいベクトルは作らない**（`buildMissing: false`）。質問文を Bedrock に送るかは「ユーザーに決めてほしい点」5 で決める（推奨は `mode: 'keyword'` で送らない）

## 評価

- 置き場所: `backend/src/rag/eval/`。jest の `*.spec.ts` と同じ場所に置き、CI でも動かす
- 評価用の会話: **架空の会話 4 本**（例: 開発の雑談、料理、旅行の計画、本の感想）。1本 40〜80 発話、2人の話者。実在の人名・会社名・実データを使わない。言い換え・人名の伏せ字・会話をまたぐ話題を含める
- 質問: 20 問程度。答えのある質問 16 問（言い換えで聞くもの、話者を聞くもの、2つの会話にまたがるものを含める）と、答えのない質問 4 問。正解は「会話 ID と発話番号の一覧」で持つ
- 指標: Hit@k（k=1,3,5。上位 k 件のチャンクの発話の範囲に、正解の発話が1つでも入っていれば 1）と MRR（最初に当たった順位の逆数の平均）。答えのない質問は「見つからなかった」にできた割合を別に出す
- CI: 外部の API を呼ばない。`createFakeEmbedder`（文字の2-gram を決まった次元に振り分けて正規化する。同じ入力には必ず同じベクトルを返す）で検索を通しで動かし、Hit@5 と MRR が決めた値を下回らないことを確かめる（検索の部品を直したときの退行を見つけるため）
- ローカル: `npm run eval:rag -- --model cohere.embed-v4:0 --dimensions 1024`。実際の Bedrock を `AWS_PROFILE`（開発では `ai-speak-trace`）で呼ぶ。**送るのは架空の評価用の会話だけ**。結果を `docs/developers/rag-eval/<日付>-<モデル>-<次元数>.json` に保存し、`docs/developers/rag-eval-results.md` の表に1行足す。同じモデルの前回の結果との差を表示する。下限の候補の表（「類似度の下限」）も出力する
- 評価のファイルは `backend/tsconfig.build.json` で除き、DMG に入れない

## 並行開発のためのインターフェース

### 進め方

1. `feature/rag-search-core` が**最初のコミットで `backend/src/rag/core/types.ts` をこの文書のとおりに作ってプッシュする**。ほかのブランチはそのコミットから作る（型を先に固めて、並べて実装するため）
2. 宛先はすべて `release/vX.Y.Z` から作る `feature/rag`（統合ブランチ）。マージの順は search-core → embedding・embedding-store・eval（順不同）→ answer → ui
3. `feature/rag-ui` は API の型（下の「API」）で作り、API の関数は vitest の `vi.mock` で差し替えて動かす。answer がマージされるのを待たずに進められる

### モジュールの配置とブランチの持ち分

| ブランチ | 新しく作るファイル | 直す既存のファイル |
|---|---|---|
| `feature/rag-search-core` | `backend/src/rag/core/types.ts`、`chunking.ts`、`keyword-rank.ts`、`vector-rank.ts`、`fusion.ts`、`thresholds.ts`、`search.ts`、`fake-embedder.ts` と各 `*.spec.ts` | なし |
| `feature/rag-embedding` | `backend/src/rag/embedding/embedding-models.ts`、`bedrock-embedder.ts`、`masking.ts` と各 `*.spec.ts` | `PRIVACY.md`、`backend/package.json`（`eval:rag` のスクリプト。依存を足す場合も） |
| `feature/rag-embedding-store` | `backend/src/rag/store/embedding-index-file.ts`、`*.spec.ts` | `backend/src/transcription/utterance-embedding-store.service.ts`（と spec）、`backend/src/privacy/privacy.service.ts`（`onFindingsChanged` を足すだけ） |
| `feature/rag-eval` | `backend/src/rag/eval/`（`fixtures/`、`metrics.ts`、`rag-eval.spec.ts`、`run-rag-eval.ts`）、`docs/developers/rag-eval-results.md`、`docs/developers/rag-eval/` | `backend/tsconfig.build.json`（`src/rag/eval` を除く） |
| `feature/rag-answer` | `backend/src/rag/answer/rag-answer.utils.ts`（照合）、`rag-answer.prompt.ts`、`rag-answer.store.ts`、`backend/src/rag/rag.service.ts`、`rag.controller.ts`、`rag.module.ts`、`types/rag.types.ts` と各 spec | `backend/src/app.module.ts`、`backend/src/claude/claude-audit.store.ts`（`retrieval`）、`backend/src/claude/claude-client.service.ts`（`retrieval` を渡すだけ）、`backend/src/transcription/derived-log-cleaner.service.ts`（`rag-answers`） |
| `feature/rag-ui` | `frontend/src/components/ConversationQaPage.tsx`・`.css`、`frontend/src/components/__tests__/ConversationQaPage.test.tsx`、`frontend/src/types/rag.ts` | `frontend/src/App.tsx`、`frontend/src/api/client.ts` |

PRIVACY.md と `backend/package.json` を直すのは `feature/rag-embedding` だけにする。PRIVACY.md には、外部に送るデータの表（Bedrock の埋め込み: 伏せ字にした発言と質問文。Anthropic: 選んだチャンクと質問文）、保存するデータ（`utterance-embeddings/` の説明の更新、`rag-answers/`）、削除の表を足す。

### 型（`backend/src/rag/core/types.ts`）

```ts
import type { Transcription } from '../../transcription/types/transcription.types';
import type { PrivacyScan } from '../../privacy/privacy.types';

/** チャンクの作り方の版。変えたら保存したベクトルを作り直す */
export const CHUNKER_VERSION = 1;

/** 検索の単位（短い発話は前後とまとめ、長い発話は文の切れ目で分ける） */
export interface RagChunk {
  /** `${transcriptionId}:${fromUtterance}-${toUtterance}`（分けた場合は `:p${part}` を付ける） */
  id: string;
  transcriptionId: string;
  /** 発話番号の範囲（transcription.utterances の添字。両端を含む） */
  fromUtterance: number;
  toUtterance: number;
  /** 長い発話を分けた場合の番号（0 始まり）。分けていなければ undefined */
  part?: number;
  /** チャンクに含まれる話者名（出てきた順。伏せ字にしたもの） */
  speakerNames: string[];
  /** 開始・終了（秒） */
  start: number;
  end: number;
  /** 伏せ字にした本文（埋め込みに送る。話者名は含めない） */
  text: string;
  /** 話者名付きの本文（Claude に渡す。「Aさん: 〜」を改行でつなぐ） */
  textWithSpeakers: string;
  /** text のハッシュ（sha256 の16進）。変わったらベクトルを作り直す */
  textHash: string;
}

/** 埋め込みの入力の種類（Cohere は文書と質問で作り方を変える） */
export type EmbeddingInputType = 'document' | 'query';

/** 埋め込みを作るもの（Bedrock・評価用の偽物） */
export interface Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  /** 長さが 1 の（正規化した）ベクトルを、入力と同じ順で返す */
  embed(texts: string[], inputType: EmbeddingInputType): Promise<Float32Array[]>;
}

/** 1つの会話の保存したベクトル */
export interface EmbeddingIndex {
  formatVersion: 2;
  transcriptionId: string;
  modelId: string;
  dimensions: number;
  chunkerVersion: number;
  createdAt: string;
  /** チャンクの ID と本文のハッシュ（vectors と同じ順） */
  chunks: { id: string; textHash: string }[];
  vectors: Float32Array[];
}

/** ベクトルの読み書き（ローカルのファイル。テストではメモリ上） */
export interface EmbeddingIndexStore {
  read(transcriptionId: string): Promise<EmbeddingIndex | null>;
  /** startedAt より後に会話が削除されていたら保存せず false を返す */
  write(index: EmbeddingIndex, startedAt: string): Promise<boolean>;
  delete(transcriptionId: string): Promise<void>;
}

/** 会話の読み込み（MCP の読み込み関数をこの形に合わせる） */
export interface RagCorpusReader {
  listTranscriptionIds(): Promise<string[]>;
  readTranscription(id: string): Promise<Transcription | null>;
  readPrivacyScan(id: string): Promise<PrivacyScan | null>;
  /** GiNZA のキャッシュの発話ごとの正規化した語。GiNZA がなければ null */
  readKeywordTerms(id: string): Promise<string[][] | null>;
  /** 質問文から語を取り出す。GiNZA がなければ null（文字の2-gram を使う） */
  extractQueryTerms?(query: string): Promise<string[] | null>;
}

/** 類似度の下限（モデルと次元数ごと。評価で決める） */
export interface RagThreshold {
  minSimilarity: number;
  minSimilarityWithKeyword: number;
}

export type RagSearchMode = 'hybrid' | 'keyword';

export interface RagSearchRequest {
  query: string;
  /** 対象の会話（省略するとすべて） */
  transcriptionIds?: string[];
  /** 返す件数（既定 8） */
  limit?: number;
  /** hybrid: ベクトルとキーワード。keyword: 外部に送らずキーワードだけ */
  mode: RagSearchMode;
  /** 索引のない・古いチャンクのベクトルを作るか（MCP では false） */
  buildMissing: boolean;
}

export interface RagSearchHit {
  chunk: RagChunk;
  /** RRF で合わせた順位（1 始まり）とスコア */
  rank: number;
  rrfScore: number;
  /** ベクトルの順位・cosine 類似度（keyword のとき・ベクトルがないときは undefined） */
  vectorRank?: number;
  similarity?: number;
  /** キーワードの順位・BM25 のスコア（質問の語を含まなければ undefined） */
  keywordRank?: number;
  keywordScore?: number;
}

/** 対象から外した会話と理由 */
export interface RagExcluded {
  transcriptionId: string;
  reason: 'privacy_unchecked' | 'not_indexed' | 'stale_index' | 'not_found';
}

export interface RagSearchResult {
  mode: RagSearchMode;
  /** hybrid で使ったモデル（keyword のときは undefined） */
  modelId?: string;
  dimensions?: number;
  threshold?: RagThreshold;
  hits: RagSearchHit[];
  /** 下限を超えたチャンクがなかった */
  notFound: boolean;
  excluded: RagExcluded[];
}

export interface RagSearchDeps {
  corpus: RagCorpusReader;
  /** keyword のときは使わない（なくてもよい） */
  embedder?: Embedder;
  indexStore: EmbeddingIndexStore;
  /** 今の時刻（テストで固定する） */
  now?: () => Date;
}
```

### 関数のシグネチャ

```ts
// feature/rag-search-core（backend/src/rag/core/）
export const MIN_CHUNK_CHARS = 40;
export const MAX_CHUNK_CHARS = 400;
export const RRF_K = 60;
export const DEFAULT_LIMIT = 8;
/** maskedTranscription は transcription に maskTranscription をかけたもの（発話の数と順は同じ） */
export function buildChunks(transcription: Transcription, maskedTranscription: Transcription): RagChunk[];
export function rankByKeywords(queryTerms: string[], chunks: RagChunk[], chunkTerms: string[][]): { chunkId: string; score: number }[];
export function charBigrams(text: string): string[];
export function rankByVector(query: Float32Array, index: EmbeddingIndex): { chunkId: string; similarity: number }[];
export function reciprocalRankFusion(rankings: string[][], k?: number): { id: string; score: number }[];
export const RAG_THRESHOLDS: Record<string, RagThreshold>; // キーは `${modelId}@${dimensions}`
export function thresholdFor(modelId: string, dimensions: number): RagThreshold;
export function searchUtterances(deps: RagSearchDeps, request: RagSearchRequest): Promise<RagSearchResult>;
export function createFakeEmbedder(dimensions?: number): Embedder;

// feature/rag-embedding（backend/src/rag/embedding/）
export interface EmbeddingModelSpec { modelId: string; dimensionsOptions: number[]; maxChars: number; batchSize: number; supportsInputType: boolean; }
export const EMBEDDING_MODELS: Record<string, EmbeddingModelSpec>;
export const DEFAULT_EMBEDDING_MODEL: { modelId: string; dimensions: number };
/** AI 分析が OFF なら embed で例外を投げる */
export function createBedrockEmbedder(options: { modelId: string; dimensions: number; region?: string }): Embedder;
/** 個人情報チェックがまだなら null（対象にしない） */
export function maskForEmbedding(transcription: Transcription, scan: PrivacyScan | null): Transcription | null;
/** 対象の会話の「伏せる」の文字列で質問文を伏せる */
export function maskQuery(query: string, scans: PrivacyScan[]): string;

// feature/rag-embedding-store（backend/src/rag/store/）
export function createFileIndexStore(dataDir: string): EmbeddingIndexStore;
/** 今のチャンクと合わないベクトル（ハッシュ違い・モデル違い）を除いた索引を返す */
export function pruneStale(index: EmbeddingIndex, chunks: RagChunk[], modelId: string, dimensions: number): EmbeddingIndex | null;
// UtteranceEmbeddingStore（Nest のラッパー）は createFileIndexStore を使い、delete(id) の形は今のまま残す

// feature/rag-eval（backend/src/rag/eval/）
export function hitAtK(rankedChunks: RagChunk[], gold: { transcriptionId: string; utterances: number[] }[], k: number): 0 | 1;
export function reciprocalRank(rankedChunks: RagChunk[], gold: { transcriptionId: string; utterances: number[] }[]): number;

// feature/rag-answer（backend/src/rag/answer/）
/** 引用をチャンクの本文と照合し、一致したものだけに発話番号と開始秒を付ける */
export function verifyCitations(raw: RawCitation[], chunks: RagChunk[], maskedTranscriptions: Map<string, Transcription>): RagCitation[];
```

### API

すべて `backend/src/rag/rag.controller.ts`（`/api/rag`）。

```ts
// GET /api/rag/status
interface RagStatusResponse {
  aiEnabled: boolean;
  guardrailConfigured: boolean;
  embeddingModel: { modelId: string; dimensions: number };
  conversations: {
    transcriptionId: string;
    audioFileName: string;
    createdAt: string;
    privacy: 'unchecked' | 'checked';
    /** 「要確認」のまま伏せずに送る文字列の数 */
    needsReviewCount: number;
    index: 'none' | 'ready' | 'stale' | 'building' | 'error';
    chunkCount: number;
    error?: string;
  }[];
}

// POST /api/rag/index  { transcriptionIds: string[] }  → 202 RagStatusResponse（作るのは裏で行い、status を読み直して進み具合を見る）
// DELETE /api/rag/index/:transcriptionId → 204

// POST /api/rag/ask
interface RagAskRequest {
  question: string;          // 1〜500文字
  transcriptionIds?: string[]; // 省略すると索引のあるすべての会話
}
interface RagCitation {
  id: string;                // 'c1' など。points から参照する
  transcriptionId: string;
  audioFileName: string;
  chunkId: string;
  utteranceIndex: number;    // 再生・スクロールの位置
  speakerName: string;
  start: number;             // 秒
  quote: string;             // 照合できた引用（伏せ字のまま）
}
interface RagAnswerResponse {
  id: string;
  createdAt: string;
  question: string;
  status: 'answered' | 'not_found';
  mode: 'hybrid' | 'keyword';
  points: { text: string; citationIds: string[] }[];
  /** 根拠の引用を確認できなかった要点 */
  unsupported: string[];
  citations: RagCitation[];
  /** Claude に渡したチャンク（順位つき） */
  retrieved: { chunkId: string; transcriptionId: string; rank: number; similarity?: number; keywordRank?: number; vectorRank?: number }[];
  excluded: { transcriptionId: string; reason: string }[];
  model?: string;            // Claude のモデル（not_found では undefined）
  embeddingModel?: string;
  warnings: ContentWarning[];
}

// GET /api/rag/answers → { id, createdAt, question, status }[]
// GET /api/rag/answers/:id → RagAnswerResponse
```

`frontend/src/types/rag.ts` は、上の `RagStatusResponse`・`RagAskRequest`・`RagCitation`・`RagAnswerResponse` を同じ形で書く。`frontend/src/api/client.ts` に `fetchRagStatus`・`buildRagIndex`・`deleteRagIndex`・`askRag`・`fetchRagAnswers`・`fetchRagAnswer` を足す。

### テストの書き方

- backend: 今と同じく、関数ごとに同じフォルダの `*.spec.ts`。`core/` は DI がないため、`createFakeEmbedder` とメモリ上の `EmbeddingIndexStore` で通しのテストを書く
- frontend: `frontend/src/components/__tests__/ConversationQaPage.test.tsx`。`PrivacyPanel.test.tsx` と同じく `vi.mock('../../api/client')` で API を差し替え、`render`・`screen`・`waitFor` で確かめる（「見つからなかった」の表示、引用を押したときに `onOpenAndPlay(transcriptionId, utteranceIndex, start)` が呼ばれること、AI 分析が OFF のときの表示、`AiGeneratedNotice` が出ること）

## ユーザーに決めてほしい点

1. **埋め込みモデルの初期値**: 推奨は **Cohere Embed v4（1024次元）**。多言語の検索向けで、文書と質問を区別でき、1回で96件送れるため索引を早く作れる。ほかに Titan Text Embeddings V2（最も安い。Amazon のモデルで手続きがいらない）、Cohere Embed Multilingual v3。どれでも評価で3つを比べて最終的に決める。Cohere を使うには、AWS アカウント（`ai-speak-trace`）で Marketplace の利用の同意が必要
2. **索引を作るタイミング**: 推奨は「画面で会話を選んで『検索できるようにする』を押したときだけ作る」（何を Bedrock に送るかを利用者が決められる）。一度作った会話は、伏せる文字列が変わったときに自動で作り直す。ほかに「質問したときに、索引のない会話を自動で作る」
3. **個人情報チェックがまだの会話**: 推奨は「対象にせず、この画面からも個人情報チェックを実行できるボタンを置く」（PRIVACY.md の Guardrails に送るときに「会話を横断して質問で、チェックを押したとき」を足す）。ほかに「対象にしないだけにし、チェックはディープサーチの画面で行う」
4. **「要確認」が残っている会話**: 推奨は「ディープサーチと同じく、伏せずに送り、画面に件数を示す」。ほかに「『要確認』がなくなるまで対象にしない」（安全だが、氏名の誤検出が多いため、ほとんどの会話が対象から外れる）
5. **MCP の `search_utterances` と、AI 分析が OFF のとき**: 推奨は「MCP はキーワードだけで検索し、質問文を Bedrock に送らない（すでにあるベクトルも使わない）。アプリの画面でも、AI 分析が OFF のときはキーワードだけの検索結果（引用の一覧。Claude の回答なし）を出す」。ほかに「MCP でも質問文を Bedrock に送ってハイブリッドで検索する」「AI 分析が OFF なら画面ごと使えなくする」
6. **質問の履歴**: 推奨は「`data/rag-answers/` に保存し、画面で見返せるようにする（使った会話を削除したら一緒に消す）」。ほかに「保存せず、監査ログ（会話の内容を含まない）だけを残す」
7. **次元数**: 推奨は 1024。512 にするとファイルの大きさが半分になるが、評価で精度が下がらないことを確かめてから選ぶ

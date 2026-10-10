# RAG 評価基盤

ディープサーチの PDF 検索（RAG）を、評価セットを使って数値で評価するための Python ツールです。
チャンク分割・検索方法・プロンプトを変えたときに「良くなったのか」を同じ物差しで比較できます。

## 評価の流れ

```
S3 Vectors のチャンク ──(Claude)──> 評価セット（質問・模範解答・根拠・キーワード）
                                          │
                     起動中のバックエンド API ─┤ POST /api/deep-search（PDFのみ）
                                          │ POST /api/deep-search/analyze
                                          ▼
                      検索指標（Hit@k / Recall@k / MRR） + Ragas（LLM-as-a-Judge）
                                          ▼
                              results/ と MLflow に記録
```

バックエンドの API を外から呼ぶため、評価対象のブランチを切り替えても、同じ評価セット・同じスクリプトで改善前後を比べられます。

## 評価指標

| 区分 | 指標 | 内容 | 使うもの |
|---|---|---|---|
| 会話検索 | conversation_recall | 根拠の発話を検索結果に含められたか | 自前実装 |
| 会話検索 | conversation_precision | 会話の検索結果のうち、根拠を含む発話の割合 | 自前実装 |
| 会話検索 | conversation_mrr / conversation_hit@k | 根拠を含む発話が何番目に来るか（PDF 検索の MRR / Hit@k と同じ計算） | 自前実装 |
| 検索 | Hit@k | 上位 k 件に正解の根拠を含むチャンクがあるか | 自前実装 |
| 検索 | Recall@k | 上位 k 件で見つかった根拠の割合 | 自前実装 |
| 検索 | MRR | 最初に正解が現れる順位の逆数の平均 | 自前実装 |
| 検索 | Context Precision | 模範解答に役立つチャンクが上位にあるか | Ragas |
| 検索 | Context Recall | 模範解答の内容を検索結果でどれだけカバーできたか | Ragas |
| 生成 | Faithfulness | 分析結果の主張が検索結果に裏付けられているか（ハルシネーションの少なさ） | Ragas |

正解の判定はチャンク ID ではなく「根拠の原文抜粋が検索結果に含まれるか」で行います。
そのため、チャンクサイズを変えても評価セットを作り直す必要がありません。

## セットアップ

[uv](https://docs.astral.sh/uv/) が必要です。

```bash
cd eval
uv sync
```

API キーと接続先は次の順で読み込みます。

| 設定 | 取得元 |
|---|---|
| Anthropic API キー | 環境変数 `ANTHROPIC_API_KEY`、なければアプリの `settings.json` |
| S3 Vectors | 環境変数 `S3_VECTORS_BUCKET`（必須）・`S3_VECTORS_INDEX`・`AWS_REGION`（バックエンドと同じ） |
| AWS 認証情報 | boto3 の標準の解決順（環境変数・`~/.aws` など） |

## 使い方

### 1. 評価セットを作る

評価セットは「会話から作る」方法と「PDF から作る」方法の2種類があります。

#### 会話（文字起こし）から作る

```bash
uv run python -m rag_eval.generate_conversation_testset \
  --transcription-id <文字起こしID> --size 10 --output datasets/<名前>.jsonl
```

文字起こし全文を Claude に読ませ、会話から答えられる問題を作ります。
根拠が発話と一字一句一致しない問題や、会話に出てこないキーワードは自動で捨てます。
評価時は、その会話をディープサーチの検索対象にします。

#### PDF から作る

アプリで PDF をアップロードしてから実行します。

```bash
uv run python -m rag_eval.generate_testset --size 30 --output datasets/testset.jsonl
```

チャンクをランダムに選び、Claude が「そのチャンクだけで答えられる質問・模範解答・根拠の抜粋・検索キーワード」を作ります。
根拠が原文と一字一句一致しない問題は自動で捨てます。
**生成後は必ず中身を目で確認し、不自然な問題を修正・削除してください。**
形式は [datasets/sample.jsonl](datasets/sample.jsonl) を参照してください。

> 実際の PDF から作った評価セットは資料の内容を含むため、`.gitignore` でコミット対象から外しています。

### 2. バックエンドを起動する

```bash
cd backend
npm run start
# 出力される PORT=xxxxx を控える
```

### 3. 評価を実行する

```bash
uv run python -m rag_eval.run_eval \
  --api-url http://127.0.0.1:<PORT>/api \
  --testset datasets/testset.jsonl \
  --label baseline
```

| オプション | 内容 |
|---|---|
| `--label` | 評価対象の名前。MLflow の run 名と結果フォルダ名になる |
| `--include-web` | 会話の問題で Web 検索も行う |
| `--include-pdfs` | 会話の問題で PDF 検索も行う |
| `--reuse-search PATH` | 前回の `results/<実行>/search_results.jsonl` の検索結果を使い回す。Web 検索は毎回結果が変わるため、分析（生成）の変更だけを比べたいときに使う。検索条件（キーワード・文字起こしID・検索対象）が今回と異なる問題は検索し直す |
| `--retrieval-only` | 検索指標だけを計算する（Claude を呼ばないので無料・高速） |
| `--limit N` | 先頭 N 問だけ評価する（動作確認用） |
| `--model` | LLM-as-a-Judge に使う Claude モデル（既定: `claude-opus-5-5`） |
| `--ks` | Hit@k / Recall@k の k（既定: `1,3,5,10`） |

### 4. 結果を比較する

```bash
uv run mlflow ui
```

ブラウザで開き、実験 `deep-search-rag` の run を選んで比較します。
採点（LLM-as-a-Judge）に使ったトークン数と概算費用（`judge_cost_usd`）も記録されます。費用はキャッシュの書き込み・読み取りを別の単価で計算し、料金表にないモデルでは `null` になります。
バックエンド側（ディープサーチの Web 検索・分析）の費用は含まれないため、[Claude Console](https://platform.claude.com/cost) で確認してください。
各 run の `per_case.csv` には問題ごとのスコアがあり、どの質問で失敗したかを分析できます。

## テスト

```bash
uv run pytest
```

## 実装メモ

Ragas の Anthropic 向け既定設定（強制ツール呼び出し・`temperature` / `top_p` の指定）は現行の Claude では 400 エラーになります。
[`rag_eval/judge.py`](rag_eval/judge.py) で Instructor を JSON モードに切り替え、サンプリング系のパラメータを外しています。

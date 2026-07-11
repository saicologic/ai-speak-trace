# Ragas RAG 評価スクリプト

会話分析の回答品質を [Ragas](https://docs.ragas.io/) で評価するスクリプトです。

## 評価指標

| 指標 | 説明 |
|------|------|
| **Faithfulness** | 回答がソース（Web検索結果）に基づいているか（0.0〜1.0） |
| **Answer Relevancy** | 回答が質問に答えているか（0.0〜1.0） |

## セットアップ

Python 3.9 以上が必要です。

```bash
cd scripts/ragas_eval
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 使い方

### 1. 評価データをエクスポート

アプリを起動した状態で、会話分析を実行済みのログIDを使ってデータを取得します。

```bash
curl http://localhost:<port>/api/interview/logs/<log-id>/ragas-export > data.json
```

### 2. 評価を実行

```bash
export ANTHROPIC_API_KEY="your-api-key"
python evaluate.py --input data.json --output result.json
```

### 3. 結果を確認

```json
{
  "faithfulness": 0.85,
  "answer_relevancy": 0.92,
  "samples": [
    {
      "question": "LLMとは何ですか？",
      "faithfulness": 0.8,
      "answer_relevancy": 0.9
    }
  ]
}
```

## スコアの目安

| スコア | 評価 |
|--------|------|
| 0.85 以上 | 良好 |
| 0.70〜0.84 | 改善の余地あり |
| 0.70 未満 | 要対応 |

"""
Ragas による RAG 評価スクリプト

使い方:
  python evaluate.py --input data.json [--output result.json]

入力 JSON 形式（バックエンドの GET /api/interview/logs/:id/ragas-export から取得）:
  {
    "samples": [
      {
        "question": "質問文",
        "answer": "LLMの回答",
        "contexts": ["https://source1.com", "https://source2.com"]
      }
    ]
  }

出力 JSON 形式:
  {
    "faithfulness": 0.85,
    "answer_relevancy": 0.92,
    "samples": [
      {
        "question": "...",
        "faithfulness": 0.8,
        "answer_relevancy": 0.9
      }
    ]
  }
"""

import argparse
import json
import os
import sys

from datasets import Dataset
from langchain_anthropic import ChatAnthropic
from ragas import evaluate
from ragas.llms import LangchainLLMWrapper
from ragas.metrics import answer_relevancy, faithfulness


def load_input(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_dataset(samples: list[dict]) -> Dataset:
    """Ragas が要求する Dataset 形式に変換する"""
    return Dataset.from_dict({
        "user_input": [s["question"] for s in samples],
        "response": [s["answer"] for s in samples],
        # contexts は文字列リストのリストが必要。URL をそのまま渡す
        "retrieved_contexts": [s.get("contexts", []) for s in samples],
    })


def main():
    parser = argparse.ArgumentParser(description="Ragas による RAG 評価")
    parser.add_argument("--input", required=True, help="入力 JSON ファイルパス")
    parser.add_argument("--output", default="result.json", help="出力 JSON ファイルパス")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("エラー: ANTHROPIC_API_KEY が設定されていません", file=sys.stderr)
        sys.exit(1)

    data = load_input(args.input)
    samples = data.get("samples", [])
    if not samples:
        print("エラー: samples が空です", file=sys.stderr)
        sys.exit(1)

    print(f"評価開始: {len(samples)} 件のサンプル")

    llm = LangchainLLMWrapper(
        ChatAnthropic(
            model="claude-sonnet-4-6",
            api_key=api_key,
        )
    )

    dataset = build_dataset(samples)

    result = evaluate(
        dataset=dataset,
        metrics=[faithfulness, answer_relevancy],
        llm=llm,
    )

    df = result.to_pandas()

    sample_scores = []
    for i, row in df.iterrows():
        sample_scores.append({
            "question": samples[i]["question"],
            "faithfulness": round(float(row.get("faithfulness", 0)), 4),
            "answer_relevancy": round(float(row.get("answer_relevancy", 0)), 4),
        })

    output = {
        "faithfulness": round(float(df["faithfulness"].mean()), 4),
        "answer_relevancy": round(float(df["answer_relevancy"].mean()), 4),
        "samples": sample_scores,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n評価完了:")
    print(f"  Faithfulness    : {output['faithfulness']}")
    print(f"  Answer Relevancy: {output['answer_relevancy']}")
    print(f"\n詳細結果: {args.output}")


if __name__ == "__main__":
    main()

"""ディープサーチ（PDF 検索 + Claude 分析）を評価セットで評価する

使い方:
  uv run python -m rag_eval.run_eval \\
      --api-url http://127.0.0.1:<PORT>/api \\
      --testset datasets/testset.jsonl \\
      --label baseline

起動中のバックエンドの API を外から呼ぶため、評価対象のブランチを切り替えても同じ評価セット・
同じスクリプトで比較できる。結果は results/ と MLflow（./mlruns）に記録する。
"""

import argparse
import asyncio
import json
import math
from datetime import datetime
from pathlib import Path

import httpx
import mlflow
import pandas as pd
from ragas.metrics.collections import ContextPrecisionWithReference, ContextRecall, Faithfulness

from rag_eval.config import DEFAULT_MODEL
from rag_eval.judge import create_judge_llm
from rag_eval.retrieval_metrics import score_retrieval
from rag_eval.testset import TestCase, load_testset

# 分析の生成とバックエンドの検索に時間がかかるため長めにとる
REQUEST_TIMEOUT = 300.0


async def search_pdfs(http: httpx.AsyncClient, case: TestCase) -> list[dict]:
    """ディープサーチ API で PDF のみを検索し、順位順の結果を返す"""
    response = await http.post(
        "/deep-search",
        json={
            "keywords": case.keywords,
            "transcriptionIds": [],
            "includePdfs": True,
            "includeWeb": False,
        },
    )
    response.raise_for_status()
    return [r for r in response.json()["results"] if r["sourceType"] == "pdf"]


async def analyze(http: httpx.AsyncClient, case: TestCase, results: list[dict]) -> str:
    """検索結果をアプリと同じ分析 API に渡し、Claude の分析結果を得る"""
    response = await http.post(
        "/deep-search/analyze",
        json={
            "keywords": case.keywords,
            "results": [
                {"sourceType": r["sourceType"], "sourceName": r["sourceName"], "text": r["text"]}
                for r in results
            ],
        },
    )
    response.raise_for_status()
    return response.json()["analysis"]


async def score_generation(
    metrics: dict, case: TestCase, contexts: list[str], answer: str
) -> dict[str, float]:
    """Ragas で検索結果と分析結果の品質を採点する。失敗した指標は NaN"""
    if not contexts:
        # 何も検索できなかった場合、文脈系の指標は 0、忠実性は判定不能
        return {"context_precision": 0.0, "context_recall": 0.0, "faithfulness": math.nan}

    jobs = {
        "context_precision": metrics["context_precision"].ascore(
            user_input=case.question, reference=case.reference_answer, retrieved_contexts=contexts
        ),
        "context_recall": metrics["context_recall"].ascore(
            user_input=case.question, retrieved_contexts=contexts, reference=case.reference_answer
        ),
        "faithfulness": metrics["faithfulness"].ascore(
            user_input=case.question, response=answer, retrieved_contexts=contexts
        ),
    }
    results = await asyncio.gather(*jobs.values(), return_exceptions=True)
    scores = {}
    for name, result in zip(jobs, results):
        if isinstance(result, Exception):
            print(f"    {name} の採点に失敗: {result}")
            scores[name] = math.nan
        else:
            scores[name] = float(result.value)
    return scores


async def evaluate_cases(args: argparse.Namespace, cases: list[TestCase]) -> pd.DataFrame:
    """評価セットの全問を順に評価する"""
    metrics = None
    if not args.retrieval_only:
        llm = create_judge_llm(args.model)
        metrics = {
            "context_precision": ContextPrecisionWithReference(llm=llm),
            "context_recall": ContextRecall(llm=llm),
            "faithfulness": Faithfulness(llm=llm),
        }

    rows = []
    async with httpx.AsyncClient(base_url=args.api_url, timeout=REQUEST_TIMEOUT) as http:
        for i, case in enumerate(cases, start=1):
            print(f"[{i}/{len(cases)}] {case.id}: {case.question}")
            results = await search_pdfs(http, case)
            contexts = [r["text"] for r in results]
            row = {
                "id": case.id,
                "question": case.question,
                "keywords": " ".join(case.keywords),
                "num_results": len(results),
                **score_retrieval(contexts, case.evidence, args.ks),
            }
            if metrics is not None:
                answer = await analyze(http, case, results) if results else ""
                row.update(await score_generation(metrics, case, contexts, answer))
            rows.append(row)
    return pd.DataFrame(rows)


def summarize(df: pd.DataFrame) -> dict[str, float]:
    """問題ごとのスコアを平均する（NaN は除外）"""
    metric_columns = [c for c in df.columns if c not in ("id", "question", "keywords")]
    return {c: round(float(df[c].mean(skipna=True)), 4) for c in metric_columns}


def main() -> None:
    parser = argparse.ArgumentParser(description="ディープサーチの RAG 評価")
    parser.add_argument("--api-url", required=True, help="バックエンドの API（例: http://127.0.0.1:3000/api）")
    parser.add_argument("--testset", type=Path, default=Path("datasets/testset.jsonl"))
    parser.add_argument("--label", required=True, help="評価対象の名前（例: baseline, pr148）")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="LLM-as-a-Judge に使う Claude モデル")
    parser.add_argument("--ks", type=lambda s: [int(k) for k in s.split(",")], default=[1, 3, 5, 10])
    parser.add_argument("--limit", type=int, help="先頭から指定件数だけ評価する（動作確認用）")
    parser.add_argument("--retrieval-only", action="store_true", help="検索指標のみ計算し、Claude を呼ばない")
    parser.add_argument("--no-mlflow", action="store_true", help="MLflow に記録しない")
    args = parser.parse_args()

    cases = load_testset(args.testset)[: args.limit]
    df = asyncio.run(evaluate_cases(args, cases))
    summary = summarize(df)

    out_dir = Path("results") / f"{datetime.now():%Y%m%d-%H%M%S}_{args.label}"
    out_dir.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_dir / "per_case.csv", index=False)
    (out_dir / "summary.json").write_text(
        json.dumps({"label": args.label, "num_cases": len(df), **summary}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    if not args.no_mlflow:
        mlflow.set_experiment("deep-search-rag")
        with mlflow.start_run(run_name=args.label):
            mlflow.log_params(
                {
                    "label": args.label,
                    "testset": str(args.testset),
                    "num_cases": len(df),
                    "judge_model": "-" if args.retrieval_only else args.model,
                }
            )
            mlflow.log_metrics({k.replace("@", "_at_"): v for k, v in summary.items() if not math.isnan(v)})
            mlflow.log_artifacts(str(out_dir))

    print(f"\n評価結果（{args.label}、{len(df)}問）")
    for name, value in summary.items():
        print(f"  {name:<18} {value:.4f}")
    print(f"詳細: {out_dir}")


if __name__ == "__main__":
    main()

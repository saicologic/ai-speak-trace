"""ディープサーチ（検索 + Claude 分析）を評価セットで評価する

使い方:
  uv run python -m rag_eval.run_eval \\
      --api-url http://127.0.0.1:<PORT>/api \\
      --testset datasets/testset.jsonl \\
      --label baseline

起動中のバックエンドの API を外から呼ぶため、評価対象のブランチを切り替えても同じ評価セット・
同じスクリプトで比較できる。結果は results/ と MLflow（./mlruns）に記録する。

評価セットの問題の種類によって検索対象が変わる。
- transcription_id あり: その会話（+ --include-web で Web、--include-pdfs で PDF）を検索する
- transcription_id なし: PDF のみを検索する

Web 検索は実行のたびに結果が変わるため、--reuse-search で前回の検索結果を使い回すと
「分析（生成）」の変更だけを同じ条件で比較できる。
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
from rag_eval.judge import UsageTracker, create_judge_llm
from rag_eval.retrieval_metrics import score_retrieval, score_unranked
from rag_eval.testset import TestCase, load_testset

# 分析の生成とバックエンドの検索に時間がかかるため長めにとる
REQUEST_TIMEOUT = 300.0


def search_request(case: TestCase, include_web: bool, include_pdfs: bool) -> dict:
    """ディープサーチ API に送る検索条件。検索結果を使い回すときの照合にも使う"""
    is_conversation = case.transcription_id is not None
    return {
        "keywords": case.keywords,
        "transcriptionIds": [case.transcription_id] if is_conversation else [],
        "includePdfs": include_pdfs if is_conversation else True,
        "includeWeb": include_web if is_conversation else False,
    }


async def search(http: httpx.AsyncClient, request: dict) -> list[dict]:
    """ディープサーチ API で検索し、結果を返す"""
    response = await http.post("/deep-search", json=request)
    response.raise_for_status()
    return response.json()["results"]


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


def score_search(case: TestCase, results: list[dict], ks: list[int]) -> dict[str, float]:
    """検索結果の指標を計算する。会話の問題は会話の結果を、PDF の問題は PDF の結果を採点する"""
    texts_by_source: dict[str, list[str]] = {"conversation": [], "pdf": [], "web": []}
    for r in results:
        texts_by_source.setdefault(r["sourceType"], []).append(r["text"])
    scores: dict[str, float] = {f"num_{k}": len(v) for k, v in texts_by_source.items()}

    if case.transcription_id is not None:
        # 件数ベースの指標（何件返し、そのうち何件が根拠を含むか）と、
        # 順位ベースの指標（根拠を含む発話が何番目に来るか）の両方を記録する
        conversation = {
            **score_unranked(texts_by_source["conversation"], case.evidence),
            **score_retrieval(texts_by_source["conversation"], case.evidence, ks),
        }
        scores.update({f"conversation_{k}": v for k, v in conversation.items()})
    else:
        scores.update(score_retrieval(texts_by_source["pdf"], case.evidence, ks))
    return scores


async def score_generation(
    metrics: dict, case: TestCase, contexts: list[str], answer: str | None
) -> dict[str, float]:
    """Ragas で検索結果と分析結果の品質を採点する。失敗した指標は NaN

    answer が None（分析 API が失敗した）の場合、忠実性は採点せず NaN にする
    """
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
    }
    if answer is not None:
        jobs["faithfulness"] = metrics["faithfulness"].ascore(
            user_input=case.question, response=answer, retrieved_contexts=contexts
        )
    results = await asyncio.gather(*jobs.values(), return_exceptions=True)
    scores = {"faithfulness": math.nan}
    for name, result in zip(jobs, results):
        if isinstance(result, Exception):
            print(f"    {name} の採点に失敗: {result}")
            scores[name] = math.nan
        else:
            scores[name] = float(result.value)
    return scores


def load_saved_searches(path: Path) -> dict[str, dict]:
    """前回の実行で保存した検索結果（検索条件と結果）を問題IDごとに読み込む"""
    saved = {}
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                record = json.loads(line)
                saved[record["id"]] = record
    return saved


def reusable_results(saved: dict[str, dict], case_id: str, request: dict) -> list[dict] | None:
    """保存済みの検索結果のうち、検索条件が今回と同じものだけを返す

    問題IDは評価セットが違っても重なる（q001 など）ため、IDだけでなく検索条件も照合する。
    検索条件を記録していない古い結果も、同一性を確かめられないため使わない。
    """
    record = saved.get(case_id)
    if record is None:
        return None
    if record.get("request") != request:
        print("    保存済みの検索結果は検索条件が異なるため、検索し直します")
        return None
    return record["results"]


async def evaluate_cases(
    args: argparse.Namespace, cases: list[TestCase], out_dir: Path, tracker: UsageTracker
) -> pd.DataFrame:
    """評価セットの全問を順に評価する"""
    metrics = None
    if not args.retrieval_only:
        llm = create_judge_llm(args.model, tracker)
        metrics = {
            "context_precision": ContextPrecisionWithReference(llm=llm),
            "context_recall": ContextRecall(llm=llm),
            "faithfulness": Faithfulness(llm=llm),
        }
    saved_searches = load_saved_searches(args.reuse_search) if args.reuse_search else {}

    rows = []
    async with httpx.AsyncClient(base_url=args.api_url, timeout=REQUEST_TIMEOUT) as http:
        with (out_dir / "search_results.jsonl").open("w", encoding="utf-8") as search_log:
            for i, case in enumerate(cases, start=1):
                print(f"[{i}/{len(cases)}] {case.id}: {case.question}")
                row = {"id": case.id, "question": case.question, "keywords": " ".join(case.keywords)}
                request = search_request(case, args.include_web, args.include_pdfs)
                results = reusable_results(saved_searches, case.id, request)
                if results is None:
                    try:
                        results = await search(http, request)
                    except httpx.HTTPError as e:
                        # 1問の失敗で評価全体を止めない。指標の列は DataFrame 上で NaN になる
                        print(f"    検索に失敗: {e}")
                        rows.append(row)
                        continue
                search_log.write(
                    json.dumps(
                        {"id": case.id, "request": request, "results": results}, ensure_ascii=False
                    )
                    + "\n"
                )

                row.update(score_search(case, results, args.ks))
                if metrics is not None:
                    contexts = [r["text"] for r in results]
                    answer: str | None = ""
                    if results:
                        try:
                            answer = await analyze(http, case, results)
                        except httpx.HTTPError as e:
                            print(f"    分析に失敗: {e}")
                            answer = None
                    row.update(await score_generation(metrics, case, contexts, answer))
                rows.append(row)
    return pd.DataFrame(rows)


def summarize(df: pd.DataFrame) -> dict[str, float]:
    """問題ごとのスコアを平均する（NaN は除外し、全問 NaN の指標は出さない）"""
    metric_columns = [c for c in df.columns if c not in ("id", "question", "keywords")]
    return {
        c: round(float(df[c].mean(skipna=True)), 4) for c in metric_columns if df[c].notna().any()
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="ディープサーチの RAG 評価")
    parser.add_argument("--api-url", required=True, help="バックエンドの API（例: http://127.0.0.1:3000/api）")
    parser.add_argument("--testset", type=Path, default=Path("datasets/testset.jsonl"))
    parser.add_argument("--label", required=True, help="評価対象の名前（例: baseline, pr148）")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="LLM-as-a-Judge に使う Claude モデル")
    parser.add_argument("--ks", type=lambda s: [int(k) for k in s.split(",")], default=[1, 3, 5, 10])
    parser.add_argument("--limit", type=int, help="先頭から指定件数だけ評価する（動作確認用）")
    parser.add_argument("--include-web", action="store_true", help="会話の問題で Web 検索も行う")
    parser.add_argument("--include-pdfs", action="store_true", help="会話の問題で PDF 検索も行う")
    parser.add_argument(
        "--reuse-search", type=Path, help="前回の results/<実行>/search_results.jsonl の検索結果を使い回す"
    )
    parser.add_argument("--retrieval-only", action="store_true", help="検索指標のみ計算し、Claude を呼ばない")
    parser.add_argument("--no-mlflow", action="store_true", help="MLflow に記録しない")
    args = parser.parse_args()

    cases = load_testset(args.testset)[: args.limit]
    out_dir = Path("results") / f"{datetime.now():%Y%m%d-%H%M%S}_{args.label}"
    out_dir.mkdir(parents=True, exist_ok=True)

    tracker = UsageTracker(model=args.model)
    df = asyncio.run(evaluate_cases(args, cases, out_dir, tracker))
    summary = summarize(df)
    usage = {} if args.retrieval_only else tracker.summary()

    df.to_csv(out_dir / "per_case.csv", index=False)
    (out_dir / "summary.json").write_text(
        json.dumps(
            {"label": args.label, "num_cases": len(df), **summary, **usage},
            ensure_ascii=False,
            indent=2,
        ),
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
                    "include_web": args.include_web,
                    "include_pdfs": args.include_pdfs,
                    "reuse_search": str(args.reuse_search or "-"),
                }
            )
            mlflow.log_metrics(
                {
                    k.replace("@", "_at_"): v
                    for k, v in {**summary, **usage}.items()
                    if v is not None and not math.isnan(v)
                }
            )
            mlflow.log_artifacts(str(out_dir))

    print(f"\n評価結果（{args.label}、{len(df)}問）")
    for name, value in summary.items():
        print(f"  {name:<22} {value:.4f}")
    if usage:
        cost = usage["judge_cost_usd"]
        print(
            f"採点の使用量: {usage['judge_requests']}回 / 入力 {usage['judge_input_tokens']}"
            f"（うちキャッシュ読み取り {usage['judge_cache_read_tokens']}） / "
            f"出力 {usage['judge_output_tokens']} トークン"
            + (f"（約 ${cost}）" if cost is not None else "（費用は料金表にないモデルのため不明）")
        )
    print(f"詳細: {out_dir}")


if __name__ == "__main__":
    main()

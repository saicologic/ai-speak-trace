import asyncio
import json
import math
from types import SimpleNamespace

import httpx
import pandas as pd
import pytest
from pydantic import ValidationError

from rag_eval.generate_testset import GeneratedCase, generate_case
from rag_eval.generate_conversation_testset import GeneratedCase as GeneratedConversationCase
from rag_eval.generate_conversation_testset import validate_case
from rag_eval.judge import UsageTracker
from rag_eval.run_eval import load_saved_searches, score_search, search, summarize
from rag_eval.testset import TestCase, load_testset, save_testset

CONVERSATION_CASE = TestCase(
    id="q002",
    question="ハーネスを整理する2つの軸は？",
    keywords=["ハーネス"],
    reference_answer="計算的か推論的か、事前ガイドか事後センサーか",
    evidence=["事前ガイドと事後センサー"],
    transcription_id="t1",
)

CASE = TestCase(
    id="q001",
    question="東京タワーはいつ完成したか？",
    keywords=["東京タワー", "完成"],
    reference_answer="1958年",
    evidence=["1958年に完成"],
)


def test_testset_roundtrip(tmp_path):
    path = tmp_path / "testset.jsonl"
    save_testset(path, [CASE])
    assert load_testset(path) == [CASE]


def test_testcase_requires_evidence():
    with pytest.raises(ValidationError):
        TestCase(**{**CASE.model_dump(), "evidence": []})


def _run_search(case: TestCase, include_web: bool, include_pdfs: bool) -> dict:
    """モックした API に search を実行し、送ったリクエストの本文を返す"""
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"results": []})

    async def run():
        async with httpx.AsyncClient(
            base_url="http://test/api", transport=httpx.MockTransport(handler)
        ) as http:
            await search(http, case, include_web, include_pdfs)

    asyncio.run(run())
    assert requests[0].url.path == "/api/deep-search"
    return json.loads(requests[0].read())


def test_search_pdf_case_searches_pdfs_only_regardless_of_flags():
    body = _run_search(CASE, include_web=True, include_pdfs=False)
    assert body["transcriptionIds"] == []
    assert body["includePdfs"] is True
    assert body["includeWeb"] is False


def test_search_conversation_case_follows_flags():
    body = _run_search(CONVERSATION_CASE, include_web=True, include_pdfs=False)
    assert body["transcriptionIds"] == ["t1"]
    assert body["includePdfs"] is False
    assert body["includeWeb"] is True


def test_score_search_conversation_case_scores_conversation_results():
    results = [
        {"sourceType": "conversation", "text": "ハーネスには事前ガイドと事後センサーがある"},
        {"sourceType": "conversation", "text": "関係のない発話"},
        {"sourceType": "web", "text": "事前ガイドと事後センサー"},
    ]
    scores = score_search(CONVERSATION_CASE, results, [1])
    assert scores["conversation_recall"] == 1.0
    assert scores["conversation_precision"] == 0.5
    assert scores["conversation_mrr"] == 1.0
    assert scores["conversation_hit@1"] == 1.0
    assert scores["num_conversation"] == 2
    assert scores["num_web"] == 1
    assert "mrr" not in scores


def test_score_search_pdf_case_uses_ranked_metrics():
    results = [
        {"sourceType": "pdf", "text": "無関係"},
        {"sourceType": "pdf", "text": "1958年に完成した"},
    ]
    scores = score_search(CASE, results, [1, 2])
    assert scores["mrr"] == 0.5
    assert scores["hit@1"] == 0.0
    assert scores["hit@2"] == 1.0


def test_load_saved_searches(tmp_path):
    path = tmp_path / "search_results.jsonl"
    path.write_text(
        json.dumps({"id": "q001", "results": [{"sourceType": "web", "text": "x"}]}) + "\n",
        encoding="utf-8",
    )
    assert load_saved_searches(path) == {"q001": [{"sourceType": "web", "text": "x"}]}


def test_summarize_drops_metrics_that_are_all_nan():
    df = pd.DataFrame([{"id": "q1", "question": "", "keywords": "", "mrr": math.nan, "x": 1.0}])
    assert summarize(df) == {"x": 1.0}


def test_summarize_skips_nan():
    df = pd.DataFrame(
        [
            {"id": "q1", "question": "", "keywords": "", "mrr": 1.0, "faithfulness": 0.5},
            {"id": "q2", "question": "", "keywords": "", "mrr": 0.0, "faithfulness": math.nan},
        ]
    )
    assert summarize(df) == {"mrr": 0.5, "faithfulness": 0.5}


def _fake_client(parsed: GeneratedCase | None, stop_reason: str = "end_turn"):
    response = SimpleNamespace(parsed_output=parsed, stop_reason=stop_reason)
    return SimpleNamespace(messages=SimpleNamespace(parse=lambda **_: response))


CHUNK = {"text": "東京タワーの高さは333メートルで、1958年に完成した。", "fileName": "a.pdf"}


def test_generate_case_drops_paraphrased_evidence():
    parsed = GeneratedCase(
        question="東京タワーの高さは？",
        reference_answer="333メートル",
        evidence=["高さは333メートル", "333mの高さがある"],
        keywords=["東京タワー", "高さ"],
    )
    case = generate_case(_fake_client(parsed), "model", CHUNK)
    assert case is not None
    assert case.evidence == ["高さは333メートル"]


def test_generate_case_returns_none_without_verbatim_evidence():
    parsed = GeneratedCase(
        question="東京タワーの高さは？",
        reference_answer="333メートル",
        evidence=["333mの高さがある"],
        keywords=["東京タワー", "高さ"],
    )
    assert generate_case(_fake_client(parsed), "model", CHUNK) is None


def test_generate_case_returns_none_on_refusal():
    assert generate_case(_fake_client(None, "refusal"), "model", CHUNK) is None


UTTERANCES = ["Aさん: ハーネスには事前ガイドと事後センサーがあります。", "Bさん: なるほど。"]


def _generated(evidence, keywords):
    return GeneratedConversationCase(
        question="質問", reference_answer="回答", evidence=evidence, keywords=keywords
    )


def test_validate_case_keeps_verbatim_evidence_and_existing_keywords():
    case = validate_case(_generated(["事前ガイドと事後センサー", "言い換えた根拠"], ["ハーネス", "存在しない語"]), UTTERANCES)
    assert case is not None
    assert case.evidence == ["事前ガイドと事後センサー"]
    assert case.keywords == ["ハーネス"]


def test_validate_case_returns_none_when_keywords_not_in_conversation():
    assert validate_case(_generated(["事前ガイドと事後センサー"], ["存在しない語"]), UTTERANCES) is None


def test_usage_tracker_sums_messages_usage():
    tracker = UsageTracker(model="claude-sonnet-5-5")

    def response(path: str, usage: dict) -> httpx.Response:
        return httpx.Response(
            200, json={"usage": usage}, request=httpx.Request("POST", f"https://api.anthropic.com{path}")
        )

    async def run():
        await tracker.on_response(response("/v1/messages", {"input_tokens": 1000, "output_tokens": 100, "cache_read_input_tokens": 500}))
        await tracker.on_response(response("/v1/messages", {"input_tokens": 500, "output_tokens": 400}))
        await tracker.on_response(response("/v1/models", {"input_tokens": 9999}))

    asyncio.run(run())
    summary = tracker.summary()
    assert summary["judge_requests"] == 2
    assert summary["judge_input_tokens"] == 2000
    assert summary["judge_output_tokens"] == 500
    assert summary["judge_cost_usd"] == pytest.approx((2000 * 2 + 500 * 10) / 1_000_000, abs=1e-4)

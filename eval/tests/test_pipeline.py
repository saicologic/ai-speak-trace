import asyncio
import math
from types import SimpleNamespace

import httpx
import pandas as pd
import pytest
from pydantic import ValidationError

from rag_eval.generate_testset import GeneratedCase, generate_case
from rag_eval.run_eval import search_pdfs, summarize
from rag_eval.testset import TestCase, load_testset, save_testset

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


def test_search_pdfs_sends_pdf_only_request_and_filters_other_sources():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "results": [
                    {"sourceType": "pdf", "sourceName": "a.pdf", "text": "1つ目"},
                    {"sourceType": "web", "sourceName": "Web", "text": "Web"},
                    {"sourceType": "pdf", "sourceName": "b.pdf", "text": "2つ目"},
                ]
            },
        )

    async def run():
        async with httpx.AsyncClient(
            base_url="http://test/api", transport=httpx.MockTransport(handler)
        ) as http:
            return await search_pdfs(http, CASE)

    results = asyncio.run(run())

    assert [r["text"] for r in results] == ["1つ目", "2つ目"]
    body = requests[0].read().decode()
    assert requests[0].url.path == "/api/deep-search"
    assert '"includePdfs":true' in body and '"includeWeb":false' in body


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

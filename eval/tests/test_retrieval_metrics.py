import pytest

from rag_eval.retrieval_metrics import (
    hit_at_k,
    matched_evidence,
    normalize,
    precision,
    recall_at_k,
    reciprocal_rank,
    score_retrieval,
    score_unranked,
)

RETRIEVED = [
    "東京タワーは港区にある電波塔です。",
    "東京タワーの高さは\n333メートルで、1958年に完成した。",
    "スカイツリーの高さは634メートルである。",
]


def test_normalize_removes_whitespace_and_unifies_width():
    assert normalize("ＡＢＣ　１２３\n abc") == "ABC123abc"


def test_matched_evidence_ignores_line_breaks_in_pdf_text():
    assert matched_evidence(RETRIEVED[1], ["高さは333メートル"]) == {0}


def test_matched_evidence_returns_empty_when_not_found():
    assert matched_evidence(RETRIEVED[0], ["634メートル"]) == set()


@pytest.mark.parametrize(("k", "expected"), [(1, 0.0), (2, 1.0), (3, 1.0)])
def test_hit_at_k(k, expected):
    assert hit_at_k(RETRIEVED, ["1958年に完成"], k) == expected


def test_recall_at_k_counts_each_evidence_once():
    evidence = ["1958年に完成", "634メートル"]
    assert recall_at_k(RETRIEVED, evidence, 2) == 0.5
    assert recall_at_k(RETRIEVED, evidence, 3) == 1.0


def test_recall_at_k_without_evidence_is_zero():
    assert recall_at_k(RETRIEVED, [], 3) == 0.0


def test_reciprocal_rank():
    assert reciprocal_rank(RETRIEVED, ["634メートル"]) == pytest.approx(1 / 3)
    assert reciprocal_rank(RETRIEVED, ["存在しない文"]) == 0.0
    assert reciprocal_rank([], ["634メートル"]) == 0.0


def test_score_retrieval_returns_all_metrics():
    scores = score_retrieval(RETRIEVED, ["港区にある電波塔"], [1, 3])
    assert scores == {"mrr": 1.0, "hit@1": 1.0, "recall@1": 1.0, "hit@3": 1.0, "recall@3": 1.0}


def test_precision_is_ratio_of_results_containing_evidence():
    assert precision(RETRIEVED, ["高さは"]) == pytest.approx(2 / 3)
    assert precision([], ["高さは"]) == 0.0


def test_score_unranked():
    assert score_unranked(RETRIEVED, ["港区", "634メートル"]) == {
        "recall": 1.0,
        "precision": pytest.approx(2 / 3),
    }

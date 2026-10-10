"""検索精度の指標（Hit@k / Recall@k / MRR）

正解判定は「検索結果のテキストに根拠の抜粋が含まれるか」で行う。
PDF から抽出したテキストは改行や空白の位置が揺れるため、比較前に正規化する。
"""

import re
import unicodedata
from collections.abc import Sequence

_WHITESPACE = re.compile(r"\s+")


def normalize(text: str) -> str:
    """NFKC 正規化し、空白・改行をすべて取り除く"""
    return _WHITESPACE.sub("", unicodedata.normalize("NFKC", text))


def matched_evidence(text: str, evidence: Sequence[str]) -> set[int]:
    """テキストに含まれる根拠のインデックスを返す"""
    normalized = normalize(text)
    return {i for i, e in enumerate(evidence) if normalize(e) in normalized}


def first_relevant_rank(retrieved: Sequence[str], evidence: Sequence[str]) -> int | None:
    """根拠を含む最初の検索結果の順位（1始まり）。見つからなければ None"""
    for rank, text in enumerate(retrieved, start=1):
        if matched_evidence(text, evidence):
            return rank
    return None


def hit_at_k(retrieved: Sequence[str], evidence: Sequence[str], k: int) -> float:
    """上位 k 件に根拠を含む結果が1件でもあれば 1.0"""
    rank = first_relevant_rank(retrieved, evidence)
    return 1.0 if rank is not None and rank <= k else 0.0


def recall_at_k(retrieved: Sequence[str], evidence: Sequence[str], k: int) -> float:
    """上位 k 件でカバーできた根拠の割合"""
    if not evidence:
        return 0.0
    found: set[int] = set()
    for text in retrieved[:k]:
        found |= matched_evidence(text, evidence)
    return len(found) / len(evidence)


def reciprocal_rank(retrieved: Sequence[str], evidence: Sequence[str]) -> float:
    """最初の正解の順位の逆数（MRR の1問分）"""
    rank = first_relevant_rank(retrieved, evidence)
    return 1.0 / rank if rank is not None else 0.0


def score_retrieval(
    retrieved: Sequence[str], evidence: Sequence[str], ks: Sequence[int]
) -> dict[str, float]:
    """1問分の検索指標をまとめて計算する"""
    scores: dict[str, float] = {"mrr": reciprocal_rank(retrieved, evidence)}
    for k in ks:
        scores[f"hit@{k}"] = hit_at_k(retrieved, evidence, k)
        scores[f"recall@{k}"] = recall_at_k(retrieved, evidence, k)
    return scores


def precision(retrieved: Sequence[str], evidence: Sequence[str]) -> float:
    """検索結果のうち、根拠を含む結果の割合（順位のない検索用）"""
    if not retrieved:
        return 0.0
    return sum(1 for text in retrieved if matched_evidence(text, evidence)) / len(retrieved)


def score_unranked(retrieved: Sequence[str], evidence: Sequence[str]) -> dict[str, float]:
    """順位のない検索（会話のキーワード一致検索）の指標"""
    return {
        "recall": recall_at_k(retrieved, evidence, len(retrieved)),
        "precision": precision(retrieved, evidence),
    }

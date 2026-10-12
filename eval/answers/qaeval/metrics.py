"""質問の取り出しと、答えとの組み立ての評価"""

from dataclasses import dataclass

from qaeval.data import Conversation
from qaeval.pairing import pair_questions


@dataclass
class Counts:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    @property
    def precision(self) -> float | None:
        n = self.tp + self.fp
        return self.tp / n if n else None

    @property
    def recall(self) -> float | None:
        n = self.tp + self.fn
        return self.tp / n if n else None

    @property
    def f1(self) -> float | None:
        p, r = self.precision, self.recall
        if p is None or r is None:
            return None
        return 2 * p * r / (p + r) if p + r else 0.0


def count(pred: set, gold: set) -> Counts:
    return Counts(tp=len(pred & gold), fp=len(pred - gold), fn=len(gold - pred))


@dataclass
class Result:
    sentence: Counts  # 文ごとの質問の取り出し
    utterance: Counts  # 発話ごと（質問を含む発話か）
    answer_match: float | None  # 正解の質問のうち、答えの範囲が正解と同じになった割合
    false_positives: list[tuple[int, int]]
    false_negatives: list[tuple[int, int]]


def evaluate(conv: Conversation, pred: set[tuple[int, int]], gold: dict[tuple[int, int], int]) -> Result:
    gold_keys = {k for k, v in gold.items() if v == 1}
    # 正解ファイルにない文（自分の文など）を予測しても数えない
    pred = {k for k in pred if k in gold}
    gold_pairs = {p.question_utterance: p.answer_utterances for p in pair_questions(conv, gold_keys)}
    pred_pairs = {p.question_utterance: p.answer_utterances for p in pair_questions(conv, pred)}
    matched = sum(1 for u, ans in gold_pairs.items() if pred_pairs.get(u) == ans)
    return Result(
        sentence=count(pred, gold_keys),
        utterance=count({u for u, _ in pred}, {u for u, _ in gold_keys}),
        answer_match=matched / len(gold_pairs) if gold_pairs else None,
        false_positives=sorted(pred - gold_keys),
        false_negatives=sorted(gold_keys - pred),
    )

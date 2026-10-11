"""正解に対する適合率・再現率・F1 の計算

- 予測は順位のついた語の一覧。同じ正解に当たる予測（別の書き方など）は、一番上の1件だけを数える
- 正解ファイルにない語（未判定）は誤りとして数え、件数を別に出す
"""

from dataclasses import dataclass, field

from kweval.gold import Gold, GoldEntry
from kweval.text import TYPES, script_type


@dataclass
class Counts:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    def __add__(self, other: "Counts") -> "Counts":
        return Counts(self.tp + other.tp, self.fp + other.fp, self.fn + other.fn)

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
        if p is None or r is None or p + r == 0:
            return None if p is None or r is None else 0.0
        return 2 * p * r / (p + r)


@dataclass
class Judged:
    """1つの予測と、その判定"""

    term: str
    rank: int
    entry: GoldEntry | None

    @property
    def correct(self) -> bool:
        return self.entry is not None and self.entry.label == 1

    @property
    def unjudged(self) -> bool:
        return self.entry is None

    @property
    def type(self) -> str:
        """正解ならその種類、そうでなければ見た目の種類"""
        if self.correct:
            return self.entry.type  # type: ignore[union-attr]
        return script_type(self.term)


@dataclass
class DocResult:
    total: Counts
    by_type: dict[str, Counts]
    top_k_correct: int
    top_k_size: int
    unjudged: int
    judged: list[Judged] = field(default_factory=list)
    missed: list[GoldEntry] = field(default_factory=list)


def judge(predictions: list[str], gold: Gold) -> list[Judged]:
    """予測に判定をつける。同じ正解に当たる2件目以降は除く"""
    seen: set[int] = set()
    out: list[Judged] = []
    for term in predictions:
        entry = gold.lookup(term)
        key = id(entry) if entry is not None else None
        if key is not None:
            if key in seen:
                continue
            seen.add(key)
        out.append(Judged(term=term, rank=len(out) + 1, entry=entry))
    return out


def evaluate(predictions: list[str], gold: Gold, text: str, top_k: int = 30) -> DocResult:
    """1件の会話について評価する。predictions は点数の高い順"""
    positives = gold.positives_in(text)
    judged = judge(predictions, gold)
    found = {id(j.entry) for j in judged if j.correct}

    by_type = {t: Counts() for t in TYPES}
    for j in judged:
        c = by_type.setdefault(j.type, Counts())
        if j.correct:
            c.tp += 1
        else:
            c.fp += 1
    missed = [e for e in positives if id(e) not in found]
    for e in missed:
        by_type.setdefault(e.type, Counts()).fn += 1

    tp = sum(1 for j in judged if j.correct)
    total = Counts(tp=tp, fp=len(judged) - tp, fn=len(missed))
    top = judged[:top_k]
    return DocResult(
        total=total,
        by_type=by_type,
        top_k_correct=sum(1 for j in top if j.correct),
        top_k_size=len(top),
        unjudged=sum(1 for j in judged if j.unjudged),
        judged=judged,
        missed=missed,
    )


def precision_at_k(results: list[DocResult]) -> float | None:
    """上位k件の適合率（会話をまたいで合計して割る）"""
    size = sum(r.top_k_size for r in results)
    return sum(r.top_k_correct for r in results) / size if size else None

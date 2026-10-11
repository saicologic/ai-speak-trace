"""4. SudachiPy + GiNZA の組み合わせ

SudachiPy の C-value の候補に、GiNZA の固有表現を足す。
点数は、C-value を一番高い語で割って 0〜1 にそろえたものに、固有表現なら ENTITY_BONUS を足す。
"""

from kweval.methods import Method, Scored
from kweval.methods.ginza_ner import GinzaNer
from kweval.methods.sudachi_cvalue import SudachiCValue

ENTITY_BONUS = 1.0


def combine(cvalue: list[Scored], entities: dict[str, int]) -> list[Scored]:
    max_c = max((s.score for s in cvalue), default=0.0) or 1.0
    merged: dict[str, Scored] = {s.term: Scored(s.term, s.score / max_c, s.count, s.proper) for s in cvalue}
    for term, n in entities.items():
        s = merged.get(term)
        if s is None:
            merged[term] = Scored(term, ENTITY_BONUS, n, proper=True)
        else:
            s.score += ENTITY_BONUS
            s.proper = True
    return sorted(merged.values(), key=lambda s: (-s.score, -s.count, s.term))


class Combined(Method):
    name = "combined"
    label = "4. SudachiPy + GiNZA"

    def __init__(self, sudachi: SudachiCValue | None = None, ginza: GinzaNer | None = None) -> None:
        self.sudachi = sudachi or SudachiCValue()
        self.ginza = ginza or GinzaNer()

    def setup(self) -> None:
        if self.sudachi.tokenizer is None:
            self.sudachi.setup()
        if self.ginza.nlp is None:
            self.ginza.setup()

    def extract(self, utterances: list[str]) -> list[Scored]:
        cvalue = self.sudachi.extract(utterances)
        self.ginza.extract(utterances)
        return combine(cvalue, dict(self.ginza.last_entities))

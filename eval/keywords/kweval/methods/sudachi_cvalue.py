"""2. SudachiPy：分割単位 C で名詞の連続を取り出し、C-value で点数をつける"""

from collections import Counter

from sudachipy import Dictionary, SplitMode

from kweval.cvalue import c_value, term_frequencies
from kweval.methods import Method, Scored
from kweval.methods.common import from_sudachi, join_morphs, keep_term, noun_sequences, strip_audio_tags

# C-value を数える部分列の最大の長さ（形態素の数）
MAX_LEN = 6


def score_sequences(
    sequences: list[list[str]], min_score: float, proper_nouns: set[str] | None = None
) -> list[Scored]:
    """名詞の連続の一覧から、C-value の高い順に語を返す

    proper_nouns は、辞書で固有名詞とされた語の表記（1語の候補にだけ使う）
    """
    proper_nouns = proper_nouns or set()
    scores = c_value(sequences, MAX_LEN)
    freq = term_frequencies(sequences, MAX_LEN)
    best: dict[str, Scored] = {}
    for seq, score in scores.items():
        if score < min_score:
            continue
        term = join_morphs(seq)
        if not keep_term(term):
            continue
        prev = best.get(term)
        if prev is None or score > prev.score:
            best[term] = Scored(term, score, freq[seq], proper=term in proper_nouns)
    return sorted(best.values(), key=lambda s: (-s.score, -s.count, s.term))


class SudachiCValue(Method):
    name = "sudachi"
    label = "2. SudachiPy + C-value"

    def __init__(self, min_score: float = 1.0) -> None:
        # min_score: これより低い C-value の語は出さない
        # （1.0 は、1語の候補が他の候補に含まれずに1回以上出てくるくらい）
        self.min_score = min_score
        self.tokenizer = None
        self.proper_nouns: set[str] = set()

    def setup(self) -> None:
        self.tokenizer = Dictionary(dict="core").create(SplitMode.C)

    def sequences(self, utterances: list[str]) -> list[list[str]]:
        if self.tokenizer is None:
            self.setup()
        out: list[list[str]] = []
        self.proper_nouns = set()
        for text in utterances:
            morphs = from_sudachi(self.tokenizer.tokenize(strip_audio_tags(text)))
            self.proper_nouns.update(m.surface for m in morphs if m.pos[:2] == ("名詞", "固有名詞"))
            out.extend(noun_sequences(morphs))
        return out

    def extract(self, utterances: list[str]) -> list[Scored]:
        sequences = self.sequences(utterances)
        return score_sequences(sequences, self.min_score, self.proper_nouns)


def count_terms(sequences: list[list[str]]) -> Counter[str]:
    """名詞の連続そのもの（部分列でない）の出現回数"""
    return Counter(join_morphs(s) for s in sequences)

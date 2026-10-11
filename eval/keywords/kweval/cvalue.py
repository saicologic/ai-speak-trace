"""C-value による専門用語らしさの点数

C-value は、複合語の候補について「長さ」と「より長い候補に含まれずに出てくる回数」から点数をつける。

    C(a) = w(|a|) * f(a)                                  (a を含むより長い候補がないとき)
    C(a) = w(|a|) * (f(a) - Σ_{b∈T(a)} f(b) / |T(a)|)     (それ以外)

- |a| は a の形態素の数、f(a) は a の出現回数（より長い候補の中に出てくる分も含む）
- T(a) は a を含むより長い候補の集合
- もとの式は w(n) = log2(n) で、1語の候補が常に0点になる。
  1語の専門用語も拾いたいので、よく使われる変形の w(n) = log2(n + 1) を使う
"""

import math
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence

Term = tuple[str, ...]


def subsequences(seq: Sequence[str], max_len: int | None = None) -> Iterable[Term]:
    """連続した部分列をすべて返す（同じ部分列が複数回出れば、その回数だけ返す）"""
    n = len(seq)
    limit = n if max_len is None else min(n, max_len)
    for length in range(1, limit + 1):
        for start in range(0, n - length + 1):
            yield tuple(seq[start : start + length])


def length_weight(n: int) -> float:
    return math.log2(n + 1)


def c_value(sequences: Iterable[Sequence[str]], max_len: int | None = None) -> dict[Term, float]:
    """名詞の連続（形態素の列）の出現の一覧から、各候補の C-value を返す

    sequences には、文中に出てきた名詞の連続を1回ごとに1件として渡す。
    候補は、それぞれの連続の部分列すべて。
    """
    freq: Counter[Term] = Counter()
    for seq in sequences:
        if seq:
            freq.update(subsequences(seq, max_len))

    # a を含むより長い候補の集合 T(a)
    containers: dict[Term, set[Term]] = defaultdict(set)
    for b in freq:
        if len(b) < 2:
            continue
        for a in set(subsequences(b)):
            if a != b:
                containers[a].add(b)

    scores: dict[Term, float] = {}
    for a, f in freq.items():
        nested = containers.get(a)
        if nested:
            f_nested = sum(freq[b] for b in nested) / len(nested)
            scores[a] = length_weight(len(a)) * (f - f_nested)
        else:
            scores[a] = length_weight(len(a)) * f
    return scores


def term_frequencies(sequences: Iterable[Sequence[str]], max_len: int | None = None) -> Counter[Term]:
    """各候補の出現回数（より長い候補の中に出てくる分も含む）"""
    freq: Counter[Term] = Counter()
    for seq in sequences:
        freq.update(subsequences(seq, max_len))
    return freq

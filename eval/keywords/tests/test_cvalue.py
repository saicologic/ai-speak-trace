import math

import pytest

from kweval.cvalue import c_value, subsequences, term_frequencies


def test_subsequences_は連続した部分列をすべて返す():
    assert list(subsequences(["a", "b", "c"])) == [
        ("a",), ("b",), ("c",), ("a", "b"), ("b", "c"), ("a", "b", "c"),
    ]  # fmt: skip
    assert list(subsequences(["a", "b", "c"], max_len=1)) == [("a",), ("b",), ("c",)]


def test_出現回数は長い候補の中に出てくる分も数える():
    freq = term_frequencies([["強化", "学習"], ["深層", "強化", "学習"]])
    assert freq[("強化", "学習")] == 2
    assert freq[("深層", "強化", "学習")] == 1
    assert freq[("学習",)] == 2


def test_c_value_を手で計算した値と比べる():
    # 「強化学習」2回、「深層強化学習」1回、「学習」1回
    sequences = [["強化", "学習"], ["強化", "学習"], ["深層", "強化", "学習"], ["学習"]]
    scores = c_value(sequences)

    # より長い候補に含まれない: log2(3 + 1) * 1
    assert scores[("深層", "強化", "学習")] == pytest.approx(2.0)
    # f=3、含む候補は「深層強化学習」(f=1) だけ: log2(2 + 1) * (3 - 1)
    assert scores[("強化", "学習")] == pytest.approx(math.log2(3) * 2)
    # 「深層強化学習」の中にしか出てこない: log2(3) * (1 - 1)
    assert scores[("深層", "強化")] == pytest.approx(0.0)
    # f=4、含む候補は「強化学習」(3) と「深層強化学習」(1): log2(2) * (4 - 2)
    assert scores[("学習",)] == pytest.approx(2.0)
    # f=3、含む候補は「強化学習」(3)・「深層強化」(1)・「深層強化学習」(1): 1 * (3 - 5/3)
    assert scores[("強化",)] == pytest.approx(4 / 3)
    assert scores[("深層",)] == pytest.approx(0.0)


def test_より長い候補だけに出てくる語は点数が上がらない():
    scores = c_value([["量子", "化"], ["量子", "化"]])
    assert scores[("量子", "化")] > 0
    assert scores[("量子",)] == pytest.approx(0.0)
    assert scores[("化",)] == pytest.approx(0.0)

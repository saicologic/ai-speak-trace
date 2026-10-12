import pytest

from qaeval.metrics import Counts, evaluate


def test_counts():
    c = Counts(tp=3, fp=1, fn=1)
    assert c.precision == pytest.approx(0.75)
    assert c.recall == pytest.approx(0.75)
    assert c.f1 == pytest.approx(0.75)
    assert Counts().f1 is None


def test_evaluate(conv):
    gold = {(0, 0): 0, (0, 1): 1, (2, 0): 0, (4, 0): 0, (4, 1): 1, (6, 0): 1}
    r = evaluate(conv, {(0, 1), (6, 0), (2, 0)}, gold)
    assert (r.sentence.tp, r.sentence.fp, r.sentence.fn) == (2, 1, 1)
    assert (r.utterance.tp, r.utterance.fp, r.utterance.fn) == (2, 1, 1)
    # 正解の答え: 0→[1,3], 4→[5], 6→[7]。予測は 0→[1], 2→[3,5], 6→[7] なので一致は 6 だけ
    assert r.answer_match == pytest.approx(1 / 3)
    assert r.false_negatives == [(4, 1)]


def test_正解ファイルにない文は数えない(conv):
    gold = {(0, 1): 1}
    r = evaluate(conv, {(0, 1), (1, 0)}, gold)
    assert (r.sentence.tp, r.sentence.fp) == (1, 0)

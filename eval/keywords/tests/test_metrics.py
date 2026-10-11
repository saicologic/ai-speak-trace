import pytest

from kweval.gold import Gold, GoldEntry
from kweval.metrics import Counts, evaluate, precision_at_k


def make_gold() -> Gold:
    return Gold(
        [
            GoldEntry("強化学習", 1, "漢字"),
            GoldEntry("プロンプト", 1, "カタカナ"),
            GoldEntry("Claude Code", 1, "固有名", ["クラウドコード"]),
            GoldEntry("RAG", 1, "英字", ["ラグ"]),
            GoldEntry("会社", 0),
        ]
    )


TEXT = "強化学習とプロンプトとClaude Code（クラウドコード）の話を会社でする"


def test_counts_の指標():
    c = Counts(tp=3, fp=1, fn=2)
    assert c.precision == pytest.approx(0.75)
    assert c.recall == pytest.approx(0.6)
    assert c.f1 == pytest.approx(2 * 0.75 * 0.6 / 1.35)
    assert Counts().precision is None
    assert Counts(tp=0, fp=2, fn=1).f1 == 0.0


def test_本文に出てくる正解だけを数える():
    gold = make_gold()
    # RAG は本文にないので正解の数に入らない
    assert {e.term for e in gold.positives_in(TEXT)} == {"強化学習", "プロンプト", "Claude Code"}


def test_適合率と再現率():
    r = evaluate(["プロンプト", "会社", "強化学習", "ほげ"], make_gold(), TEXT)
    assert (r.total.tp, r.total.fp, r.total.fn) == (2, 2, 1)
    assert r.unjudged == 1
    assert [e.term for e in r.missed] == ["Claude Code"]


def test_別の書き方は1つの正解としてまとめる():
    # 表記の違い（空白・大文字小文字）と別名は同じ正解に当たる。2件目以降は数えない
    r = evaluate(["claudecode", "クラウドコード", "Claude Code"], make_gold(), TEXT)
    assert (r.total.tp, r.total.fp) == (1, 0)
    assert len(r.judged) == 1


def test_種類ごとの数():
    r = evaluate(["プロンプト", "会社", "ほげAPI"], make_gold(), TEXT)
    assert r.by_type["カタカナ"].tp == 1
    # 正解でない語は見た目で分ける
    assert r.by_type["漢字"].fp == 1
    assert r.by_type["複合"].fp == 1
    assert r.by_type["漢字"].fn == 1  # 強化学習
    assert r.by_type["固有名"].fn == 1  # Claude Code


def test_上位k件の適合率():
    gold = make_gold()
    r1 = evaluate(["プロンプト", "会社", "強化学習"], gold, TEXT, top_k=2)
    assert (r1.top_k_correct, r1.top_k_size) == (1, 2)
    r2 = evaluate(["会社"], gold, TEXT, top_k=2)
    # 出した語が k 件より少ないときは、出した件数で割る
    assert precision_at_k([r1, r2]) == pytest.approx(1 / 3)
    assert precision_at_k([]) is None

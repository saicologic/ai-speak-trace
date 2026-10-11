from kweval.methods import Scored
from kweval.methods.combined import combine
from kweval.methods.common import Morph, join_morphs, keep_term, noun_sequences, strip_audio_tags
from kweval.methods.freq_filter import FrequencyTable, filter_common
from kweval.methods.ginza_ner import is_keyword_label
from kweval.methods.sudachi_cvalue import SudachiCValue, score_sequences

NOUN = ("名詞", "普通名詞", "一般", "*")
PROPER = ("名詞", "固有名詞", "一般", "*")
PARTICLE = ("助詞", "格助詞", "*", "*")
SUFFIX = ("接尾辞", "名詞的", "一般", "*")


def test_名詞の連続を取り出す():
    morphs = [
        Morph("Claude", PROPER, space_after=True),
        Morph("Code", NOUN),
        Morph("の", PARTICLE),
        Morph("強化", NOUN),
        Morph("学習", NOUN),
        Morph("と", PARTICLE),
        Morph("加賀谷", PROPER),
        Morph("さん", SUFFIX),
        Morph("の", PARTICLE),
        Morph("量子", NOUN),
        Morph("化", SUFFIX),
    ]
    seqs = noun_sequences(morphs)
    assert [join_morphs(s) for s in seqs] == ["Claude Code", "強化学習", "加賀谷", "量子化"]


def test_日本語の語の後の空白では区切る():
    morphs = [Morph("強化", NOUN, space_after=True), Morph("学習", NOUN)]
    assert [join_morphs(s) for s in noun_sequences(morphs)] == ["強化", "学習"]


def test_語として残すかどうか():
    assert keep_term("強化学習")
    assert not keep_term("A")
    assert not keep_term("Aさん")
    assert not keep_term("こと")
    assert not keep_term("百三十")


def test_音のタグを除く():
    assert "笑い" not in strip_audio_tags("ループ[笑い]までやりたい")


def test_score_sequences_は高い順に並べる():
    scored = score_sequences([["強化", "学習"], ["強化", "学習"], ["会社"]], min_score=1.0, proper_nouns={"会社"})
    assert scored[0].term == "強化学習"
    assert {s.term for s in scored} == {"強化学習", "会社"}
    assert next(s for s in scored if s.term == "会社").proper


def test_数や日時の固有表現は除く():
    assert is_keyword_label("Product_Other")
    assert not is_keyword_label("Date")
    assert not is_keyword_label("N_Event")


def test_組み合わせは固有表現の点数を上げる():
    merged = combine([Scored("会社", 4.0, 4), Scored("強化学習", 2.0, 2)], {"強化学習": 1, "Logress": 1})
    assert [s.term for s in merged] == ["強化学習", "会社", "Logress"]
    assert merged[0].score == 1.5


class FakeTable(FrequencyTable):
    def __init__(self, zipf: dict[str, float]):
        super().__init__()
        self._zipf = zipf

    def zipf(self, term: str) -> float:
        return self._zipf.get(term, 0.0)


def test_頻度表でありふれた語を除く():
    table = FakeTable({"会社": 5.4, "Google": 4.5, "蒸留": 3.4})
    scored = [Scored("会社", 3), Scored("蒸留", 2), Scored("Google", 1, proper=True), Scored("強化学習", 1)]
    assert [s.term for s in filter_common(scored, table, 4.5)] == ["蒸留", "Google", "強化学習"]


def test_SudachiPy_で漢字だけの専門用語を拾う():
    terms = {s.term for s in SudachiCValue().extract(["量子化や蒸留や強化学習を試した。", "強化学習は難しい。"])}
    assert {"量子化", "蒸留", "強化学習"} <= terms

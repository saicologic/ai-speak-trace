from qaeval.data import split_sentences
from qaeval.pairing import pair_questions


def test_発話を文に分ける():
    assert split_sentences("はい。何社ですか？三社[笑い]です") == ["はい。", "何社ですか？", "三社です"]


def test_質問と答えを組にする(conv):
    pairs = pair_questions(conv, {(0, 1), (4, 1), (6, 0)})
    # あいづち（2）は答えを区切らない
    assert [(p.question_utterance, p.answer_utterances) for p in pairs] == [(0, [1, 3]), (4, [5]), (6, [7])]
    assert pairs[0].question == ["今日は何社ぐらい応募されてますか？"]


def test_質問を取りこぼすと答えがまとまる(conv):
    pairs = pair_questions(conv, {(0, 1), (6, 0)})
    assert [(p.question_utterance, p.answer_utterances) for p in pairs] == [(0, [1, 3, 5]), (6, [7])]

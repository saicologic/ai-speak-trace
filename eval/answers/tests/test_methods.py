import pytest

from qaeval.methods.context import is_backchannel, last_sentence_before_reply
from qaeval.methods.rules import ends_with_question_phrase, question_mark, question_phrase
from qaeval.methods.sudachi_pos import SudachiQuestion


@pytest.mark.parametrize(
    "text",
    [
        "何社ぐらい応募されてますか？",
        "お時間の都合、問題なさそうでしょうか。",
        "この辺はいかがですか。",
        "大丈夫そうですかね。",
        "嫌だっていうところがあるって感じですかね。",
        "バックエンドのエンジニアみたいな感じで。",
        "何か確認しておきたいこととかは。",
    ],
)
def test_質問の言い回し(text):
    assert ends_with_question_phrase(text)


@pytest.mark.parametrize("text", ["ありがとうございます。", "そのように思ってます。", "よろしくお願いします。"])
def test_質問ではない文(text):
    assert not ends_with_question_phrase(text)


def test_相手の文だけを見る(conv):
    assert question_mark(conv) == {(0, 1)}
    assert question_phrase(conv) == {(0, 1), (4, 1), (6, 0)}


def test_あいづち():
    assert is_backchannel("うんうん。")
    assert is_backchannel("ありがとうございます。")
    assert is_backchannel("よろしくお願いします。")
    assert not is_backchannel("バックエンドのエンジニアみたいな感じで。")


def test_自分の返事から確認の質問を見つける(conv):
    # 4 の最後の文の後に「はい、そうです」が続く。0 の後の「三社です」は返事の言葉で始まらない
    assert last_sentence_before_reply(conv) == {(4, 1)}


def test_SudachiPy_の品詞で質問を見つける():
    q = SudachiQuestion()
    assert q.is_question("一番優先度の高いものは何になりますか。")
    assert q.is_question("残業はどれぐらい想定。")
    assert not q.is_question("そのように思ってます。")

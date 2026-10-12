"""文末の記号と言い回しで、質問を見つける規則"""

import re

from qaeval.data import Conversation, Sentence

# 1. 疑問符だけ（文字起こしがつけた「？」に頼る）
_RE_QUESTION_MARK = re.compile(r"[？?]$")

# 2. 疑問の言い回しで終わる文（「？」がなく「。」で終わるもの）
_QUESTION_ENDINGS = [
    r"(ます|です|でしょう|ません)か(ね)?",  # 〜ますか / 〜ですかね
    r"(いかが|どう)(です|でしょう)か?",  # いかがですか / どうですか
    r"(ある|ない|する|した|います|ありますか)?(んです|んでしょう)か",
    r"(って|っていう|みたいな)(感じ|形|こと)(です)?(か|かね)?",  # 〜って感じですかね / 〜って感じで
    r"(って|っていう|みたいな)(感じ|形)で",
    r"(という|っていう)(認識|理解)で(合って|よろし)",
    r"(とか)?は",  # 何か確認しておきたいこととかは。
]
_RE_ENDING = re.compile("(" + "|".join(_QUESTION_ENDINGS) + r")[。．.]?$")

# 疑問詞（「どれぐらい想定。」のように、疑問の言い回しがなくても質問になる）
_RE_WH = re.compile(r"(何|なに|なん|どう|どの|どこ|いつ|いくら|どれ|なぜ|どちら|どっち|誰)")


def ends_with_question_mark(text: str) -> bool:
    return bool(_RE_QUESTION_MARK.search(text))


def ends_with_question_phrase(text: str) -> bool:
    return ends_with_question_mark(text) or bool(_RE_ENDING.search(text))


def other_sentences(conv: Conversation) -> list[Sentence]:
    return [s for s in conv.sentences() if s.speaker_id != conv.self_speaker]


def question_mark(conv: Conversation) -> set[tuple[int, int]]:
    """1. 疑問符だけ"""
    return {s.key for s in other_sentences(conv) if ends_with_question_mark(s.text)}


def question_phrase(conv: Conversation) -> set[tuple[int, int]]:
    """2. 疑問符と、疑問の言い回し"""
    return {s.key for s in other_sentences(conv) if ends_with_question_phrase(s.text)}


def has_wh_word(text: str) -> bool:
    return bool(_RE_WH.search(text))

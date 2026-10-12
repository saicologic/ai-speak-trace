"""SudachiPy の品詞で、文末が質問の形かを見る

- 文末の終助詞「か」「かね」「かな」「っけ」「の」（「？」がなくても拾う）
- 疑問詞（何・どう・いくら など）を含み、文末が名詞・助詞で終わる文（「残業はどれぐらい想定。」）
"""

from sudachipy import Dictionary, SplitMode

from qaeval.data import Conversation
from qaeval.methods.rules import ends_with_question_mark, other_sentences

QUESTION_PARTICLES = {"か", "かね", "かな", "っけ", "の"}
WH_WORDS = {"何", "なに", "なん", "どう", "どの", "どこ", "いつ", "いくら", "どれ", "なぜ", "どちら", "どっち", "誰", "どういう", "どんな", "どれぐらい", "どれくらい"}


class SudachiQuestion:
    def __init__(self) -> None:
        self.tokenizer = Dictionary(dict="core").tokenizer(mode=SplitMode.C)

    def is_question(self, text: str) -> bool:
        if ends_with_question_mark(text):
            return True
        morphs = [m for m in self.tokenizer.tokenize(text) if m.part_of_speech()[0] not in {"補助記号", "空白"}]
        if not morphs:
            return False
        last = morphs[-1]
        pos = last.part_of_speech()
        if pos[0] == "助詞" and pos[1] == "終助詞" and last.surface() in QUESTION_PARTICLES:
            return True
        has_wh = any(m.surface() in WH_WORDS or m.part_of_speech()[1] == "疑問詞" for m in morphs)
        return has_wh and pos[0] in {"名詞", "助詞"}

    def __call__(self, conv: Conversation) -> set[tuple[int, int]]:
        return {s.key for s in other_sentences(conv) if self.is_question(s.text)}

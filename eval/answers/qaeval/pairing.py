"""質問と答えの組み立て

質問を含む相手の発話を「質問のまとまり」とし、その後から次の質問のまとまりまでの
自分の発話を答えとする。相手のあいづち（質問を含まない発話）は答えを区切らない。
"""

from dataclasses import dataclass

from qaeval.data import Conversation


@dataclass
class QAPair:
    question_utterance: int  # 質問を含む相手の発話の番号
    question: list[str]  # 質問の文
    answer_utterances: list[int]  # 答えにあたる自分の発話の番号


def pair_questions(conv: Conversation, question_keys: set[tuple[int, int]]) -> list[QAPair]:
    """質問の文の位置から、質問と答えの組を作る"""
    sentences = {s.key: s.text for s in conv.sentences()}
    q_utterances = sorted({u for u, _ in question_keys})
    pairs: list[QAPair] = []
    for n, u in enumerate(q_utterances):
        end = q_utterances[n + 1] if n + 1 < len(q_utterances) else len(conv.utterances)
        answers = [
            i for i in range(u + 1, end) if conv.utterances[i][0] == conv.self_speaker
        ]
        question = [sentences[k] for k in sorted(question_keys) if k[0] == u]
        pairs.append(QAPair(u, question, answers))
    return pairs

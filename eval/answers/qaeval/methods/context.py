"""自分の返事を手がかりに、確認の質問を見つける

「バックエンドのエンジニアみたいな感じで。」のような確認は、疑問の言い回しがない。
相手の発話の最後の文で、すぐ後の自分の発話が返事（はい・そうです など）で始まるなら、
その文を質問とみなす。ただし、あいづち・お礼・あいさつの文は除く。
"""

import re

from qaeval.data import Conversation

_RE_REPLY = re.compile(r"^(はい|ええ|そうです|そうですね|そうなんです|いや|いえ|うん|大事です|合ってます|最初からです)")

# あいづち・お礼・あいさつ（返事が続いても質問ではない）
_RE_BACKCHANNEL = re.compile(
    r"^(うん|はい|ええ|おお|ああ|なるほど|わかりました|分かりました|承知しました|承知いたしました|了解です|了解しました|"
    r"ありがとうございます|OKです|とんでもないです|すごいですね|そうなんですね|[、。 ])+[。！!]?$"
    r"|よろしくお願い|幸いです|幸いでございます"
)


def is_backchannel(text: str) -> bool:
    """あいづち・お礼・あいさつの文か"""
    return bool(_RE_BACKCHANNEL.search(text))


def last_sentence_before_reply(conv: Conversation) -> set[tuple[int, int]]:
    """相手の発話の最後の文のうち、次の自分の発話が返事で始まるもの"""
    sentences = conv.sentences()
    last: dict[int, tuple[int, int]] = {}
    texts: dict[tuple[int, int], str] = {}
    for s in sentences:
        last[s.utterance] = s.key
        texts[s.key] = s.text
    out: set[tuple[int, int]] = set()
    for u, (speaker, _) in enumerate(conv.utterances[:-1]):
        next_speaker, next_text = conv.utterances[u + 1]
        if speaker == conv.self_speaker or next_speaker != conv.self_speaker or u not in last:
            continue
        key = last[u]
        if _RE_REPLY.match(next_text.strip()) and not is_backchannel(texts[key]):
            out.add(key)
    return out

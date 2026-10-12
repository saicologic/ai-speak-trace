"""会話の読み込みと、文への分割"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

from qaeval.paths import CONVERSATION_JSON

# 文の区切り（区切りの記号は前の文に含める）
_RE_SENTENCE = re.compile(r"[^。？?！!]+[。？?！!]*")
# 文字起こしに入る音のタグ（[笑い] など）
_RE_AUDIO_TAG = re.compile(r"\[[^\]]*\]")


@dataclass
class Sentence:
    """発話の中の1文"""

    utterance: int  # 発話の番号（0 から）
    index: int  # 発話の中での文の番号（0 から）
    speaker_id: str
    text: str

    @property
    def key(self) -> tuple[int, int]:
        return (self.utterance, self.index)


@dataclass
class Conversation:
    speakers: dict[str, str]  # 話者ID → 話者名
    utterances: list[tuple[str, str]]  # (話者ID, 発話)
    self_speaker: str  # 質問される側（自分）の話者ID

    def sentences(self) -> list[Sentence]:
        out: list[Sentence] = []
        for u, (speaker, text) in enumerate(self.utterances):
            out.extend(
                Sentence(u, i, speaker, s) for i, s in enumerate(split_sentences(text))
            )
        return out


def split_sentences(text: str) -> list[str]:
    """発話を文に分ける。音のタグは除く"""
    text = _RE_AUDIO_TAG.sub("", text)
    return [s.strip() for s in _RE_SENTENCE.findall(text) if s.strip()]


def load_conversation(path: Path = CONVERSATION_JSON) -> Conversation:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} がありません。先に `uv run python scripts/copy_data.py <文字起こしのフォルダ> --self <話者ID>` を実行してください"
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    return Conversation(
        speakers={s["id"]: s["name"] for s in data["speakers"]},
        utterances=[(u["speakerId"], u["text"]) for u in data["utterances"]],
        self_speaker=data["selfSpeaker"],
    )

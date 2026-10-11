"""コピーした文字起こしデータの読み込み"""

import json
from dataclasses import dataclass
from pathlib import Path

from kweval.paths import DOCS, TRANSCRIPTIONS_DIR


@dataclass
class Document:
    """評価に使う1件の会話"""

    doc_id: str
    label: str
    utterances: list[str]

    @property
    def text(self) -> str:
        """ディープサーチと同じく、発話を改行でつないだテキスト"""
        return "\n".join(self.utterances)


def load_document(doc_id: str, base: Path = TRANSCRIPTIONS_DIR) -> Document:
    path = base / doc_id / "transcription.json"
    if not path.exists():
        raise FileNotFoundError(
            f"{path} がありません。先に `uv run python scripts/copy_data.py` を実行してください"
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    utterances = [u["text"].strip() for u in data["utterances"] if u["text"].strip()]
    return Document(doc_id=doc_id, label=DOCS.get(doc_id, doc_id), utterances=utterances)


def load_documents() -> list[Document]:
    return [load_document(doc_id) for doc_id in DOCS]

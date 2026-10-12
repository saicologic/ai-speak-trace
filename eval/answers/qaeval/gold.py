"""正解ファイル（gold.tsv）の読み書き

相手（質問する側）の文を1行ずつ並べ、自分への質問かどうかをつける。

列:
- key:   発話の番号.文の番号（例: 17.3）
- label: 1 = 自分への質問、0 = 質問ではない（あいづち・説明・言い直しなど）
- text:  文
- note:  メモ
"""

import csv
from pathlib import Path

from qaeval.data import Sentence

COLUMNS = ["key", "label", "text", "note"]


def format_key(key: tuple[int, int]) -> str:
    return f"{key[0]}.{key[1]}"


def parse_key(text: str) -> tuple[int, int]:
    u, i = text.split(".")
    return (int(u), int(i))


def write_sentences(path: Path, sentences: list[Sentence], labels: dict[tuple[int, int], int] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    labels = labels or {}
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(COLUMNS)
        for s in sentences:
            w.writerow([format_key(s.key), labels.get(s.key, ""), s.text, ""])


def read_gold(path: Path) -> dict[tuple[int, int], int]:
    """文ごとの正解（1 か 0）。label が空の行はエラーにする"""
    gold: dict[tuple[int, int], int] = {}
    with path.open(encoding="utf-8", newline="") as f:
        for line, row in enumerate(csv.DictReader(f, delimiter="\t"), start=2):
            label = (row.get("label") or "").strip()
            if label not in {"0", "1"}:
                raise ValueError(f"{path}:{line} の label が 0 か 1 ではありません: {label!r}")
            gold[parse_key(row["key"])] = int(label)
    return gold

"""正解ファイル（gold.tsv）の読み書き

gold.tsv の列:
- term:    語
- label:   1 = 正解（専門用語・固有名詞）、0 = 正解ではない
- type:    漢字 / カタカナ / 英字 / 複合 / 固有名（label が 1 のときだけ）
- aliases: 同じものとして数える別の書き方（| で区切る）
- note:    メモ

正解（label=1）の語が、どちらの会話に出てくるかは、本文を検索して決める。
"""

import csv
from dataclasses import dataclass, field
from pathlib import Path

from kweval.text import TYPES, normalize

COLUMNS = ["term", "label", "type", "aliases", "note"]


@dataclass
class GoldEntry:
    term: str
    label: int
    type: str = ""
    aliases: list[str] = field(default_factory=list)
    note: str = ""

    @property
    def forms(self) -> list[str]:
        """照合に使う表記（そろえた後）"""
        return list(dict.fromkeys(normalize(t) for t in [self.term, *self.aliases]))


class Gold:
    """正解の一覧と、表記から正解を引く辞書"""

    def __init__(self, entries: list[GoldEntry]):
        self.entries = entries
        self._by_form: dict[str, GoldEntry] = {}
        for e in entries:
            for form in e.forms:
                prev = self._by_form.get(form)
                # 同じ表記が正解と不正解の両方にあるときは、正解を優先する
                if prev is None or (prev.label == 0 and e.label == 1):
                    self._by_form[form] = e

    def lookup(self, term: str) -> GoldEntry | None:
        return self._by_form.get(normalize(term))

    def positives_in(self, text: str) -> list[GoldEntry]:
        """本文に出てくる正解の語"""
        norm_text = normalize(text)
        return [
            e
            for e in self.entries
            if e.label == 1 and any(form and form in norm_text for form in e.forms)
        ]


def read_gold(path: Path) -> Gold:
    entries: list[GoldEntry] = []
    with path.open(encoding="utf-8", newline="") as f:
        for i, row in enumerate(csv.DictReader(f, delimiter="\t"), start=2):
            term = (row.get("term") or "").strip()
            if not term:
                continue
            label = int((row.get("label") or "0").strip() or 0)
            type_ = (row.get("type") or "").strip()
            if label == 1 and type_ not in TYPES:
                raise ValueError(f"{path}:{i} の type が不正です: {type_!r}（{'/'.join(TYPES)}）")
            aliases = [a.strip() for a in (row.get("aliases") or "").split("|") if a.strip()]
            entries.append(GoldEntry(term, label, type_, aliases, (row.get("note") or "").strip()))
    return Gold(entries)


def write_gold(path: Path, entries: list[GoldEntry]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(COLUMNS)
        for e in entries:
            w.writerow([e.term, e.label, e.type, "|".join(e.aliases), e.note])

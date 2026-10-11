"""5. 一般的な日本語の頻度表で、ありふれた語を除く

頻度表は wordfreq の日本語のデータを使う（データは CC BY-SA 4.0、コードは Apache 2.0）。
Zipf 値（10億語あたりの出現回数の log10）が threshold 以上の語を、ありふれた語として除く。
頻度表にない語（複合語や新しい用語の多く）と、固有名詞（辞書の品詞や固有表現抽出による）は残す。
"""

import math
import unicodedata

from wordfreq import get_frequency_dict

from kweval.methods import Scored

DEFAULT_ZIPF = 4.5


class FrequencyTable:
    def __init__(self) -> None:
        self._freq: dict[str, float] | None = None

    def load(self) -> None:
        if self._freq is None:
            self._freq = get_frequency_dict("ja", wordlist="best")

    def zipf(self, term: str) -> float:
        """頻度表の Zipf 値。表にない語は 0"""
        self.load()
        key = unicodedata.normalize("NFKC", term).lower().strip()
        f = self._freq.get(key, 0.0)  # type: ignore[union-attr]
        return math.log10(f * 1e9) if f > 0 else 0.0


def filter_common(scored: list[Scored], table: FrequencyTable, threshold: float) -> list[Scored]:
    return [s for s in scored if s.proper or table.zipf(s.term) < threshold]

"""表記のそろえ方と、文字の種類の判定"""

import re
import unicodedata

KANJI = r"一-龯々〆ヵヶ"
KATAKANA = r"ァ-ヴー・"
HIRAGANA = r"ぁ-ゖ"

_RE_KANJI = re.compile(f"^[{KANJI}]+$")
_RE_KATAKANA = re.compile(f"^[{KATAKANA}]+$")
_RE_ALPHA = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .\-'&+]*$")
_RE_HIRAGANA = re.compile(f"^[{HIRAGANA}ー]+$")

# 正解の種類（gold.tsv の type 列で使う値）
TYPE_KANJI = "漢字"
TYPE_KATAKANA = "カタカナ"
TYPE_ALPHA = "英字"
TYPE_MIXED = "複合"
TYPE_NAME = "固有名"
TYPES = [TYPE_KANJI, TYPE_KATAKANA, TYPE_ALPHA, TYPE_MIXED, TYPE_NAME]


def normalize(term: str) -> str:
    """照合用に表記をそろえる（NFKC・小文字・空白を除く）"""
    s = unicodedata.normalize("NFKC", term).lower()
    return re.sub(r"\s+", "", s)


def script_type(term: str) -> str:
    """語の見た目から、漢字 / カタカナ / 英字 / 複合 のどれかを返す"""
    s = unicodedata.normalize("NFKC", term).strip()
    if _RE_KANJI.match(s):
        return TYPE_KANJI
    if _RE_KATAKANA.match(s):
        return TYPE_KATAKANA
    if _RE_ALPHA.match(s):
        return TYPE_ALPHA
    return TYPE_MIXED


def is_hiragana_only(term: str) -> bool:
    return bool(_RE_HIRAGANA.match(term))

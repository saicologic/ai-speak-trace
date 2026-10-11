"""形態素解析を使う手法で共通の、名詞の連続の取り出しと絞り込み"""

import re
from dataclasses import dataclass

from kweval.text import is_hiragana_only

# 語の末尾について名詞の連続をつなぐが、語には含めない敬称など
HONORIFICS = {"さん", "さま", "様", "くん", "君", "ちゃん", "氏", "たち", "達", "ら"}

# 話者名などの、アプリが自動でつける名前
SPEAKER_NAMES = re.compile(r"^[A-Z]さん$")

# 文字起こしに入る音のタグ（[笑い] など）
_RE_AUDIO_TAG = re.compile(r"\[[^\]]*\]")

_RE_ASCII_WORD = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-'&+]*$")
_RE_NUMERIC = re.compile(r"^[0-9０-９一二三四五六七八九十百千万億兆〇.,，．]+$")


@dataclass
class Morph:
    """名詞の連続を作るのに使う、形態素の情報"""

    surface: str
    pos: tuple[str, ...]
    # 後ろに空白があるか（「Claude Code」のような英語の複数語をつなぐのに使う）
    space_after: bool = False


def from_sudachi(morphemes) -> list[Morph]:
    """SudachiPy の形態素の列を Morph の列にする。空白の形態素は前の語の space_after にする"""
    out: list[Morph] = []
    for m in morphemes:
        pos = tuple(m.part_of_speech())
        if pos[0] == "空白":
            if out:
                out[-1].space_after = True
            continue
        out.append(Morph(m.surface(), pos))
    return out


def from_spacy(tokens) -> list[Morph]:
    """GiNZA（spaCy）のトークンの列を Morph の列にする"""
    out: list[Morph] = []
    for t in tokens:
        pos = tuple(t.tag_.split("-")) + ("*",) * 4
        if pos[0] == "空白":
            if out:
                out[-1].space_after = True
            continue
        out.append(Morph(t.text, pos, bool(t.whitespace_)))
    return out


def strip_audio_tags(text: str) -> str:
    """[笑い] のような音のタグを除く（語として拾わないように）"""
    return _RE_AUDIO_TAG.sub(" ", text)


def is_noun_like(m: Morph, first: bool) -> bool:
    """名詞の連続に入れてよい形態素か"""
    pos = m.pos
    if is_hiragana_only(m.surface) or _RE_NUMERIC.match(m.surface):
        return False
    if m.surface in HONORIFICS:
        return False
    if pos[0] == "名詞":
        # 代名詞・数詞・「今」「最近」のような副詞的な名詞は除く
        return pos[1] not in {"代名詞", "数詞"} and pos[2] != "副詞可能"
    if pos[0] == "接頭辞":
        return first
    if pos[0] == "接尾辞":
        return not first and pos[1] == "名詞的"
    # 未知語の英字は記号として扱われることがあるので、英字だけの語は名詞とみなす
    return bool(_RE_ASCII_WORD.match(m.surface))


def noun_runs(morphs: list[Morph]) -> list[tuple[int, int]]:
    """名詞の連続の位置（開始, 終了）を返す。

    英字の語の間に空白があるときだけ、空白をまたいでつなぐ。それ以外の空白では区切る。
    """
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for i, m in enumerate(morphs):
        if start is not None:
            prev = morphs[i - 1]
            if prev.space_after and not (_RE_ASCII_WORD.match(prev.surface) and _RE_ASCII_WORD.match(m.surface)):
                runs.append((start, i))
                start = None
        if is_noun_like(m, first=start is None):
            if start is None:
                start = i
        elif start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(morphs)))
    # 接頭辞だけで終わる連続は落とす
    return [(s, e) for s, e in runs if morphs[e - 1].pos[0] != "接頭辞"]


def run_surfaces(morphs: list[Morph], start: int, end: int) -> list[str]:
    """連続の各形態素の表記。英字の語の後の空白は、表記の末尾に残す"""
    out = []
    for i in range(start, end):
        m = morphs[i]
        out.append(m.surface + (" " if m.space_after and i + 1 < end else ""))
    return out


def noun_sequences(morphs: list[Morph]) -> list[list[str]]:
    return [run_surfaces(morphs, s, e) for s, e in noun_runs(morphs)]


def join_morphs(seq: tuple[str, ...] | list[str]) -> str:
    return "".join(seq).strip()


def keep_term(term: str) -> bool:
    """語として残すかどうか（短すぎる語や話者名を除く）"""
    if len(term) < 2 or SPEAKER_NAMES.match(term):
        return False
    if is_hiragana_only(term) or _RE_NUMERIC.match(term):
        return False
    return True

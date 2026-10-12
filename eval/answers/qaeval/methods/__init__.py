"""相手の文から、自分への質問を取り出す手法

どの手法も、相手（自分以外の話者）の文だけを見て、質問と判定した文の位置を返す。
"""

from collections.abc import Callable

from qaeval.data import Conversation

Method = Callable[[Conversation], set[tuple[int, int]]]

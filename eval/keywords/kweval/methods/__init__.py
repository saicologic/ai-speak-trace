"""比べる手法"""

from dataclasses import dataclass


@dataclass
class Scored:
    """抽出した語と点数（大きいほど上位）"""

    term: str
    score: float
    count: int = 0
    # 固有名詞か（頻度表で除かないようにするため）
    proper: bool = False


class Method:
    """手法の共通の形"""

    name: str = ""
    label: str = ""

    def setup(self) -> None:
        """辞書やモデルの読み込み（処理時間とは別に測る）"""

    def extract(self, utterances: list[str]) -> list[Scored]:
        raise NotImplementedError

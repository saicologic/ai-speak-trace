import pytest

from qaeval.data import Conversation


@pytest.fixture
def conv() -> Conversation:
    """相手（B）が質問し、自分（A）が答える小さな会話"""
    return Conversation(
        speakers={"A": "Aさん", "B": "Bさん"},
        utterances=[
            ("B", "よろしくお願いします。今日は何社ぐらい応募されてますか？"),  # 0
            ("A", "三社です。"),  # 1
            ("B", "うんうん。"),  # 2
            ("A", "来週面接があります。"),  # 3
            ("B", "ありがとうございます。バックエンドのエンジニアみたいな感じで。"),  # 4
            ("A", "はい、そうです。"),  # 5
            ("B", "この辺はいかがですか。"),  # 6
            ("A", "大丈夫です。"),  # 7
        ],
        self_speaker="A",
    )

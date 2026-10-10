"""評価セット（JSONL）の型と入出力"""

import json
from pathlib import Path

from pydantic import BaseModel, Field


class TestCase(BaseModel):
    """評価セットの1問"""

    # pytest がテストクラスとして収集しないようにする
    __test__ = False

    id: str
    # 回答に必要な情報を問う質問（Ragas の user_input）
    question: str
    # ディープサーチ画面でユーザーが選ぶ想定の検索キーワード
    keywords: list[str] = Field(min_length=1)
    # 模範解答（Ragas の reference）
    reference_answer: str
    # 正解の根拠となる原文の抜粋。検索結果にいずれかが含まれていれば「正解チャンク」とみなす。
    # チャンク ID ではなく原文で判定するため、チャンクサイズを変えても同じ評価セットを使える。
    evidence: list[str] = Field(min_length=1)
    # 会話を起点にした問題の場合、検索対象の文字起こしID。None なら PDF のみを検索する
    transcription_id: str | None = None
    # 生成元の情報（documentId など）。評価には使わない
    source: dict[str, str] = Field(default_factory=dict)


def load_testset(path: Path) -> list[TestCase]:
    """JSONL ファイルから評価セットを読み込む"""
    cases = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                cases.append(TestCase.model_validate_json(line))
    return cases


def save_testset(path: Path, cases: list[TestCase]) -> None:
    """評価セットを JSONL ファイルに書き出す"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for case in cases:
            f.write(json.dumps(case.model_dump(), ensure_ascii=False) + "\n")

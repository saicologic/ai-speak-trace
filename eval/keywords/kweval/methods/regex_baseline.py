"""1. 今の手法（基準）：keywords.ts の extractKeywords を Node で実行する"""

import json
import shutil
import subprocess

from kweval.methods import Method, Scored
from kweval.paths import KEYWORDS_TS, ROOT

SCRIPT = ROOT / "baseline" / "extract_regex.mjs"


def run_node(texts: dict[str, str]) -> dict[str, dict]:
    """Node で extractKeywords を実行し、ID ごとの結果を返す"""
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("node が見つかりません（Node 22.18 以上が必要です）")
    payload = json.dumps([{"id": k, "text": v} for k, v in texts.items()], ensure_ascii=False)
    proc = subprocess.run(
        [node, "--no-warnings", str(SCRIPT), str(KEYWORDS_TS)],
        input=payload,
        capture_output=True,
        text=True,
        check=True,
    )
    return {r["id"]: r for r in json.loads(proc.stdout)}


class RegexBaseline(Method):
    name = "regex"
    label = "1. 今の正規表現（基準）"

    def __init__(self) -> None:
        self.last_elapsed_ms: float | None = None

    def extract(self, utterances: list[str]) -> list[Scored]:
        # アプリのディープサーチと同じく、発話を改行でつないで渡す
        result = run_node({"doc": "\n".join(utterances)})["doc"]
        # Node の起動時間を除いた、extractKeywords だけの時間
        self.last_elapsed_ms = result["elapsedMs"]
        return [Scored(k["text"], float(k["count"]), k["count"]) for k in result["keywords"]]

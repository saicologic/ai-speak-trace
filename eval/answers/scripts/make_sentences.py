"""正解をつけるための、相手の文の一覧（.data/sentences.tsv）を作る

すでに .data/gold.tsv があれば、そこでつけた判定を引き継ぐ。
label 列に 1（自分への質問）か 0 をつけ、.data/gold.tsv として保存する。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qaeval.data import load_conversation  # noqa: E402
from qaeval.gold import read_gold, write_sentences  # noqa: E402
from qaeval.paths import GOLD_TSV, SENTENCES_TSV  # noqa: E402


def main() -> None:
    conv = load_conversation()
    sentences = [s for s in conv.sentences() if s.speaker_id != conv.self_speaker]
    labels = read_gold(GOLD_TSV) if GOLD_TSV.exists() else {}
    write_sentences(SENTENCES_TSV, sentences, labels)
    print(f"{SENTENCES_TSV} に {len(sentences)} 文を書き出しました（判定済み {len(labels)} 文）")


if __name__ == "__main__":
    main()

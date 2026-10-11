"""正解をつけるための候補一覧（.data/gold_candidates.tsv）を作る

全手法の結果を合わせ、表記をそろえて重ねたものを書き出す。
すでに .data/gold.tsv があれば、そこでつけた判定を引き継ぐ。
候補にない語（どの手法も拾えなかった語）は、文字起こしを読んで gold.tsv に直接足す。
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from kweval.data import load_documents  # noqa: E402
from kweval.gold import read_gold  # noqa: E402
from kweval.paths import CANDIDATES_TSV, GOLD_TSV  # noqa: E402
from kweval.runner import run_all  # noqa: E402
from kweval.text import normalize, script_type  # noqa: E402


def main() -> None:
    docs = load_documents()
    main_outputs, sweep = run_all(docs)
    gold = read_gold(GOLD_TSV) if GOLD_TSV.exists() else None

    # そろえた表記ごとに、見つけた手法と会話を集める
    surfaces: dict[str, str] = {}
    methods: dict[str, set[str]] = defaultdict(set)
    in_docs: dict[str, set[str]] = defaultdict(set)
    for out in [*main_outputs, *sweep]:
        for doc_id, d in out.docs.items():
            for k in d.keywords:
                key = normalize(k.term)
                surfaces.setdefault(key, k.term)
                methods[key].add(out.name.split("+")[0])
                in_docs[key].add(doc_id)

    texts = {d.doc_id: normalize(d.text) for d in docs}
    rows = []
    for key, term in surfaces.items():
        entry = gold.lookup(term) if gold else None
        counts = {doc_id: t.count(key) for doc_id, t in texts.items()}
        rows.append(
            {
                "term": term,
                "label": "" if entry is None else entry.label,
                "type": entry.type if entry else "",
                "auto_type": script_type(term),
                "methods": ",".join(sorted(methods[key])),
                "count": sum(counts.values()),
                **{f"count_{doc_id}": n for doc_id, n in counts.items()},
            }
        )
    rows.sort(key=lambda r: (-r["count"], r["term"]))

    CANDIDATES_TSV.parent.mkdir(parents=True, exist_ok=True)
    with CANDIDATES_TSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter="\t", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    unlabeled = sum(1 for r in rows if r["label"] == "")
    print(f"{CANDIDATES_TSV} に {len(rows)} 件を書き出しました（未判定 {unlabeled} 件）")


if __name__ == "__main__":
    main()

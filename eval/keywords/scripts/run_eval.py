"""全手法を実行し、results/<日時>/ に手法ごとの結果と比べた表を保存する

正解ファイル（.data/gold.tsv）がなければ、抽出結果だけを保存する。
"""

import argparse
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from kweval.data import load_documents  # noqa: E402
from kweval.gold import read_gold  # noqa: E402
from kweval.paths import GOLD_TSV, RESULTS_DIR  # noqa: E402
from kweval.report import metrics_json, render  # noqa: E402
from kweval.runner import run_all  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gold", type=Path, default=GOLD_TSV, help="正解ファイル")
    parser.add_argument("--min-cvalue", type=float, default=1.0, help="SudachiPy で出す C-value の下限")
    args = parser.parse_args()

    docs = load_documents()
    main_outputs, sweep = run_all(docs, sudachi_min_score=args.min_cvalue)

    out_dir = RESULTS_DIR / datetime.now().strftime("%Y%m%d-%H%M%S")
    (out_dir / "methods").mkdir(parents=True, exist_ok=True)
    for out in [*main_outputs, *sweep]:
        path = out_dir / "methods" / f"{out.name}.json"
        path.write_text(json.dumps(out.to_json(), ensure_ascii=False, indent=2), encoding="utf-8")

    if not args.gold.exists():
        print(f"正解ファイル {args.gold} がないので、抽出結果だけを {out_dir} に保存しました")
        return

    gold = read_gold(args.gold)
    texts = {d.doc_id: d.text for d in docs}
    labels = {d.doc_id: d.label for d in docs}
    digest = hashlib.sha256(args.gold.read_bytes()).hexdigest()[:12]
    note = f"実行: {out_dir.name}　正解ファイル: `{args.gold.name}`（sha256 先頭 {digest}）"
    (out_dir / "metrics.json").write_text(
        json.dumps(metrics_json([*main_outputs, *sweep], gold, texts), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "report.md").write_text(render(main_outputs, sweep, gold, texts, labels, note), encoding="utf-8")
    print(f"{out_dir / 'report.md'} に保存しました")


if __name__ == "__main__":
    main()

"""全手法で相手の質問を取り出し、正解と比べて results/<日時>/ に保存する"""

import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qaeval.data import load_conversation  # noqa: E402
from qaeval.gold import format_key, read_gold  # noqa: E402
from qaeval.metrics import evaluate  # noqa: E402
from qaeval.methods.context import last_sentence_before_reply  # noqa: E402
from qaeval.methods.rules import question_mark, question_phrase  # noqa: E402
from qaeval.methods.sudachi_pos import SudachiQuestion  # noqa: E402
from qaeval.paths import GOLD_TSV, RESULTS_DIR  # noqa: E402

EXAMPLES = 20


def pct(x: float | None) -> str:
    return "—" if x is None else f"{x * 100:.1f}"


def main() -> None:
    conv = load_conversation()
    gold = read_gold(GOLD_TSV)
    texts = {s.key: s.text for s in conv.sentences()}

    t0 = time.perf_counter()
    sudachi = SudachiQuestion()
    sudachi_load_ms = (time.perf_counter() - t0) * 1000

    methods = [
        ("mark", "1. 疑問符だけ", question_mark),
        ("phrase", "2. 疑問符 + 言い回しの規則", question_phrase),
        ("phrase+reply", "3. 2 + 自分の返事", lambda c: question_phrase(c) | last_sentence_before_reply(c)),
        ("sudachi+reply", "4. SudachiPy の品詞 + 自分の返事", lambda c: sudachi(c) | last_sentence_before_reply(c)),
        ("all", "5. 2 + 4（すべての和）", lambda c: question_phrase(c) | sudachi(c) | last_sentence_before_reply(c)),
    ]

    out_dir = RESULTS_DIR / datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir.mkdir(parents=True)
    n_q = sum(gold.values())
    lines = [
        "# 相手の質問の取り出しの比較",
        "",
        f"相手の文 {len(gold)} 文のうち、自分への質問 {n_q} 文（質問を含む発話 {len({k[0] for k, v in gold.items() if v})} 件）。"
        f"SudachiPy の辞書の読み込み {sudachi_load_ms:,.0f} ms。",
        "",
        "- 文: 質問の文を取り出せたか / 発話: 質問を含む発話を見つけられたか（% で表す）",
        "- 答えの一致: 正解の質問のうち、組にした答えの範囲が正解と同じになった割合",
        "",
        "| 手法 | 文 適合率 | 文 再現率 | 文 F1 | 発話 適合率 | 発話 再現率 | 発話 F1 | 答えの一致 | 処理(ms) |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    details = []
    for name, label, method in methods:
        t1 = time.perf_counter()
        pred = method(conv)
        elapsed = (time.perf_counter() - t1) * 1000
        r = evaluate(conv, pred, gold)
        lines.append(
            f"| {label} | {pct(r.sentence.precision)} | {pct(r.sentence.recall)} | {pct(r.sentence.f1)} | "
            f"{pct(r.utterance.precision)} | {pct(r.utterance.recall)} | {pct(r.utterance.f1)} | "
            f"{pct(r.answer_match)} | {elapsed:,.0f} |"
        )
        details += [
            "",
            f"### {label}",
            "",
            f"- 取りこぼし（{len(r.false_negatives)} 文）: "
            + " / ".join(f"`{format_key(k)}` {texts[k][-40:]}" for k in r.false_negatives[:EXAMPLES]),
            f"- 誤り（{len(r.false_positives)} 文）: "
            + " / ".join(f"`{format_key(k)}` {texts[k][-40:]}" for k in r.false_positives[:EXAMPLES]),
        ]
        (out_dir / f"{name}.json").write_text(
            json.dumps({"label": label, "questions": [format_key(k) for k in sorted(pred)]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    lines += ["", "## 取りこぼしと誤り（文末の40文字まで）", *details]
    (out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{out_dir / 'report.md'} に保存しました")


if __name__ == "__main__":
    main()

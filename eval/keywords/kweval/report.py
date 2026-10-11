"""評価結果を Markdown の表にする"""

from kweval.gold import Gold
from kweval.metrics import Counts, DocResult, evaluate, precision_at_k
from kweval.runner import MethodOutput
from kweval.text import TYPE_NAME, TYPES

TOP_K = 30
EXAMPLES = 15


def pct(x: float | None) -> str:
    return "—" if x is None else f"{x * 100:.1f}"


def ms(x: float) -> str:
    return f"{x:,.0f}"


def evaluate_method(out: MethodOutput, gold: Gold, texts: dict[str, str]) -> dict[str, DocResult]:
    return {
        doc_id: evaluate([k.term for k in d.keywords], gold, texts[doc_id], TOP_K)
        for doc_id, d in out.docs.items()
    }


def total(results: dict[str, DocResult]) -> Counts:
    c = Counts()
    for r in results.values():
        c = c + r.total
    return c


def summary_row(out: MethodOutput, results: dict[str, DocResult]) -> list[str]:
    c = total(results)
    n_docs = len(out.docs)
    per_doc = sum(d.elapsed_ms for d in out.docs.values()) / n_docs if n_docs else 0.0
    return [
        out.label,
        pct(c.precision),
        pct(c.recall),
        pct(c.f1),
        pct(precision_at_k(list(results.values()))),
        str(c.tp + c.fp),
        str(sum(r.unjudged for r in results.values())),
        ms(out.setup_ms),
        ms(per_doc),
    ]


def table(header: list[str], rows: list[list[str]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return lines


def metrics_json(outputs: list[MethodOutput], gold: Gold, texts: dict[str, str]) -> dict:
    data = {}
    for out in outputs:
        results = evaluate_method(out, gold, texts)
        c = total(results)
        by_type = {}
        for t in TYPES:
            tc = Counts()
            for r in results.values():
                tc = tc + r.by_type.get(t, Counts())
            by_type[t] = {"tp": tc.tp, "fp": tc.fp, "fn": tc.fn, "precision": tc.precision, "recall": tc.recall, "f1": tc.f1}
        data[out.name] = {
            "label": out.label,
            "precision": c.precision,
            "recall": c.recall,
            "f1": c.f1,
            "precision_at_30": precision_at_k(list(results.values())),
            "tp": c.tp,
            "fp": c.fp,
            "fn": c.fn,
            "unjudged": sum(r.unjudged for r in results.values()),
            "by_type": by_type,
            "setup_ms": out.setup_ms,
            "elapsed_ms": {k: d.elapsed_ms for k, d in out.docs.items()},
        }
    return data


def render(
    main: list[MethodOutput],
    sweep: list[MethodOutput],
    gold: Gold,
    texts: dict[str, str],
    doc_labels: dict[str, str],
    header_note: str,
) -> str:
    results = {out.name: evaluate_method(out, gold, texts) for out in [*main, *sweep]}
    n_pos = {doc_id: len(gold.positives_in(t)) for doc_id, t in texts.items()}
    lines = ["# キーワード抽出の比較", "", header_note, ""]
    lines.append(
        "正解の数: "
        + "、".join(f"{doc_labels[d]}（{d}）{n} 語" for d, n in n_pos.items())
        + f"。正解ファイルの語数（正解でない語を含む）: {len(gold.entries)}"
    )
    lines += [
        "",
        "- 適合率・再現率・F1・P@30 は % で、2件の会話を合計して計算する",
        "- 件数は出した語の数（同じ正解に当たる別の書き方はまとめる）。未判定は正解ファイルにない語で、誤りとして数える",
        "- 読み込みは辞書・モデルの読み込み時間、処理は1件あたりの抽出時間（ms）。今の正規表現は Node の起動時間を除く",
        "",
        "## 全体",
        "",
    ]
    header = ["手法", "適合率", "再現率", "F1", "P@30", "件数", "未判定", "読み込み(ms)", "処理/件(ms)"]
    lines += table(header, [summary_row(out, results[out.name]) for out in main])

    lines += ["", "## 会話ごと", ""]
    rows = []
    for out in main:
        for doc_id, r in results[out.name].items():
            rows.append(
                [out.label, doc_labels[doc_id], pct(r.total.precision), pct(r.total.recall), pct(r.total.f1),
                 pct(r.top_k_correct / r.top_k_size if r.top_k_size else None), ms(out.docs[doc_id].elapsed_ms)]
            )
    lines += table(["手法", "会話", "適合率", "再現率", "F1", "P@30", "処理(ms)"], rows)

    lines += [
        "",
        "## 種類ごと",
        "",
        "正解の語は正解ファイルの種類、正解でない語は見た目（漢字 / カタカナ / 英字 / 複合）で分ける。",
        f"「{TYPE_NAME}」は正解の語だけにつく種類なので、適合率は出さず再現率だけを見る。",
        "",
    ]
    header = ["手法"] + [f"{t} 適合率 / 再現率 / F1" for t in TYPES]
    rows = []
    for out in main:
        cells = [out.label]
        for t in TYPES:
            c = Counts()
            for r in results[out.name].values():
                c = c + r.by_type.get(t, Counts())
            if t == TYPE_NAME:
                cells.append(f"— / {pct(c.recall)} / —")
            else:
                cells.append(f"{pct(c.precision)} / {pct(c.recall)} / {pct(c.f1)}")
        rows.append(cells)
    lines += table(header, rows)
    type_counts = {t: sum(1 for d in texts.values() for e in gold.positives_in(d) if e.type == t) for t in TYPES}
    lines += ["", "正解の数（2件の合計）: " + "、".join(f"{t} {n}" for t, n in type_counts.items())]

    lines += ["", "## 頻度表のしきい値を変えたとき", ""]
    header = ["手法", "適合率", "再現率", "F1", "P@30", "件数", "未判定", "読み込み(ms)", "処理/件(ms)"]
    lines += table(header, [summary_row(out, results[out.name]) for out in sweep])

    base = main[0]
    lines += ["", f"## 今の正規表現との違い（各 {EXAMPLES} 件まで、点数の高い順。なくなった正解は正規表現での順）", ""]
    for out in main[1:]:
        gained, errors, lost = [], [], []
        for doc_id, r in results[out.name].items():
            base_r = results[base.name][doc_id]
            base_found = {id(j.entry) for j in base_r.judged if j.correct}
            base_terms = {j.term for j in base_r.judged}
            found = {id(j.entry) for j in r.judged if j.correct}
            lost += [(j.rank, j.entry.term) for j in base_r.judged if j.correct and id(j.entry) not in found]
            for j in r.judged:
                if j.correct and id(j.entry) not in base_found:
                    gained.append((j.rank, j.term, doc_labels[doc_id]))
                elif not j.correct and j.term not in base_terms:
                    errors.append((j.rank, j.term + ("（未判定）" if j.unjudged else ""), doc_labels[doc_id]))
        gained_terms = list(dict.fromkeys(t for _, t, _ in sorted(gained)))
        error_terms = list(dict.fromkeys(t for _, t, _ in sorted(errors)))
        lost_terms = list(dict.fromkeys(t for _, t in sorted(lost)))
        lines += [
            f"### {out.label}",
            "",
            f"- 増えた正解（{len(gained_terms)} 語）: " + "、".join(gained_terms[:EXAMPLES]),
            f"- 新しく出た誤り（{len(error_terms)} 語）: " + "、".join(error_terms[:EXAMPLES]),
            f"- なくなった正解（{len(lost_terms)} 語）: " + "、".join(lost_terms[:EXAMPLES]),
            "",
        ]
    lines += ["## 取りこぼした正解（どの手法も拾えなかった語）", ""]
    for doc_id in texts:
        missed_all = None
        for out in main:
            missed = {id(e): e for e in results[out.name][doc_id].missed}
            missed_all = missed if missed_all is None else {k: v for k, v in missed_all.items() if k in missed}
        terms = [e.term for e in (missed_all or {}).values()]
        lines.append(f"- {doc_labels[doc_id]}: " + ("、".join(terms) if terms else "なし"))

    lines += ["", f"## 上位 {TOP_K} 件（○ 正解 / × 誤り / ? 未判定）", ""]
    for out in main:
        lines += [f"### {out.label}", ""]
        for doc_id, r in results[out.name].items():
            marks = [("○" if j.correct else "?" if j.unjudged else "×") + j.term for j in r.judged[:TOP_K]]
            lines.append(f"- {doc_labels[doc_id]}: " + "、".join(marks))
        lines.append("")
    return "\n".join(lines) + "\n"

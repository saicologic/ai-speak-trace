"""全手法を実行して、会話ごとの抽出結果と処理時間を集める"""

import time
from dataclasses import asdict, dataclass, field

from kweval.data import Document
from kweval.methods import Method, Scored
from kweval.methods.combined import Combined
from kweval.methods.freq_filter import DEFAULT_ZIPF, FrequencyTable, filter_common
from kweval.methods.ginza_ner import GinzaNer
from kweval.methods.regex_baseline import RegexBaseline
from kweval.methods.sudachi_cvalue import SudachiCValue

# 頻度表のしきい値を変えたときの比較に使う値
ZIPF_SWEEP = [4.0, 4.5, 5.0]


@dataclass
class DocOutput:
    doc_id: str
    elapsed_ms: float
    keywords: list[Scored]


@dataclass
class MethodOutput:
    name: str
    label: str
    setup_ms: float
    docs: dict[str, DocOutput] = field(default_factory=dict)
    # 手法の説明（しきい値など）
    params: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "setup_ms": round(self.setup_ms, 1),
            "params": self.params,
            "docs": {
                doc_id: {
                    "elapsed_ms": round(d.elapsed_ms, 1),
                    "keywords": [asdict(k) for k in d.keywords],
                }
                for doc_id, d in self.docs.items()
            },
        }


def _run(method: Method, docs: list[Document], params: dict | None = None) -> MethodOutput:
    t0 = time.perf_counter()
    method.setup()
    out = MethodOutput(method.name, method.label, (time.perf_counter() - t0) * 1000, params=params or {})
    for doc in docs:
        t1 = time.perf_counter()
        keywords = method.extract(doc.utterances)
        elapsed = (time.perf_counter() - t1) * 1000
        # 基準は Node の起動時間を除いた、extractKeywords だけの時間を使う
        if isinstance(method, RegexBaseline) and method.last_elapsed_ms is not None:
            elapsed = method.last_elapsed_ms
        out.docs[doc.doc_id] = DocOutput(doc.doc_id, elapsed, keywords)
    return out


def _filtered(
    base: MethodOutput, table: FrequencyTable, table_ms: float, threshold: float, number: str = "5"
) -> MethodOutput:
    """別の手法の結果に頻度表の絞り込みをかける。読み込み・処理時間は元の手法の時間に足す"""
    setup_ms = base.setup_ms + table_ms
    base_label = base.label.split(". ", 1)[-1]
    out = MethodOutput(
        f"{base.name}+freq{threshold:g}",
        f"{number}. {base_label} + 頻度表（Zipf≥{threshold:g} を除く）",
        setup_ms,
        params={**base.params, "zipf_threshold": threshold},
    )
    for doc_id, d in base.docs.items():
        t1 = time.perf_counter()
        kept = filter_common(d.keywords, table, threshold)
        out.docs[doc_id] = DocOutput(doc_id, d.elapsed_ms + (time.perf_counter() - t1) * 1000, kept)
    return out


def run_all(docs: list[Document], sudachi_min_score: float = 1.0) -> tuple[list[MethodOutput], list[MethodOutput]]:
    """主な比較の手法と、頻度表のしきい値を変えたものを返す"""
    sudachi = SudachiCValue(min_score=sudachi_min_score)
    ginza = GinzaNer()
    regex_out = _run(RegexBaseline(), docs)
    sudachi_out = _run(sudachi, docs, {"min_cvalue": sudachi_min_score})
    ginza_out = _run(ginza, docs)
    combined_out = _run(Combined(sudachi, ginza), docs, {"min_cvalue": sudachi_min_score})
    # 組み合わせは、SudachiPy と GiNZA を両方読み込む時間がかかる
    combined_out.setup_ms = sudachi_out.setup_ms + ginza_out.setup_ms

    table = FrequencyTable()
    t0 = time.perf_counter()
    table.load()
    table_ms = (time.perf_counter() - t0) * 1000
    main = [
        regex_out,
        _filtered(regex_out, table, table_ms, DEFAULT_ZIPF),
        sudachi_out,
        ginza_out,
        combined_out,
        _filtered(sudachi_out, table, table_ms, DEFAULT_ZIPF),
        _filtered(combined_out, table, table_ms, DEFAULT_ZIPF),
    ]
    sweep = [
        _filtered(base, table, table_ms, z)
        for base in (regex_out, sudachi_out, ginza_out, combined_out)
        for z in ZIPF_SWEEP
    ]
    return main, sweep

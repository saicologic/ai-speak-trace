import shutil

import pytest

from kweval.methods.regex_baseline import RegexBaseline


@pytest.mark.skipif(shutil.which("node") is None, reason="node がない")
def test_keywords_ts_をそのまま実行する():
    result = RegexBaseline().extract(["量子化とLLMのファインチューニング", "ファインチューニング"])
    assert [(s.term, s.count) for s in result] == [("ファインチューニング", 2), ("LLM", 1)]

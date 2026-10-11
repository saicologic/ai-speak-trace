from kweval.gold import GoldEntry, read_gold, write_gold
from kweval.text import normalize, script_type


def test_normalize():
    assert normalize("Ｃｌａｕｄｅ　Code") == "claudecode"
    assert normalize("ＬＬＭ") == "llm"


def test_script_type():
    assert script_type("強化学習") == "漢字"
    assert script_type("プロンプト") == "カタカナ"
    assert script_type("LLM as a Judge") == "英字"
    assert script_type("生成AI") == "複合"
    assert script_type("型チェック") == "複合"


def test_正解ファイルを書いて読む(tmp_path):
    path = tmp_path / "gold.tsv"
    write_gold(path, [GoldEntry("RAG", 1, "英字", ["ラグ"], "メモ"), GoldEntry("会社", 0)])
    gold = read_gold(path)
    assert gold.lookup("ラグ").term == "RAG"
    assert gold.lookup("会社").label == 0
    assert gold.lookup("ほげ") is None


def test_正解の種類が不正ならエラー(tmp_path):
    path = tmp_path / "gold.tsv"
    path.write_text("term\tlabel\ttype\taliases\tnote\nRAG\t1\t略語\t\t\n", encoding="utf-8")
    try:
        read_gold(path)
    except ValueError as e:
        assert "type" in str(e)
    else:
        raise AssertionError("ValueError になるはず")

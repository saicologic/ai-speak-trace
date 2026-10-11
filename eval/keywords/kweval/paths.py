"""実験で使うパスと対象データの定義"""

from pathlib import Path

# eval/keywords/ の絶対パス
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / ".data"
TRANSCRIPTIONS_DIR = DATA_DIR / "transcriptions"
RESULTS_DIR = ROOT / "results"
REPO_ROOT = ROOT.parent.parent
KEYWORDS_TS = REPO_ROOT / "frontend" / "src" / "utils" / "keywords.ts"

# アプリのデータの置き場所（読むだけ。書き込まない）
APP_TRANSCRIPTIONS_DIR = (
    Path.home()
    / "Library"
    / "Application Support"
    / "io.github.saicologic.ai-speak-trace"
    / "data"
    / "transcriptions"
)

# 評価に使う実データ（この2件だけを使う）
DOCS: dict[str, str] = {
    "B5AAEA5F": "前編",
    "9F5F9DEC": "後編",
}

# 正解ファイルと、正解をつけるための候補一覧
GOLD_TSV = DATA_DIR / "gold.tsv"
CANDIDATES_TSV = DATA_DIR / "gold_candidates.tsv"

"""実験で使うパス"""

from pathlib import Path

# eval/answers/ の絶対パス
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / ".data"
RESULTS_DIR = ROOT / "results"

# コピーした会話（copy_data.py で作る）
CONVERSATION_JSON = DATA_DIR / "conversation.json"
# 文に分けた一覧と正解
SENTENCES_TSV = DATA_DIR / "sentences.tsv"
GOLD_TSV = DATA_DIR / "gold.tsv"

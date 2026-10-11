"""アプリのデータから評価に使う2件の文字起こしを .data/ にコピーする

アプリのデータは読むだけで、書き込まない。
"""

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from kweval.paths import APP_TRANSCRIPTIONS_DIR, DOCS, TRANSCRIPTIONS_DIR  # noqa: E402


def find_source(doc_id: str) -> Path:
    """ID の先頭8文字から、アプリのデータのフォルダを探す"""
    matches = sorted(p for p in APP_TRANSCRIPTIONS_DIR.glob(f"{doc_id}*") if p.is_dir())
    if len(matches) != 1:
        raise SystemExit(f"{doc_id} のフォルダが1つに決まりません: {matches}")
    return matches[0]


def main() -> None:
    for doc_id in DOCS:
        src = find_source(doc_id) / "transcription.json"
        dest_dir = TRANSCRIPTIONS_DIR / doc_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest_dir / "transcription.json")
        print(f"コピーしました: {src.parent.name} -> {dest_dir}")


if __name__ == "__main__":
    main()

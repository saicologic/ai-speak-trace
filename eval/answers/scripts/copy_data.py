"""アプリの文字起こしを1件、.data/conversation.json にコピーする

評価に要る項目（話者・発話）だけを残し、質問される側（自分）の話者IDを足す。
アプリのデータは読むだけで、書き込まない。

使い方:
  uv run python scripts/copy_data.py <文字起こしのフォルダ> --self speaker_0
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qaeval.paths import CONVERSATION_JSON  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path, help="transcription.json があるフォルダ")
    parser.add_argument("--self", dest="self_speaker", required=True, help="質問される側（自分）の話者ID")
    args = parser.parse_args()

    data = json.loads((args.source / "transcription.json").read_text(encoding="utf-8"))
    speaker_ids = {s["id"] for s in data["speakers"]}
    if args.self_speaker not in speaker_ids:
        raise SystemExit(f"話者ID {args.self_speaker} がありません（{sorted(speaker_ids)}）")
    out = {
        "selfSpeaker": args.self_speaker,
        "speakers": [{"id": s["id"], "name": s["name"]} for s in data["speakers"]],
        "utterances": [{"speakerId": u["speakerId"], "text": u["text"]} for u in data["utterances"]],
    }
    CONVERSATION_JSON.parent.mkdir(parents=True, exist_ok=True)
    CONVERSATION_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(out['utterances'])} 件の発話を {CONVERSATION_JSON} にコピーしました")


if __name__ == "__main__":
    main()

"""文字起こし（会話）から評価セットを自動生成する

使い方:
  uv run python -m rag_eval.generate_conversation_testset \\
      --transcription-id <文字起こしID> --size 10 --output datasets/<名前>.jsonl

会話全文を Claude に読ませ、「会話から答えられる質問・模範解答・根拠の発話・検索キーワード」を
まとめて作らせる。根拠が発話と一字一句一致しない問題や、会話に出てこないキーワードは捨てる。
生成後は必ず人の目で確認し、不自然な問題を削除・修正してから評価に使うこと。
"""

import argparse
import json
from pathlib import Path

import anthropic
from pydantic import BaseModel, Field

from rag_eval.config import (
    DEFAULT_MODEL,
    TRANSCRIPTIONS_DIR,
    estimate_cost,
    get_anthropic_api_key,
)
from rag_eval.testset import TestCase, save_testset

PROMPT_TEMPLATE = """以下はポッドキャスト（会話）の文字起こしです。
この会話を検索・分析するシステムの評価用に、問題を{size}個作成してください。

各問題の要件:
- question: 会話の中で語られた内容について、会話を読めば答えられる具体的な質問。「この会話では」など出典を指す表現は使わない
- reference_answer: 質問への簡潔な模範解答（会話の内容のみに基づく。1〜3文）
- evidence: 回答の根拠となる発話の一部を、文字起こしから一字一句そのまま抜き出したもの（1〜3個、各10〜60文字）
- keywords: この話題を調べたいユーザーが検索画面で入力しそうなキーワード（1〜3個）。会話の中にそのままの表記で出てくる専門用語・固有名詞を選ぶ

問題全体の要件:
- 会話の序盤・中盤・終盤から偏りなく選び、話題が重ならないようにする
- 雑談や自己紹介ではなく、技術的・内容的な話題を中心にする

<transcript>
{transcript}
</transcript>"""


class GeneratedCase(BaseModel):
    """Claude に生成させる問題の構造"""

    question: str
    reference_answer: str
    evidence: list[str] = Field(min_length=1, max_length=3)
    keywords: list[str] = Field(min_length=1, max_length=3)


class GeneratedCases(BaseModel):
    """Claude に生成させる問題の一覧"""

    cases: list[GeneratedCase]


def load_utterances(transcription_id: str) -> tuple[str, list[str]]:
    """文字起こしファイルから音声ファイル名と、「話者: 発話」形式の行を読み込む"""
    path = TRANSCRIPTIONS_DIR / transcription_id / "transcription.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    lines = [f"{u['speakerName']}: {u['text']}" for u in data["utterances"]]
    return data["audioFileName"], lines


def validate_case(case: GeneratedCase, utterances: list[str]) -> GeneratedCase | None:
    """根拠とキーワードが会話に実在するものだけを残す。どちらかが空になれば None

    文字起こしは PDF と違って空白の揺れがないため、正規化せず発話の原文との部分一致で確かめる
    （正規化すると、発話にない「helloworld」が「hello world」に一致してしまう）
    """
    evidence = [e for e in case.evidence if e.strip() and any(e in u for u in utterances)]
    keywords = [k for k in case.keywords if k.strip() and any(k in u for u in utterances)]
    if not evidence or not keywords:
        return None
    return case.model_copy(update={"evidence": evidence, "keywords": keywords})


def main() -> None:
    parser = argparse.ArgumentParser(description="文字起こしから評価セットを生成する")
    parser.add_argument("--transcription-id", required=True)
    parser.add_argument("--size", type=int, default=10, help="生成する問題数")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    audio_file_name, utterances = load_utterances(args.transcription_id)
    print(f"文字起こし: {audio_file_name}（{len(utterances)}発話）")

    client = anthropic.Anthropic(api_key=get_anthropic_api_key())
    response = client.messages.parse(
        model=args.model,
        max_tokens=16000,
        messages=[
            {
                "role": "user",
                "content": PROMPT_TEMPLATE.format(
                    size=args.size, transcript="\n".join(utterances)
                ),
            }
        ],
        output_format=GeneratedCases,
    )
    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise SystemExit(f"問題を生成できませんでした（stop_reason={response.stop_reason}）")

    cases: list[TestCase] = []
    for generated in response.parsed_output.cases:
        valid = validate_case(generated, utterances)
        if valid is None:
            print(f"  スキップ（根拠またはキーワードが会話にない）: {generated.question}")
            continue
        cases.append(
            TestCase(
                id=f"q{len(cases) + 1:03d}",
                transcription_id=args.transcription_id,
                source={"audioFileName": audio_file_name},
                **valid.model_dump(),
            )
        )
        print(f"  [{len(cases)}] {valid.question}（キーワード: {', '.join(valid.keywords)}）")

    save_testset(args.output, cases)
    usage = response.usage
    cost = estimate_cost(
        args.model,
        usage.input_tokens,
        usage.output_tokens,
        cache_creation_tokens=usage.cache_creation_input_tokens or 0,
        cache_read_tokens=usage.cache_read_input_tokens or 0,
    )
    print(f"評価セットを保存しました: {args.output}（{len(cases)}問）")
    print(
        f"使用量: 入力 {usage.input_tokens} / 出力 {usage.output_tokens} トークン"
        + (f"（約 ${cost:.2f}）" if cost is not None else "")
    )


if __name__ == "__main__":
    main()

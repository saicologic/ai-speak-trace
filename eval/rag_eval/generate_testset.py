"""S3 Vectors に登録済みの PDF チャンクから評価セットを自動生成する

使い方:
  uv run python -m rag_eval.generate_testset --size 30 --output datasets/testset.jsonl

チャンクをランダムに選び、Claude に「そのチャンクだけで答えられる質問・模範解答・根拠の抜粋・
検索キーワード」を作らせる。根拠がチャンク原文に含まれない問題は捨てる。
生成後は必ず人の目で確認し、不自然な問題を削除・修正してから評価に使うこと。
"""

import argparse
import random
from pathlib import Path

import anthropic
import boto3
from pydantic import BaseModel, Field

from rag_eval.config import DEFAULT_MODEL, get_anthropic_api_key, get_s3_vectors_config
from rag_eval.retrieval_metrics import matched_evidence
from rag_eval.testset import TestCase, save_testset

# 短すぎるチャンクからは良い問題を作れないため除外する
MIN_CHUNK_LENGTH = 200

PROMPT_TEMPLATE = """以下は資料（PDF）から抽出したテキストの一部です。
このテキストを使って、検索システムの評価用の問題を1つ作成してください。

要件:
- question: このテキストを読めば答えられる具体的な質問。「このテキスト」「本資料」など出典を指す表現は使わない
- reference_answer: 質問への簡潔な模範解答（テキストの内容のみに基づく）
- evidence: 回答の根拠となる箇所を、テキストから一字一句そのまま抜き出したもの（1〜2個、各10〜80文字）
- keywords: この情報を探すユーザーが検索画面で入力しそうなキーワード（2〜4個）。質問文をそのまま分割するのではなく、名詞や専門用語を選ぶ

<text>
{text}
</text>"""


class GeneratedCase(BaseModel):
    """Claude に生成させる問題の構造"""

    question: str
    reference_answer: str
    evidence: list[str] = Field(min_length=1, max_length=2)
    keywords: list[str] = Field(min_length=2, max_length=4)


def list_chunks(config: dict[str, str]) -> list[dict[str, str]]:
    """S3 Vectors からチャンクのメタデータ（text / documentId / fileName / chunkIndex）を全件取得する"""
    client = boto3.client("s3vectors", region_name=config["region"])
    chunks: list[dict[str, str]] = []
    next_token: str | None = None
    while True:
        params = {
            "vectorBucketName": config["bucket"],
            "indexName": config["index"],
            "returnMetadata": True,
            "maxResults": 500,
        }
        if next_token:
            params["nextToken"] = next_token
        response = client.list_vectors(**params)
        for vector in response.get("vectors", []):
            metadata = vector.get("metadata") or {}
            if len(metadata.get("text", "")) >= MIN_CHUNK_LENGTH:
                chunks.append({k: str(v) for k, v in metadata.items()})
        next_token = response.get("nextToken")
        if not next_token:
            return chunks


def generate_case(
    client: anthropic.Anthropic, model: str, chunk: dict[str, str]
) -> GeneratedCase | None:
    """1チャンクから問題を生成する。根拠が原文にない・拒否された場合は None"""
    response = client.messages.parse(
        model=model,
        max_tokens=16000,
        messages=[{"role": "user", "content": PROMPT_TEMPLATE.format(text=chunk["text"])}],
        output_format=GeneratedCase,
    )
    if response.stop_reason == "refusal" or response.parsed_output is None:
        return None
    case = response.parsed_output
    # 抜粋が原文と一致しない（言い換えられた）根拠は正解判定に使えないため捨てる
    case.evidence = [
        e for i, e in enumerate(case.evidence) if i in matched_evidence(chunk["text"], case.evidence)
    ]
    return case if case.evidence else None


def main() -> None:
    parser = argparse.ArgumentParser(description="PDF チャンクから評価セットを生成する")
    parser.add_argument("--size", type=int, default=30, help="生成する問題数")
    parser.add_argument("--output", type=Path, default=Path("datasets/testset.jsonl"))
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--seed", type=int, default=42, help="チャンク抽出の乱数シード")
    args = parser.parse_args()

    chunks = list_chunks(get_s3_vectors_config())
    if not chunks:
        raise SystemExit("S3 Vectors にチャンクがありません。先にアプリで PDF をアップロードしてください。")
    print(f"チャンク取得: {len(chunks)}件")

    rng = random.Random(args.seed)
    candidates = rng.sample(chunks, len(chunks))
    client = anthropic.Anthropic(api_key=get_anthropic_api_key())

    cases: list[TestCase] = []
    for chunk in candidates:
        if len(cases) >= args.size:
            break
        try:
            generated = generate_case(client, args.model, chunk)
        except anthropic.APIError as e:
            # レート制限などで1件失敗しても、生成済みのケースを失わないよう次のチャンクへ進む
            print(f"  生成失敗: {chunk.get('fileName')} #{chunk.get('chunkIndex')}: {e}")
            continue
        if generated is None:
            print(f"  スキップ: {chunk.get('fileName')} #{chunk.get('chunkIndex')}")
            continue
        cases.append(
            TestCase(
                id=f"q{len(cases) + 1:03d}",
                source={
                    "documentId": chunk.get("documentId", ""),
                    "fileName": chunk.get("fileName", ""),
                    "chunkIndex": chunk.get("chunkIndex", ""),
                },
                **generated.model_dump(),
            )
        )
        print(f"  [{len(cases)}/{args.size}] {generated.question}")

    save_testset(args.output, cases)
    print(f"評価セットを保存しました: {args.output}（{len(cases)}問）")


if __name__ == "__main__":
    main()

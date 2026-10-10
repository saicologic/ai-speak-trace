"""評価スクリプト共通の設定"""

import json
import os
from pathlib import Path

# テストセット生成と LLM-as-a-Judge に使う Claude モデル
DEFAULT_MODEL = "claude-opus-5-5"

# デスクトップアプリのデータ保存先
APP_SUPPORT_DIR = Path.home() / "Library/Application Support/io.github.saicologic.ai-speak-trace"

# デスクトップアプリの設定ファイル（API キーの取得元）
APP_SETTINGS_PATH = APP_SUPPORT_DIR / "settings.json"

# 文字起こし結果の保存先（環境変数 DATA_DIR があればバックエンドと同じくそちらを使う）
TRANSCRIPTIONS_DIR = Path(os.environ.get("DATA_DIR", APP_SUPPORT_DIR / "data")) / "transcriptions"

# Claude の料金（USD / 100万トークン）。費用の概算に使う
MODEL_PRICES = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float | None:
    """トークン数から費用（USD）を概算する。料金表にないモデルは None"""
    if model not in MODEL_PRICES:
        return None
    input_price, output_price = MODEL_PRICES[model]
    return (input_tokens * input_price + output_tokens * output_price) / 1_000_000


def get_anthropic_api_key() -> str:
    """環境変数 ANTHROPIC_API_KEY、なければアプリの settings.json から API キーを取得する"""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    if APP_SETTINGS_PATH.exists():
        settings = json.loads(APP_SETTINGS_PATH.read_text(encoding="utf-8"))
        key = settings.get("anthropicApiKey")
        if key:
            return key
    raise RuntimeError(
        "Anthropic API キーが見つかりません。ANTHROPIC_API_KEY を設定するか、"
        "アプリの設定画面で API キーを保存してください。"
    )


def get_s3_vectors_config() -> dict[str, str]:
    """バックエンドと同じ環境変数から S3 Vectors の接続先を取得する"""
    bucket = os.environ.get("S3_VECTORS_BUCKET", "")
    if not bucket:
        raise RuntimeError("S3_VECTORS_BUCKET が設定されていません")
    return {
        "region": os.environ.get("AWS_REGION", "ap-northeast-1"),
        "bucket": bucket,
        "index": os.environ.get("S3_VECTORS_INDEX", "documents"),
    }

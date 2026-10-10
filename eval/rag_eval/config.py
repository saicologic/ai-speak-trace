"""評価スクリプト共通の設定"""

import json
import os
from pathlib import Path

# テストセット生成と LLM-as-a-Judge に使う Claude モデル
DEFAULT_MODEL = "claude-opus-5-5"

# デスクトップアプリの設定ファイル（API キーの取得元）
APP_SETTINGS_PATH = (
    Path.home()
    / "Library/Application Support/io.github.saicologic.ai-speak-trace/settings.json"
)


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

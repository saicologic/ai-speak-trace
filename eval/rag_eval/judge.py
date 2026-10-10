"""Ragas の LLM-as-a-Judge に使う Claude の設定"""

import json
from dataclasses import dataclass

import httpx2
import instructor
from anthropic import AsyncAnthropic
from ragas.llms.base import InstructorLLM, InstructorModelArgs

from rag_eval.config import estimate_cost, get_anthropic_api_key


@dataclass
class UsageTracker:
    """Claude API の応答からトークン使用量を集計する"""

    model: str
    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0

    async def on_response(self, response: httpx2.Response) -> None:
        """HTTP クライアントのレスポンスフック。Messages API の usage を加算する"""
        if not response.url.path.endswith("/messages") or response.status_code != 200:
            return
        await response.aread()
        usage = json.loads(response.content).get("usage") or {}
        self.requests += 1
        self.input_tokens += (
            usage.get("input_tokens", 0)
            + usage.get("cache_creation_input_tokens", 0)
            + usage.get("cache_read_input_tokens", 0)
        )
        self.output_tokens += usage.get("output_tokens", 0)

    def summary(self) -> dict[str, float]:
        """集計結果（費用は概算）"""
        cost = estimate_cost(self.model, self.input_tokens, self.output_tokens)
        return {
            "judge_requests": self.requests,
            "judge_input_tokens": self.input_tokens,
            "judge_output_tokens": self.output_tokens,
            "judge_cost_usd": round(cost, 4) if cost is not None else float("nan"),
        }


def create_judge_llm(model: str, tracker: UsageTracker | None = None) -> InstructorLLM:
    """Ragas のメトリクスに渡す Claude を作成する

    Ragas の既定設定は現行の Claude では 400 エラーになるため、次の2点を変えている。
    - Instructor の既定（ANTHROPIC_TOOLS）は tool_choice でツール呼び出しを強制するが、
      現行モデルは強制ツール呼び出しを受け付けない。JSON モードで構造化出力を得る。
    - temperature / top_p は現行モデルでは指定できないため送らない。
    """
    # anthropic SDK 1.x は httpx ではなく httpx2 のクライアントを受け取る
    http_client = httpx2.AsyncClient(
        timeout=600.0,
        event_hooks={"response": [tracker.on_response]} if tracker else {},
    )
    client = instructor.from_anthropic(
        AsyncAnthropic(api_key=get_anthropic_api_key(), http_client=http_client),
        mode=instructor.Mode.ANTHROPIC_JSON,
    )
    llm = InstructorLLM(
        client=client,
        model=model,
        provider="anthropic",
        model_args=InstructorModelArgs(max_tokens=16000),
    )
    llm.model_args.pop("temperature", None)
    llm.model_args.pop("top_p", None)
    return llm

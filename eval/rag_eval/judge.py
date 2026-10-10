"""Ragas の LLM-as-a-Judge に使う Claude の設定"""

import instructor
from anthropic import AsyncAnthropic
from ragas.llms.base import InstructorLLM, InstructorModelArgs

from rag_eval.config import get_anthropic_api_key


def create_judge_llm(model: str) -> InstructorLLM:
    """Ragas のメトリクスに渡す Claude を作成する

    Ragas の既定設定は現行の Claude では 400 エラーになるため、次の2点を変えている。
    - Instructor の既定（ANTHROPIC_TOOLS）は tool_choice でツール呼び出しを強制するが、
      現行モデルは強制ツール呼び出しを受け付けない。JSON モードで構造化出力を得る。
    - temperature / top_p は現行モデルでは指定できないため送らない。
    """
    client = instructor.from_anthropic(
        AsyncAnthropic(api_key=get_anthropic_api_key()),
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

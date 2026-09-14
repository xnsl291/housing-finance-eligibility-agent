"""API 서버 실행 진입점.

    python -m housing_finance_agent.serve

**127.0.0.1에만 바인딩한다.** 이 API에는 인증이 없다. 0.0.0.0으로 열면 같은 망의
누구나 신청자 조건을 넣어 볼 수 있다.
"""

from __future__ import annotations

import os

import uvicorn

from housing_finance_agent.api import create_app
from housing_finance_agent.ollama import OllamaLlmClient


def build_app():
    return create_app(
        OllamaLlmClient(
            endpoint=os.environ.get("HFA_OLLAMA_URL", "http://127.0.0.1:11434"),
            model=os.environ.get("HFA_OLLAMA_MODEL", "qwen3.5:4b-q4_K_M"),
        )
    )


if __name__ == "__main__":
    uvicorn.run(build_app(), host="127.0.0.1", port=int(os.environ.get("HFA_PORT", 8000)))

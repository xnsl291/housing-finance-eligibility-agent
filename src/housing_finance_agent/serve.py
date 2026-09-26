"""API 서버 실행 진입점.

    python -m housing_finance_agent.serve

환경변수

    HFA_PORT            API 포트 (기본 8000)
    HFA_OLLAMA_URL      Ollama 주소
    HFA_OLLAMA_MODEL    모델 이름
    HFA_OLLAMA_TIMEOUT  LLM 한 번 부를 때 기다리는 초 (기본 120)

**GPU가 없는 컴퓨터는 제한 시간을 늘려야 한다.** CPU로만 돌리면 문장 하나에 1분이
넘게 걸린다(2026-09-24 측정 76초). 기본값 120초로는 조금만 부하가 걸려도 넘어간다.

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
            timeout_seconds=float(os.environ.get("HFA_OLLAMA_TIMEOUT", "120")),
        )
    )


if __name__ == "__main__":
    uvicorn.run(build_app(), host="127.0.0.1", port=int(os.environ.get("HFA_PORT", 8000)))

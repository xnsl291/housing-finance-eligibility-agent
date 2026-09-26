"""서버 실행 설정."""

from __future__ import annotations

import pytest

from housing_finance_agent import serve


def test_LLM_제한_시간을_환경변수로_늘린다(monkeypatch: pytest.MonkeyPatch) -> None:
    """GPU가 없으면 문장 하나에 1분이 넘는다(2026-09-24 측정 76초). 기본 120초로는 넘어간다."""
    잡힌 = {}

    class 가짜_클라이언트:
        def __init__(self, **kwargs: object) -> None:
            잡힌.update(kwargs)

    monkeypatch.setattr(serve, "OllamaLlmClient", 가짜_클라이언트)
    monkeypatch.setenv("HFA_OLLAMA_TIMEOUT", "600")

    serve.build_app()

    assert 잡힌["timeout_seconds"] == 600.0


def test_설정하지_않으면_제한_시간은_그대로다(monkeypatch: pytest.MonkeyPatch) -> None:
    잡힌 = {}

    class 가짜_클라이언트:
        def __init__(self, **kwargs: object) -> None:
            잡힌.update(kwargs)

    monkeypatch.setattr(serve, "OllamaLlmClient", 가짜_클라이언트)
    monkeypatch.delenv("HFA_OLLAMA_TIMEOUT", raising=False)

    serve.build_app()

    assert 잡힌["timeout_seconds"] == 120.0

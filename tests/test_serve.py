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


def _빌드된_화면(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<div id=root></div>", encoding="utf-8")
    (tmp_path / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    return tmp_path


def _앱(tmp_path):
    from fastapi.testclient import TestClient

    from housing_finance_agent.api import create_app
    from housing_finance_agent.session import SessionStore

    app = create_app(object(), sessions=SessionStore())
    serve.attach_web(app, _빌드된_화면(tmp_path))
    return TestClient(app)


def test_화면_주소는_index_html을_돌려준다(tmp_path) -> None:
    """화면은 주소마다 다른 화면을 그리지만 파일은 하나다. 새로 고쳐도 화면이 떠야 한다."""
    client = _앱(tmp_path)

    assert "id=root" in client.get("/").text
    assert "id=root" in client.get("/s/abc/questions").text
    assert client.get("/assets/app.js").text == "console.log(1)"


def test_API가_화면보다_먼저_걸린다(tmp_path) -> None:
    client = _앱(tmp_path)

    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/v1/fields").json()["fields"]
    # 없는 API는 화면이 아니라 404. HTML을 받으면 화면이 원인을 알 수 없다.
    assert client.get("/v1/없는경로").status_code == 404


def test_빌드하지_않았으면_API만_뜬다(tmp_path) -> None:
    from fastapi.testclient import TestClient

    from housing_finance_agent.api import create_app
    from housing_finance_agent.session import SessionStore

    app = create_app(object(), sessions=SessionStore())
    serve.attach_web(app, tmp_path)

    assert TestClient(app).get("/").status_code == 404


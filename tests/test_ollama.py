"""Ollama 어댑터 테스트.

실물 Ollama 없이 가짜 HTTP 서버로 계약만 확인한다. 실물을 부르면 느리고 CI에서
돌지 않는다. 실물 확인은 별도 스크립트로 한다.

**여기서 나가는 예외는 LlmError뿐이어야 한다.** 다른 예외가 새면 화면이 아니라
서버가 스택트레이스를 뱉는다.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from housing_finance_agent.ollama import LlmError, OllamaLlmClient


class _Handler(BaseHTTPRequestHandler):
    behavior = "ok"

    def log_message(self, *args: object) -> None:  # 테스트 출력이 지저분해진다
        pass

    def do_POST(self) -> None:  # noqa: N802 — http.server가 정한 이름이다
        length = int(self.headers.get("Content-Length", 0))
        self.server.requests.append(json.loads(self.rfile.read(length)))  # type: ignore[attr-defined]

        if _Handler.behavior == "ok":
            self._reply(200, json.dumps({"response": "안녕"}, ensure_ascii=False))
        elif _Handler.behavior == "server_error":
            self._reply(500, json.dumps({"error": "모델 없음"}))
        elif _Handler.behavior == "bad_shape":
            self._reply(200, json.dumps({"unexpected": 1}))
        elif _Handler.behavior == "not_json":
            self._reply(200, "<html>다른 서버입니다</html>")

    def _reply(self, code: int, body: str) -> None:
        encoded = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


@pytest.fixture
def fake_ollama():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    server.requests = []  # type: ignore[attr-defined]
    _Handler.behavior = "ok"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server
    server.shutdown()


def _client(server, **kwargs) -> OllamaLlmClient:
    endpoint = f"http://127.0.0.1:{server.server_address[1]}"
    return OllamaLlmClient(endpoint=endpoint, timeout_seconds=5, **kwargs)


def test_답을_돌려준다(fake_ollama) -> None:
    assert _client(fake_ollama).generate("안녕?") == "안녕"


def test_같은_입력에_같은_답이_나오게_보낸다(fake_ollama) -> None:
    """온도가 0이 아니면 같은 문장에서 매번 다른 값이 뽑혀 판정이 흔들린다."""
    _client(fake_ollama).generate("안녕?")

    sent = fake_ollama.requests[0]
    assert sent["options"]["temperature"] == 0
    assert sent["stream"] is False


def test_서버_오류는_LlmError로_바꾼다(fake_ollama) -> None:
    _Handler.behavior = "server_error"

    with pytest.raises(LlmError, match="LLM 서버 오류"):
        _client(fake_ollama).generate("안녕?")


def test_응답_모양이_다르면_LlmError다(fake_ollama) -> None:
    _Handler.behavior = "bad_shape"

    with pytest.raises(LlmError, match="형식"):
        _client(fake_ollama).generate("안녕?")


def test_JSON이_아닌_응답도_LlmError다(fake_ollama) -> None:
    """주소를 잘못 넣어 다른 서버에 닿는 경우다."""
    _Handler.behavior = "not_json"

    with pytest.raises(LlmError):
        _client(fake_ollama).generate("안녕?")


def test_서버가_없으면_LlmError다() -> None:
    client = OllamaLlmClient(endpoint="http://127.0.0.1:9", timeout_seconds=2)

    with pytest.raises(LlmError, match="연결할 수 없습니다"):
        client.generate("안녕?")


def test_주소가_잘못돼도_LlmError다() -> None:
    with pytest.raises(LlmError):
        OllamaLlmClient(endpoint="not-a-url", timeout_seconds=2).generate("안녕?")

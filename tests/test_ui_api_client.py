"""API 호출의 오류 매핑.

**여기서 나가는 예외가 ApiError뿐이라는 것이 화면 전체의 전제다.** 다른 예외가 새면
Streamlit이 스택트레이스를 그리고, 거기에는 서버 코드 경로가 같이 찍힌다. 실제 서버를
띄우지 않고 urlopen을 바꿔치기해서 실패 상황을 만든다.
"""

from __future__ import annotations

import io
import json
import urllib.error
import urllib.request

import pytest

from housing_finance_agent.ui import api_client


class _응답:
    def __init__(self, payload: object) -> None:
        self.payload = payload

    def __enter__(self) -> _응답:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload, ensure_ascii=False).encode("utf-8")


def _보낸_것(monkeypatch: pytest.MonkeyPatch, payload: object) -> list[urllib.request.Request]:
    보낸 = []

    def fake(request: urllib.request.Request, timeout: int = 0) -> _응답:
        보낸.append(request)
        return _응답(payload)

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    return 보낸


def _터뜨린다(monkeypatch: pytest.MonkeyPatch, error: Exception) -> None:
    def fake(request: urllib.request.Request, timeout: int = 0) -> None:
        raise error

    monkeypatch.setattr(urllib.request, "urlopen", fake)


def _http_error(code: int, detail: str) -> urllib.error.HTTPError:
    body = io.BytesIO(json.dumps({"detail": detail}, ensure_ascii=False).encode("utf-8"))
    return urllib.error.HTTPError("http://127.0.0.1:8000/x", code, "err", {}, body)


def test_주소는_환경변수로_바꾼다(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HFA_API_URL", raising=False)
    assert api_client.base_url() == "http://127.0.0.1:8000"

    monkeypatch.setenv("HFA_API_URL", "http://127.0.0.1:9000/")
    assert api_client.base_url() == "http://127.0.0.1:9000"


def test_추출은_문장을_보낸다(monkeypatch: pytest.MonkeyPatch) -> None:
    보낸 = _보낸_것(monkeypatch, {"values": {"age": 29}})

    assert api_client.extract("만 29세입니다")["values"] == {"age": 29}
    assert json.loads(보낸[0].data)["message"] == "만 29세입니다"


def test_상품을_지정하지_않으면_보내지_않는다(monkeypatch: pytest.MonkeyPatch) -> None:
    # 빈 목록을 보내면 API가 "아무 상품도 안 본다"로 읽는다. 생략과 빈 목록이 다르다.
    보낸 = _보낸_것(monkeypatch, {"results": []})

    api_client.check({"age": 29})
    assert "program_ids" not in json.loads(보낸[0].data)

    api_client.check({"age": 29}, ["nhuf-youth-jeonse"])
    assert json.loads(보낸[1].data)["program_ids"] == ["nhuf-youth-jeonse"]


def test_연결이_안_되면_주소를_알려_준다(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HFA_API_URL", "http://127.0.0.1:8000")
    _터뜨린다(monkeypatch, urllib.error.URLError("연결 거부"))

    with pytest.raises(api_client.ApiError) as 잡힌:
        api_client.health()

    assert 잡힌.value.status is None
    assert "http://127.0.0.1:8000" in str(잡힌.value)


def test_타임아웃도_ApiError로_나온다(monkeypatch: pytest.MonkeyPatch) -> None:
    _터뜨린다(monkeypatch, TimeoutError("시간 초과"))

    with pytest.raises(api_client.ApiError):
        api_client.extract("만 29세입니다")


def test_깨진_JSON도_ApiError로_나온다(monkeypatch: pytest.MonkeyPatch) -> None:
    class _깨진:
        def __enter__(self) -> _깨진:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def read(self) -> bytes:
            return "<html>서버 오류</html>".encode()

    monkeypatch.setattr(urllib.request, "urlopen", lambda request, timeout=0: _깨진())

    with pytest.raises(api_client.ApiError):
        api_client.fields()


def test_503은_코드를_들고_온다(monkeypatch: pytest.MonkeyPatch) -> None:
    # 화면이 "서버가 죽었다"와 "조건이 안 맞는다"를 다른 문구로 보여 줘야 한다.
    _터뜨린다(monkeypatch, _http_error(503, "조건을 읽지 못했습니다: 모델 응답 없음"))

    with pytest.raises(api_client.ApiError) as 잡힌:
        api_client.extract("만 29세입니다")

    assert 잡힌.value.status == 503
    assert "조건을 읽지 못했습니다" in str(잡힌.value)


def test_서버_문구의_로컬_경로를_지운다(monkeypatch: pytest.MonkeyPatch) -> None:
    # 이 화면은 데모로 녹화된다. 오류 문구에 서버 코드 위치가 찍히면 안 된다.
    _터뜨린다(monkeypatch, _http_error(500, r"실패: C:\Users\me\models\llm.gguf 없음"))

    with pytest.raises(api_client.ApiError) as 잡힌:
        api_client.fields()

    assert "C:" not in str(잡힌.value)
    assert "실패" in str(잡힌.value)


def test_경로_지우기가_금액을_건드리지_않는다() -> None:
    assert api_client.strip_paths("연 4,000만원 / 보증금 1억 8,000만원") == (
        "연 4,000만원 / 보증금 1억 8,000만원"
    )

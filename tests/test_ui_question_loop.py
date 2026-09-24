"""화면에서 질문 루프를 끝까지 돌린다 — 문장 → 확인 → 하나씩 확인 → 결과.

서버를 띄우지 않는다. 화면의 HTTP 호출(`urllib.request.urlopen`)을 같은 프로세스의
FastAPI 앱으로 돌려보낸다. 그래서 **화면 → API → 세션 → 질문 루프**가 실제 코드로
이어진다. LLM만 가짜다.

화면 모양(색·배치)은 보지 않는다. **흐름**을 본다 — 확인을 건너뛸 수 없는가, 서버가 정한
질문이 그대로 나오는가, 모르겠다가 서버에 남는가, 멈춘 이유가 결과에 보이는가.
"""

from __future__ import annotations

import io
import json
import urllib.error
import urllib.request
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from streamlit.testing.v1 import AppTest

from housing_finance_agent.api import create_app
from housing_finance_agent.session import SessionStore

_앱 = Path(__file__).resolve().parents[1] / "src/housing_finance_agent/ui/app.py"

# "서울 전세 3억, 29살, 연봉 4천" — 청년전용에서만 8개를 한꺼번에 묻던 문장이다.
_읽은_값 = {
    "intended_tenure": "JEONSE",
    "age": 29,
    "region_name": "서울",
    "lease_deposit_krw": "3억원",
    "combined_annual_income_krw": "4천만원",
    "_sources": {"age": "29살", "region_name": "서울"},
}


class _가짜_LLM:
    def generate(self, prompt: str) -> str:
        return json.dumps(_읽은_값, ensure_ascii=False)


class _응답:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def __enter__(self) -> _응답:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


@pytest.fixture
def 서버(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> TestClient:
    client = TestClient(create_app(_가짜_LLM(), sessions=SessionStore(tmp_path / "s.db")))

    def urlopen(request: urllib.request.Request, timeout: int = 0) -> _응답:
        경로 = request.full_url.split("127.0.0.1:8000", 1)[1]
        본문 = json.loads(request.data) if request.data else None
        응답 = client.request(request.get_method(), 경로, json=본문)
        if 응답.status_code >= 400:
            raise urllib.error.HTTPError(
                request.full_url, 응답.status_code, "err", {}, io.BytesIO(응답.content)
            )
        return _응답(응답.content)

    monkeypatch.delenv("HFA_API_URL", raising=False)
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return client


def _버튼(at: AppTest, 이름: str):
    return next(b for b in at.button if b.label == 이름)


def _문장을_읽고_확인한다(at: AppTest) -> None:
    at.text_area(key="input_message").input("서울 전세 3억, 29살, 연봉 4천").run()
    _버튼(at, "조건 읽기").click().run()
    assert at.subheader[0].value == "2. 이렇게 읽었습니다", "확인 단계를 건너뛰었다"
    _버튼(at, "확인했습니다 — 다음").click().run()


def _기록(서버: TestClient, at: AppTest) -> list[str]:
    session_id = at.session_state["session_id"]
    return [e["kind"] for e in 서버.get(f"/v1/sessions/{session_id}/trace").json()["events"]]


def test_확인을_마치면_서버가_정한_질문을_하나씩_묻는다(서버: TestClient) -> None:
    at = AppTest.from_file(str(_앱), default_timeout=30).run()
    _문장을_읽고_확인한다(at)

    assert at.subheader[0].value == "3. 하나씩 확인"
    session_id = at.session_state["session_id"]
    서버가_정한_것 = 서버.get(f"/v1/sessions/{session_id}/next").json()["question"]["label"]
    assert any(m.value == f"#### {서버가_정한_것}" for m in at.markdown), (
        "화면이 서버가 정한 질문과 다른 것을 묻는다"
    )


def test_답하면_서버에_남고_다음_질문으로_넘어간다(서버: TestClient) -> None:
    at = AppTest.from_file(str(_앱), default_timeout=30).run()
    _문장을_읽고_확인한다(at)
    session_id = at.session_state["session_id"]
    첫_질문 = 서버.get(f"/v1/sessions/{session_id}/next").json()["question"]

    at.radio[0].set_value(at.radio[0].options[0]).run()
    _버튼(at, "답하기").click().run()

    assert 첫_질문["field"] in 서버.get(f"/v1/sessions/{session_id}").json()["values"]
    다음 = 서버.get(f"/v1/sessions/{session_id}/next").json()
    assert 다음.get("question", {}).get("field") != 첫_질문["field"], "같은 것을 또 묻는다"


def test_모르겠어요는_서버에_기록되고_다시_묻지_않는다(서버: TestClient) -> None:
    at = AppTest.from_file(str(_앱), default_timeout=30).run()
    _문장을_읽고_확인한다(at)
    session_id = at.session_state["session_id"]
    첫_질문 = 서버.get(f"/v1/sessions/{session_id}/next").json()["question"]["field"]

    _버튼(at, "모르겠어요").click().run()

    assert "FIELD_DECLINED" in _기록(서버, at)
    다음 = 서버.get(f"/v1/sessions/{session_id}/next").json()
    assert 다음.get("question", {}).get("field") != 첫_질문


def test_그만_묻고_결과를_보면_멈춘_이유와_확인_과정이_보인다(서버: TestClient) -> None:
    at = AppTest.from_file(str(_앱), default_timeout=30).run()
    _문장을_읽고_확인한다(at)

    _버튼(at, "그만 묻고 지금까지로 결과 보기").click().run()

    assert at.session_state["stop"]["reason"] == "USER_STOPPED"
    assert any("중간에 멈췄습니다" in w.value for w in at.warning)
    assert any(e.label == "어떤 순서로 무엇을 확인했나" for e in at.expander)
    assert "ASSESSED" in _기록(서버, at)
    # 전세라고 읽었으므로 매매 상품은 결과에 없어야 한다.
    결과 = [r["program_id"] for r in at.session_state["results"]]
    assert "nhuf-didimdol" not in 결과 and 결과


def test_모른다고만_하면_끝까지_가서_모른_것을_밝힌다(서버: TestClient) -> None:
    """모든 질문에 모르겠어요를 눌러도 막히지 않고 결과까지 간다. 멈춘 이유가 "다 확인함"이
    아니라 "모르셔서 확정 못 함"이어야 한다.
    """
    at = AppTest.from_file(str(_앱), default_timeout=30).run()
    _문장을_읽고_확인한다(at)

    for _ in range(30):
        if at.subheader[0].value != "3. 하나씩 확인":
            break
        _버튼(at, "모르겠어요").click().run()
    else:
        pytest.fail("모르겠어요만 눌렀는데 결과로 넘어가지 않는다")

    assert at.session_state["stop"]["reason"] == "ONLY_DECLINED_LEFT"
    assert any("모르셔서 확정하지 못한" in w.value for w in at.warning)

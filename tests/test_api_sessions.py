"""세션 경로 — 기억하는 층을 HTTP로 쓴다.

기존 두 경로(`/v1/profiles/extract`, `/v1/eligibility/check`)는 무상태로 남겨 뒀다.
순수한 함수 경계라 테스트하기 쉽고, 세션 없이 판정만 부르고 싶은 경우가 있다.
여기는 그 위에 얹은 층이고 **같은 `assess()`를 부른다.**

**문장을 저장하지 않는 것**이 이 파일에서 지키는 것 중 하나다. 화면이 "입력한 내용은
판정에만 쓰고 저장하지 않습니다"라고 약속하고 있어서, 저장하면 그 약속이 깨진다.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from housing_finance_agent.api import create_app
from housing_finance_agent.session import SessionStore


class FakeLlm:
    def __init__(self, reply: str) -> None:
        self.reply = reply

    def generate(self, prompt: str) -> str:
        return self.reply


@pytest.fixture
def client(tmp_path):
    답 = json.dumps(
        {
            "age": 29,
            "combined_annual_income_krw": "4천만원",
            "_sources": {"age": "만 29세", "combined_annual_income_krw": "연봉 4천만원"},
        },
        ensure_ascii=False,
    )
    store = SessionStore(tmp_path / "sessions.db")
    return TestClient(create_app(FakeLlm(답), max_message_chars=500, sessions=store))


def _세션(client) -> str:
    return client.post("/v1/sessions").json()["session_id"]


def test_세션을_연다(client) -> None:
    응답 = client.post("/v1/sessions")

    assert 응답.status_code == 200
    assert 응답.json()["session_id"]


def test_없는_세션은_404다(client) -> None:
    """500으로 나가면 화면이 "서버가 죽었다"와 구분하지 못한다."""
    assert client.get("/v1/sessions/없는거").status_code == 404
    assert client.post("/v1/sessions/없는거/messages", json={"message": "안녕"}).status_code == 404


def test_문장을_넣으면_값과_출처가_돌아온다(client) -> None:
    session_id = _세션(client)

    응답 = client.post(f"/v1/sessions/{session_id}/messages", json={"message": "만 29세입니다"})

    값 = 응답.json()["values"]
    assert 값["age"]["value"] == 29
    assert 값["age"]["source"] == "LLM"
    assert 값["age"]["phrase"] == "만 29세"


def test_문장은_저장되지_않는다(client) -> None:
    """**화면이 사용자에게 한 약속이다.** 기록 어디에도 원문이 없어야 한다."""
    session_id = _세션(client)
    문장 = "만 29세이고 연봉 4천만원입니다"
    client.post(f"/v1/sessions/{session_id}/messages", json={"message": 문장})

    기록 = client.get(f"/v1/sessions/{session_id}/trace").json()["events"]

    전체 = json.dumps(기록, ensure_ascii=False)
    assert 문장 not in 전체, "문장이 그대로 저장됐다"
    assert "이고 연봉" not in 전체, "문장 조각이 저장됐다"


def test_직접_고친_값이_읽은_값을_덮는다(client) -> None:
    session_id = _세션(client)
    client.post(f"/v1/sessions/{session_id}/messages", json={"message": "만 29세입니다"})

    응답 = client.put(f"/v1/sessions/{session_id}/fields", json={"values": {"age": 31}})

    값 = 응답.json()["values"]["age"]
    assert 값["value"] == 31
    assert 값["source"] == "USER"


def test_없는_항목은_422다(client) -> None:
    """화면에 없는 항목이 들어오면 조용히 받지 않는다. 판정에 안 쓰이고 쌓이기만 한다."""
    session_id = _세션(client)

    응답 = client.put(f"/v1/sessions/{session_id}/fields", json={"values": {"나이": 31}})

    assert 응답.status_code == 422


def test_새로고침해도_남는다(client, tmp_path) -> None:
    """**이 계층의 존재 이유다.** 지금까지는 브라우저를 새로 고치면 다 사라졌다."""
    session_id = _세션(client)
    client.put(f"/v1/sessions/{session_id}/fields", json={"values": {"age": 31}})

    다시 = TestClient(
        create_app(FakeLlm("{}"), sessions=SessionStore(tmp_path / "sessions.db"))
    ).get(f"/v1/sessions/{session_id}")

    assert 다시.json()["values"]["age"]["value"] == 31


def test_세션으로_판정하면_무상태_경로와_같은_결과다(client) -> None:
    """두 경로가 같은 `assess()`를 쓴다. 어느 쪽으로 왔는지에 따라 다르면 안 된다."""
    프로필 = {
        "age": 30,
        "household_head_status": "HEAD",
        "home_ownership_status": "NO_HOME_ALL_MEMBERS",
        "combined_annual_income_krw": 40000000,
        "net_asset_krw": 100000000,
        "housing_area_m2": 59,
        "lease_deposit_krw": 200000000,
        "region_name": "서울",
    }
    session_id = _세션(client)
    client.put(f"/v1/sessions/{session_id}/fields", json={"values": 프로필})

    세션_결과 = client.post(f"/v1/sessions/{session_id}/assessment").json()["results"]
    무상태_결과 = client.post("/v1/eligibility/check", json={"profile": 프로필}).json()["results"]

    assert [r["status"] for r in 세션_결과] == [r["status"] for r in 무상태_결과]
    assert [r["program_id"] for r in 세션_결과] == [r["program_id"] for r in 무상태_결과]


def test_판정하면_기록이_남는다(client) -> None:
    session_id = _세션(client)
    client.put(f"/v1/sessions/{session_id}/fields", json={"values": {"age": 30}})
    client.post(f"/v1/sessions/{session_id}/assessment")

    종류 = [e["kind"] for e in client.get(f"/v1/sessions/{session_id}/trace").json()["events"]]

    assert 종류 == ["SESSION_STARTED", "FIELD_SET", "ASSESSED"]


def test_범위_값이_오가도_모양이_유지된다(client) -> None:
    """`4천 후반대`는 범위로 저장되고 범위로 돌아와야 한다.

    JSON으로 오갈 때 한 숫자로 접히면 5천만원 기준을 통과해 버리는데, 원문에는 그런
    근거가 없다.
    """
    session_id = _세션(client)
    범위 = {"low": 45000000, "high": 50000000}

    client.put(
        f"/v1/sessions/{session_id}/fields",
        json={"values": {"combined_annual_income_krw": 범위}},
    )
    돌아온 = client.get(f"/v1/sessions/{session_id}").json()

    assert 돌아온["values"]["combined_annual_income_krw"]["value"] == 범위


def test_다음_질문을_하나_준다(client) -> None:
    session_id = _세션(client)

    응답 = client.get(f"/v1/sessions/{session_id}/next")

    assert 응답.status_code == 200
    본문 = 응답.json()
    assert 본문["action"] == "ASK"
    assert 본문["question"]["field"] == "intended_tenure"
    # 화면이 코드를 그대로 보여 주지 않도록 표기를 함께 준다.
    assert 본문["question"]["label"]
    assert 본문["question"]["choice_labels"]["JEONSE"]


def test_다음_질문을_물어도_기록이_쌓이지_않는다(client) -> None:
    """GET이 기록을 쓰면 새로고침만 해도 "물었다"가 쌓인다. 질문은 기록에서 다시 계산한다."""
    session_id = _세션(client)
    client.get(f"/v1/sessions/{session_id}/next")
    client.get(f"/v1/sessions/{session_id}/next")

    종류 = [e["kind"] for e in client.get(f"/v1/sessions/{session_id}/trace").json()["events"]]

    assert 종류 == ["SESSION_STARTED"]


def test_모른다고_하면_다음_질문이_바뀐다(client) -> None:
    session_id = _세션(client)

    응답 = client.post(f"/v1/sessions/{session_id}/declined", json={"field": "intended_tenure"})
    다음 = client.get(f"/v1/sessions/{session_id}/next").json()

    assert 응답.json()["declined"] == ["intended_tenure"]
    assert 다음["question"]["field"] != "intended_tenure"


def test_없는_항목을_모른다고_하면_422다(client) -> None:
    session_id = _세션(client)

    응답 = client.post(f"/v1/sessions/{session_id}/declined", json={"field": "나이"})

    assert 응답.status_code == 422


def test_물을_것이_없으면_이유와_함께_결과를_내라고_한다(client) -> None:
    session_id = _세션(client)
    client.put(
        f"/v1/sessions/{session_id}/fields",
        json={"values": {"intended_tenure": "PURCHASE", "home_ownership_status": "HAS_HOME"}},
    )

    본문 = client.get(f"/v1/sessions/{session_id}/next").json()

    assert 본문["action"] == "RESULT"
    assert 본문["reason"] == "ALL_NOT_MATCHED"
    assert 본문["candidates"] == ["nhuf-didimdol"]


@pytest.mark.parametrize(
    "values",
    [
        {"intended_tenure": "jeonse"},
        {"age": "스물아홉"},
        {"age": True},
        {"region_name": "  "},
        {"combined_annual_income_krw": {"low": 5, "high": 1}},
        {"move_in_date": "10월 1일"},
    ],
)
def test_항목_정의에_안_맞는_값은_422다(client, values: dict) -> None:
    """이름만 보고 값을 안 보면 판정과 질문 루프가 반대로 말한다.

    `"jeonse"`가 들어오면 판정은 전세 상품을 보는데 루프는 후보가 없어 "모두 조건
    불충족"이라고 했다(2026-09-24 검토).
    """
    session_id = _세션(client)

    응답 = client.put(f"/v1/sessions/{session_id}/fields", json={"values": values})

    assert 응답.status_code == 422
    assert client.get(f"/v1/sessions/{session_id}").json()["values"] == {}


def test_값을_지우는_것만으로는_모른다는_기록이_풀리지_않는다(client) -> None:
    """화면이 빈 칸을 한꺼번에 None으로 보내도 모른다고 한 항목은 남아야 한다."""
    session_id = _세션(client)
    client.post(f"/v1/sessions/{session_id}/declined", json={"field": "net_asset_krw"})

    client.put(f"/v1/sessions/{session_id}/fields", json={"values": {"net_asset_krw": None}})
    다시 = client.post(f"/v1/sessions/{session_id}/declined", json={"field": "age"})

    assert 다시.json()["declined"] == ["age", "net_asset_krw"]


def test_없는_세션에_다음_질문과_모름을_보내면_404다(client) -> None:
    assert client.get("/v1/sessions/없는거/next").status_code == 404
    assert client.post("/v1/sessions/없는거/declined", json={"field": "age"}).status_code == 404


def test_세션으로_판정하면_질문_정책_버전이_기록에_남는다(client) -> None:
    session_id = _세션(client)
    client.post(f"/v1/sessions/{session_id}/assessment")

    기록 = client.get(f"/v1/sessions/{session_id}/trace").json()["events"]

    assert 기록[-1]["kind"] == "ASSESSED"
    assert (
        기록[-1]["payload"]["question_policy_version"]
        == client.get(f"/v1/sessions/{session_id}/next").json()["policy_version"]
    )

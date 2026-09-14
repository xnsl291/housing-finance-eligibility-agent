"""HTTP 경계.

화면은 파이프라인 코드를 직접 부르지 않고 이 API만 안다. 경계를 우회하면 길이
상한이나 오류 매핑 같은 것이 전부 무의미해진다.

**여기서 나가는 응답은 판정 결과이거나 명확한 오류여야 한다.** 파이썬 예외가
그대로 500으로 나가면 화면이 보여 줄 말이 없다.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from housing_finance_agent.api import create_app


class FakeLlm:
    def __init__(self, reply: str) -> None:
        self.reply = reply

    def generate(self, prompt: str) -> str:
        return self.reply


class BrokenLlm:
    def generate(self, prompt: str) -> str:
        raise RuntimeError("모델이 죽었음")


def _client(llm: object | None = None) -> TestClient:
    reply = json.dumps({"age": 29, "combined_annual_income_krw": "4천만원"}, ensure_ascii=False)
    return TestClient(create_app(llm or FakeLlm(reply), max_message_chars=500))


_통과 = {
    "age": 30,
    "household_head_status": "HEAD",
    "home_ownership_status": "NO_HOME_ALL_MEMBERS",
    "combined_annual_income_krw": 40000000,
    "minor_children_count": 0,
    "marital_status": "SINGLE",
    "net_asset_krw": 100000000,
    "household_type": "SINGLE",
    "housing_area_m2": 59,
    "lease_deposit_krw": 200000000,
    "deposit_paid_ratio": 0.10,
    "is_innovation_city_relocated_worker": False,
    "is_redevelopment_area_tenant": False,
    "employment_category": "OTHER",
    "military_service_years": 0,
    "contract_balance_date": "2026-03-10",
    "move_in_date": "2026-04-20",
    "application_date": "2026-05-01",
}


def test_상태를_알려_준다() -> None:
    response = _client().get("/health")

    assert response.status_code == 200
    assert response.json()["programs"]


def test_문장에서_조건을_뽑아_준다() -> None:
    response = _client().post("/v1/profiles/extract", json={"message": "만 29세 연봉 4천만원"})

    assert response.status_code == 200
    body = response.json()
    assert body["values"]["age"] == 29
    assert body["values"]["combined_annual_income_krw"] == 40000000


def test_빈_문장은_거절한다() -> None:
    assert _client().post("/v1/profiles/extract", json={"message": ""}).status_code == 422


def test_너무_긴_문장은_거절한다() -> None:
    response = _client().post("/v1/profiles/extract", json={"message": "가" * 501})

    assert response.status_code == 422


def test_LLM이_죽으면_503이다() -> None:
    """화면이 "서버가 죽었다"와 "조건이 안 맞는다"를 구분할 수 있어야 한다."""
    response = _client(BrokenLlm()).post("/v1/profiles/extract", json={"message": "만 29세"})

    assert response.status_code == 503


def test_판정을_돌려준다() -> None:
    response = _client().post(
        "/v1/eligibility/check",
        json={"profile": _통과, "program_ids": ["nhuf-youth-jeonse"]},
    )

    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["status"] == "PRECHECK_MATCH"
    assert result["loan_limit"]["amount_krw"] == 150000000


def test_program_ids를_생략하면_모든_상품을_본다() -> None:
    response = _client().post("/v1/eligibility/check", json={"profile": _통과})

    assert response.status_code == 200
    assert len(response.json()["results"]) >= 2


def test_없는_상품을_고르면_404다() -> None:
    response = _client().post(
        "/v1/eligibility/check", json={"profile": _통과, "program_ids": ["없는-상품"]}
    )

    assert response.status_code == 404


def test_판정에_다음_행동이_함께_온다() -> None:
    떨어짐 = {**_통과, "age": 35}

    response = _client().post(
        "/v1/eligibility/check", json={"profile": 떨어짐, "program_ids": ["nhuf-youth-jeonse"]}
    )

    result = response.json()["results"][0]
    assert result["status"] == "NOT_MATCHED"
    assert result["next_actions"] == ["만 34세를 넘으면 신청 대상이 아님"]


def test_범위로_준_값도_판정한다() -> None:
    """화면이 4천 후반대 같은 표현을 그대로 넘길 수 있어야 한다."""
    범위 = {**_통과, "combined_annual_income_krw": {"low": 45000000, "high": 50000000}}

    response = _client().post(
        "/v1/eligibility/check", json={"profile": 범위, "program_ids": ["nhuf-youth-jeonse"]}
    )

    assert response.json()["results"][0]["status"] == "PRECHECK_MATCH"


@pytest.mark.parametrize("path", ["/v1/profiles/extract", "/v1/eligibility/check"])
def test_모양이_다른_요청은_422다(path: str) -> None:
    assert _client().post(path, json={"엉뚱한": "값"}).status_code == 422

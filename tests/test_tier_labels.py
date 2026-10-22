"""한도 구간 이름표와 항목 이름표를 서버가 응답에 실어 준다.

화면은 판정 코드(구간 이름, 항목 이름)를 모른다. 이름표 정본은 규칙 YAML이다.
"""

from __future__ import annotations

import pytest
import yaml
from fastapi.testclient import TestClient

from housing_finance_agent.api import create_app
from housing_finance_agent.rules import _RULES_DIR, available_programs, load_program

# 다른 테스트 파일에서 가져오지 않고 여기 둔다. CI는 `pytest`로 돌려 `tests`가 패키지로
# 잡히지 않아 `from tests.… import`가 실패한다(로컬 `python -m pytest`에서는 통과했음).
_일반 = {
    "age": 40,
    "household_head_status": "HEAD",
    "home_ownership_status": "NO_HOME_ALL_MEMBERS",
    "combined_annual_income_krw": 40000000,
    "net_asset_krw": 100000000,
    "housing_area_m2": 59,
    "lease_deposit_krw": 150000000,
    "region": "CAPITAL_AREA",
}

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


def _client() -> TestClient:
    # 판정 경로는 LLM을 부르지 않는다.
    return TestClient(create_app(object()))


def test_모든_규칙_파일의_모든_구간에_이름표가_있다() -> None:
    for program_id in available_programs():
        tiers = load_program(program_id)["limits"]["loan_amount"]["tiers"]
        assert tiers
        for tier in tiers:
            assert tier.get("label"), f"{program_id}:{tier['name']}"


def test_이름표가_없는_구간이_있으면_읽을_때_실패한다(tmp_path, monkeypatch) -> None:
    규칙 = yaml.safe_load((_RULES_DIR / "nhuf-youth-jeonse.yaml").read_text(encoding="utf-8"))
    del 규칙["limits"]["loan_amount"]["tiers"][0]["label"]
    (tmp_path / "bad.yaml").write_text(yaml.safe_dump(규칙, allow_unicode=True), encoding="utf-8")
    monkeypatch.setattr("housing_finance_agent.rules._RULES_DIR", tmp_path)
    monkeypatch.setattr("housing_finance_agent.rules._load_field_guides", lambda: {})

    with pytest.raises(ValueError, match="label"):
        load_program("bad")


def test_판정_응답에_구간_이름표가_실린다() -> None:
    응답 = (
        _client()
        .post(
            "/v1/eligibility/check",
            json={"profile": _일반, "program_ids": ["nhuf-general-jeonse"]},
        )
        .json()["results"][0]
    )

    한도 = 응답["loan_limit"]
    assert 한도["tier"] == "general"
    assert 한도["tier_label"] == "일반 가구"
    assert 한도["skipped_tiers"] == ["newlywed_or_two_children"]
    assert 한도["skipped_tier_labels"] == ["신혼 가구 또는 2자녀 이상 가구"]
    assert 응답["next_actions"] == [
        "신혼 가구 또는 2자녀 이상 가구에 해당하면 한도가 더 늘어날 수 있습니다"
    ]


def test_규칙_결과마다_항목_이름표가_실린다() -> None:
    client: TestClient = _client()
    응답 = client.post(
        "/v1/eligibility/check",
        json={"profile": {**_통과, "region": "CAPITAL_AREA"}, "program_ids": ["nhuf-youth-jeonse"]},
    ).json()["results"][0]

    항목 = [item for item in 응답["rule_outcomes"]]
    일반 = next(i for i in 항목 if i["field"] == "age")
    assert 일반["field_label"] == "나이"
    파생 = [i for i in 항목 if i["field"] in ("region", "age_after_service_credit")]
    assert 파생, "파생 항목을 쓰는 규칙이 하나는 있어야 한다"
    기대 = {"region": "수도권 여부", "age_after_service_credit": "병역 복무기간을 반영한 나이"}
    for item in 파생:
        assert item["field_label"] == 기대[item["field"]]
    for item in 항목:
        assert (item["field_label"] is None) == (item["field"] is None)

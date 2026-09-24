"""다음 질문 — 상태를 보고 하나를 더 물을지, 결과를 낼지 정한다.

골든 시나리오(`golden/next_action/questions.yaml`)가 "이 상태면 이걸 물어야 한다"를
지킨다. 이 파일은 시나리오로 적기 어려운 성질을 본다 — 같은 상태에 같은 답이
나오는가, 루프가 끝나는가, 파생 항목을 원래 항목으로 되돌리는가.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from housing_finance_agent.amount import Range
from housing_finance_agent.next_action import (
    ALL_NOT_MATCHED,
    ASK,
    COMPLETE,
    ONLY_DECLINED_LEFT,
    RESULT,
    next_action,
)
from housing_finance_agent.rules import available_programs, load_program

_GOLDEN = Path(__file__).resolve().parents[1] / "golden" / "next_action" / "questions.yaml"


@pytest.fixture(scope="module")
def programs() -> dict[str, dict]:
    return {pid: load_program(pid) for pid in available_programs()}


def _as_value(given: object) -> object:
    if isinstance(given, dict) and {"low", "high"} <= given.keys():
        return Range(int(given["low"]), int(given["high"]))
    return given


def _scenarios() -> list[dict]:
    data = yaml.safe_load(_GOLDEN.read_text(encoding="utf-8"))
    cases = []
    for scenario in data["scenarios"]:
        base = {} if scenario.get("replace_base") else data["base"]
        merged = {**base, **(scenario["profile"] or {})}
        # null은 모른다는 뜻이다. 키를 지워서 엔진이 보는 모양과 맞춘다.
        profile = {k: _as_value(v) for k, v in merged.items() if v is not None}
        cases.append({**scenario, "merged_profile": profile})
    return cases


@pytest.mark.parametrize("scenario", _scenarios(), ids=[s["name"] for s in _scenarios()])
def test_골든_질문(scenario: dict, programs: dict) -> None:
    결과 = next_action(programs, scenario["merged_profile"], scenario.get("declined") or [])
    기대 = scenario["expect"]
    이름 = scenario["name"]

    assert 결과.action == 기대["action"], f"{이름}: 행동이 다름 ({결과})"
    for key in ("field", "ask_kind", "reason", "needed_by", "declined_needed"):
        if key in 기대:
            assert getattr(결과, key) == 기대[key], f"{이름}: {key}가 다름"


def test_질문_시나리오마다_왜를_적어_두었다() -> None:
    for scenario in _scenarios():
        assert scenario.get("왜"), f"{scenario['name']}에 왜가 없음"


def test_같은_상태에는_같은_질문이_나온다(programs: dict) -> None:
    """**이 루프가 Agent이면서 재현되는 이유다(D-27).** 상품을 읽는 순서가 달라도 같아야
    한다 — dict 순서에 기대면 파일 목록 순서가 바뀔 때 질문이 바뀐다.
    """
    상태 = {"intended_tenure": "JEONSE", "age": 29, "region_name": "서울"}
    거꾸로 = dict(reversed(list(programs.items())))

    assert next_action(programs, 상태) == next_action(거꾸로, 상태)


_정답 = {
    "intended_tenure": "JEONSE",
    "age": 29,
    "household_head_status": "HEAD",
    "household_type": "SINGLE",
    "home_ownership_status": "NO_HOME_ALL_MEMBERS",
    "marital_status": "SINGLE",
    "minor_children_count": 0,
    "region_name": "서울",
    "employment_category": "OTHER",
    "military_service_years": 0,
    "housing_area_m2": 40.0,
    "deposit_paid_ratio": 0.1,
    "combined_annual_income_krw": 40000000,
    "net_asset_krw": 100000000,
    "lease_deposit_krw": 200000000,
    "contract_balance_date": "2026-10-01",
    "move_in_date": "2026-10-01",
    "application_date": "2026-10-10",
}


def _끝까지(programs: dict, 모름: set[str] = frozenset()) -> tuple[list[str], object]:
    """묻는 대로 답해 가며 루프를 끝까지 돌린다. 모르는 항목은 모른다고 한다."""
    프로필: dict = {}
    거절: set[str] = set()
    물은_것: list[str] = []
    for _ in range(len(_정답) + 1):
        결과 = next_action(programs, 프로필, 거절)
        if 결과.action == RESULT:
            return 물은_것, 결과
        물은_것.append(결과.field)
        if 결과.field in 모름:
            거절.add(결과.field)
        else:
            프로필[결과.field] = _정답[결과.field]
    pytest.fail(f"루프가 끝나지 않음: {물은_것}")


def test_묻는_대로_답하면_루프가_끝난다(programs: dict) -> None:
    물은_것, 결과 = _끝까지(programs)

    assert 결과.reason == COMPLETE
    assert len(물은_것) == len(set(물은_것)), f"같은 것을 두 번 물음: {물은_것}"
    assert 물은_것[0] == "intended_tenure"


def test_모른다고_한_항목은_다시_묻지_않고_끝난다(programs: dict) -> None:
    """답을 받아야만 진행되는 루프는 모르는 것을 찍게 만든다."""
    물은_것, 결과 = _끝까지(programs, 모름={"net_asset_krw"})

    assert 물은_것.count("net_asset_krw") == 1
    assert 결과.reason == ONLY_DECLINED_LEFT
    assert 결과.declined_needed == ["net_asset_krw"]


def test_탈락이_확인되면_그_자리에서_멈춘다(programs: dict) -> None:
    프로필 = {"intended_tenure": "JEONSE", "household_head_status": "HEAD"}

    assert next_action(programs, {**프로필, "home_ownership_status": "HAS_HOME"}).reason == (
        ALL_NOT_MATCHED
    )


def _가짜_상품(program_id: str, tenure: str, rules: list[dict]) -> dict:
    return {
        "program": {"program_id": program_id, "program_name": program_id, "tenure": tenure},
        "rules": [{"human_reviewed": True, "type": "HARD", **rule} for rule in rules],
    }


def _규칙(field_name: str, operator: str, value: object) -> dict:
    return {"rule_id": "R-1", "field": field_name, "operator": operator, "value": value}


def test_병역_반영_나이는_복무기간을_묻는다() -> None:
    """파생 항목은 사용자가 답할 수 없다. 만드는 데 쓰인 원래 항목 중 모르는 것을 묻는다."""
    상품 = {
        "p": _가짜_상품(
            "p",
            "JEONSE",
            [_규칙("age_after_service_credit", "lte", 34)],
        )
    }

    결과 = next_action(상품, {"intended_tenure": "JEONSE", "age": 36})

    assert 결과.action == ASK
    assert 결과.field == "military_service_years"


def test_전세와_매매가_섞이지_않으면_전세_매매를_묻지_않는다() -> None:
    """상품이 한쪽뿐이면 이 값은 아무것도 가르지 않는다."""
    상품 = {pid: _가짜_상품(pid, "JEONSE", [_규칙("age", "gte", 19)]) for pid in ("a", "b")}

    결과 = next_action(상품, {})

    assert 결과.field == "age"

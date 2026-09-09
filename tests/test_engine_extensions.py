"""엔진 확장 — 날짜 비교, any 조건, 병역 복무기간 반영.

세 가지가 필요해서 붙였다.

1. **날짜 비교** — 신청 시기 규칙이 "두 날짜 중 빠른 날로부터 3개월 이내"다.
   버팀목은 빠른 날, HUG는 늦은 날 기준이라 둘을 구분해 담아야 한다.
2. **any 조건** — 소득 6천만원 특례가 다섯 갈래고 그중 하나만 해당해도 적용된다.
3. **병역 복무기간** — 나이 상한이 사람마다 다르다. 34에 복무기간을 더하되 39가 상한이다.
"""

from __future__ import annotations

import pytest

from housing_finance_agent.eligibility import evaluate
from housing_finance_agent.profile import enrich


def _program(rules: list[dict]) -> dict:
    return {"program": {"program_id": "test-program"}, "rules": rules}


# --- 날짜 비교 ---


def _신청시기_규칙(months: int, mode: str) -> dict:
    return {
        "rule_id": "D-01",
        "field": "application_date",
        "operator": "within_months_after",
        "value": months,
        "reference": {"mode": mode, "fields": ["balance_date", "move_in_date"]},
        "type": "HARD",
        "human_reviewed": True,
        "failure_message": "신청 기한이 지남",
    }


def test_빠른_날로부터_세_달_안에_신청하면_통과한다() -> None:
    program = _program([_신청시기_규칙(3, "earliest")])
    profile = {
        "balance_date": "2026-03-10",  # 이쪽이 빠르다
        "move_in_date": "2026-04-20",
        "application_date": "2026-06-10",  # 3/10 + 3개월 = 6/10, 당일
    }

    assert evaluate(program, profile).status == "PRECHECK_MATCH"


def test_기한_다음날에_신청하면_탈락한다() -> None:
    """계획서가 요구한 경계다 — 전날·당일·다음날."""
    program = _program([_신청시기_규칙(3, "earliest")])
    profile = {
        "balance_date": "2026-03-10",
        "move_in_date": "2026-04-20",
        "application_date": "2026-06-11",  # 하루 넘김
    }

    decision = evaluate(program, profile)
    assert decision.status == "NOT_MATCHED"
    assert decision.failed_rules == ["D-01"]


def test_빠른_날_기준과_늦은_날_기준은_결과가_다르다() -> None:
    """버팀목은 빠른 날, HUG는 늦은 날을 쓴다. 같은 두 날짜에서 결과가 갈린다."""
    profile = {
        "balance_date": "2026-03-10",
        "move_in_date": "2026-04-20",
        "application_date": "2026-07-01",
    }

    빠른날 = evaluate(_program([_신청시기_규칙(3, "earliest")]), profile)
    늦은날 = evaluate(_program([_신청시기_규칙(3, "latest")]), profile)

    assert 빠른날.status == "NOT_MATCHED"  # 3/10 + 3개월 = 6/10 지남
    assert 늦은날.status == "PRECHECK_MATCH"  # 4/20 + 3개월 = 7/20 이내


def test_기준_날짜를_하나라도_모르면_판정하지_않는다() -> None:
    program = _program([_신청시기_규칙(3, "earliest")])
    profile = {"balance_date": "2026-03-10", "application_date": "2026-06-01"}

    decision = evaluate(program, profile)
    assert decision.status == "INSUFFICIENT_INFORMATION"
    assert "move_in_date" in decision.missing_fields


def test_말일_기준_더하기는_그_달의_마지막_날로_맞춘다() -> None:
    """1월 31일에 한 달을 더하면 2월 31일이 없다. 2월 28일로 본다."""
    program = _program([_신청시기_규칙(1, "earliest")])
    profile = {
        "balance_date": "2026-01-31",
        "move_in_date": "2026-01-31",
        "application_date": "2026-02-28",
    }

    assert evaluate(program, profile).status == "PRECHECK_MATCH"


# --- any 조건 ---


def test_any_조건은_하나만_맞아도_적용된다() -> None:
    """소득 특례가 다섯 갈래인데 그중 하나만 해당해도 6천만원 기준이 적용된다."""
    rules = [
        {
            "rule_id": "S-01",
            "field": "income",
            "operator": "lte",
            "value": 50,
            "type": "HARD",
            "human_reviewed": True,
            "failure_message": "일반 기준 초과",
        },
        {
            "rule_id": "S-02",
            "field": "income",
            "operator": "lte",
            "value": 60,
            "type": "HARD",
            "human_reviewed": True,
            "failure_message": "특례 기준 초과",
            "applies_when": {
                "any": [
                    {"field": "children", "operator": "gte", "value": 2},
                    {"field": "relocation_support", "operator": "eq", "value": True},
                ]
            },
            "overrides": ["S-01"],
        },
    ]

    profile = {"income": 55, "children": 0, "relocation_support": True}
    decision = evaluate(_program(rules), profile)

    assert decision.status == "PRECHECK_MATCH"
    assert decision.passed_rules == ["S-02"]


# --- 병역 복무기간 ---


@pytest.mark.parametrize(
    ("age", "service_years", "expected"),
    [
        (34, 0, 34),  # 복무 없음
        (36, 2, 34),  # 2년 복무하면 만 36세도 34세로 봄
        (40, 2, 38),  # 상한을 넘는지는 규칙이 판단한다
    ],
)
def test_병역_복무기간만큼_나이를_되돌린다(age: int, service_years: int, expected: int) -> None:
    """"만 34세 종료일로부터 병역 복무기간을 추가"를 나이 쪽에서 빼는 것으로 다룬다.

    규칙마다 기준값을 사람별로 바꾸는 것보다, 비교할 나이를 하나 더 두는 편이
    규칙을 데이터로 유지하는 데 맞는다.
    """
    enriched = enrich({"age": age, "military_service_years": service_years})

    assert enriched["age_after_service_credit"] == expected


def test_복무기간이_없으면_되돌린_나이도_만들지_않는다() -> None:
    """모르는 값을 0으로 채우면 복무한 사람을 안 한 것으로 처리한다."""
    enriched = enrich({"age": 36})

    assert "age_after_service_credit" not in enriched


def test_원래_프로필을_바꾸지_않는다() -> None:
    profile = {"age": 36, "military_service_years": 2}
    enrich(profile)

    assert "age_after_service_credit" not in profile

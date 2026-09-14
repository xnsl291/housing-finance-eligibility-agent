"""푸는 특례와 조이는 특례를 나눈다.

특례의 적용 여부를 모르면 일반 규칙까지 덮는 것이 원래 규칙이다(D-02). 특례가
기준을 조이는 경우에는 그래야 한다 — 안 덮으면 잘못 통과시킨다.

그런데 기준을 **푸는** 특례는 다르다. 모를 때 더 엄격한 일반 규칙을 적용하면
잘못 통과시킬 일이 없다. 방향을 구분하지 않으면 드문 특례 때문에 모두에게
묻게 된다. 실물 확인에서 물어보는 항목이 12개까지 늘었다(2026-09-14).
"""

from __future__ import annotations

from housing_finance_agent.eligibility import evaluate
from housing_finance_agent.rules import load_program


def _program(rules: list[dict]) -> dict:
    return {"program": {"program_id": "test"}, "rules": rules}


def _rule(rule_id: str, value: int, **extra: object) -> dict:
    rule = {
        "rule_id": rule_id,
        "field": "income",
        "operator": "lte",
        "value": value,
        "type": "HARD",
        "human_reviewed": True,
        "failure_message": f"{rule_id} 불충족",
    }
    rule.update(extra)
    return rule


_특례조건 = {"field": "special", "operator": "eq", "value": True}


def test_푸는_특례를_모르면_일반_규칙을_그대로_쓴다() -> None:
    """소득 기준이 5천인데 특례면 6천이다. 특례 해당 여부를 몰라도 5천으로 보면 된다."""
    program = _program(
        [
            _rule("G-01", 50),
            _rule("S-01", 60, applies_when=_특례조건, overrides=["G-01"], relaxes=True),
        ]
    )

    decision = evaluate(program, {"income": 45})  # special 없음

    assert decision.status == "PRECHECK_MATCH"
    assert decision.passed_rules == ["G-01"]
    assert decision.missing_fields == []


def test_푸는_특례를_모르고_일반_기준도_못_넘으면_묻는다() -> None:
    """5천을 넘었다. 특례면 통과할 수 있으므로 여기서는 특례 해당 여부를 물어야 한다."""
    program = _program(
        [
            _rule("G-01", 50),
            _rule("S-01", 60, applies_when=_특례조건, overrides=["G-01"], relaxes=True),
        ]
    )

    decision = evaluate(program, {"income": 55})

    assert decision.status == "INSUFFICIENT_INFORMATION"
    assert decision.missing_fields == ["special"]
    assert decision.failed_rules == []


def test_조이는_특례를_모르면_일반_규칙도_쓰지_않는다() -> None:
    """전용면적 85㎡가 일반이고 특례면 60㎡다. 모르는 채로 85를 적용하면 잘못 통과시킨다."""
    program = _program(
        [
            _rule("G-01", 85),
            _rule("S-01", 60, applies_when=_특례조건, overrides=["G-01"]),
        ]
    )

    decision = evaluate(program, {"income": 70})

    assert decision.status == "INSUFFICIENT_INFORMATION"
    assert decision.missing_fields == ["special"]


def test_실제_규칙에서_묻는_항목이_줄어든다() -> None:
    """소득 특례와 병역 특례는 둘 다 기준을 푼다. 해당 여부를 몰라도 판정이 된다."""
    profile = {
        "age": 29,
        "household_head_status": "HEAD",
        "home_ownership_status": "NO_HOME_ALL_MEMBERS",
        "combined_annual_income_krw": 40000000,
        "net_asset_krw": 100000000,
        "housing_area_m2": 59,
        "household_type": "SINGLE",
        "lease_deposit_krw": 180000000,
        "deposit_paid_ratio": 0.10,
        "contract_balance_date": "2026-03-10",
        "move_in_date": "2026-04-20",
        "application_date": "2026-05-01",
    }

    decision = evaluate(load_program("nhuf-youth-jeonse"), profile)

    # 혁신도시·재개발·자녀 수·재직 형태·병역 복무기간을 몰라도 판정이 난다
    assert decision.status == "PRECHECK_MATCH"
    assert decision.missing_fields == []

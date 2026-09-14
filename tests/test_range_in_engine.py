"""범위로만 아는 값을 판정에 넣는다.

정확한 값을 몰라도 범위 전체가 기준 한쪽에 떨어지면 판정이 된다. `4천 후반대`는
5천만원 기준을 넘지 않으므로 더 물어볼 필요가 없다.

**걸칠 때만 묻는다.** 이것이 "모르면 판정 안 함"을 "모르는 정도가 판정에 영향을 줄
때만 안 함"으로 바꾼 것이다.

다만 **금액 계산은 정확한 값을 요구한다.** 대출 한도를 범위로 알려 주면 사용자가
그 금액으로 계약을 진행한다.
"""

from __future__ import annotations

from housing_finance_agent.amount import Range
from housing_finance_agent.assessment import assess
from housing_finance_agent.eligibility import evaluate
from housing_finance_agent.rules import load_program

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


def _소득(value: object) -> dict:
    return {**_통과, "combined_annual_income_krw": value}


def test_범위가_기준_안에_다_들어가면_통과한다() -> None:
    """4천 후반대는 5천만원 기준을 넘지 않는다. 정확한 값을 묻지 않는다."""
    decision = evaluate(load_program("nhuf-youth-jeonse"), _소득(Range(45000000, 50000000)))

    assert decision.status == "PRECHECK_MATCH"
    assert decision.missing_fields == []
    assert decision.imprecise_fields == []


def test_범위가_기준_밖에_다_있으면_탈락한다() -> None:
    """6천만원 언저리는 어느 쪽으로 읽어도 5천만원을 넘는다."""
    decision = evaluate(load_program("nhuf-youth-jeonse"), _소득(Range(54000000, 66000000)))

    assert decision.status == "NOT_MATCHED"
    assert "B-05" in decision.failed_rules


def test_범위가_기준을_걸치면_정확한_값을_묻는다() -> None:
    decision = evaluate(load_program("nhuf-youth-jeonse"), _소득(Range(45000000, 55000000)))

    assert decision.status == "CONDITIONAL"
    assert decision.imprecise_fields == ["combined_annual_income_krw"]
    # 값이 아예 없는 것과 구분한다. 화면이 다른 말을 해야 한다.
    assert decision.missing_fields == []


def test_값이_없는_것과_애매한_것을_구분한다() -> None:
    없음 = {key: value for key, value in _통과.items() if key != "combined_annual_income_krw"}

    decision = evaluate(load_program("nhuf-youth-jeonse"), 없음)

    assert decision.missing_fields == ["combined_annual_income_krw"]
    assert decision.imprecise_fields == []


def test_범위가_기준_안에_있으면_다른_항목도_그대로_판정된다() -> None:
    """나이를 28~32로만 알아도 19세 이상 34세 이하는 확정된다."""
    decision = evaluate(load_program("nhuf-youth-jeonse"), {**_통과, "age": Range(28, 32)})

    assert decision.status == "PRECHECK_MATCH"


def test_나이_범위가_상한을_걸치면_묻는다() -> None:
    decision = evaluate(load_program("nhuf-youth-jeonse"), {**_통과, "age": Range(33, 36)})

    assert decision.status == "CONDITIONAL"
    assert decision.imprecise_fields == ["age"]


def test_같다_비교에는_범위를_쓸_수_없어_묻는다() -> None:
    """범위를 같다·포함된다로 비교할 수는 없다. 거짓으로 단정하면 잘못 탈락시킨다."""
    program = {
        "program": {"program_id": "test"},
        "rules": [
            {
                "rule_id": "T-01",
                "field": "region",
                "operator": "eq",
                "value": "CAPITAL_AREA",
                "type": "HARD",
                "human_reviewed": True,
                "failure_message": "수도권이 아님",
            }
        ],
    }

    decision = evaluate(program, {"region": Range(1, 2)})

    assert decision.status == "CONDITIONAL"
    assert decision.imprecise_fields == ["region"]
    assert decision.failed_rules == []


def test_범위로_통과해도_한도는_계산하지_않는다() -> None:
    """금액을 범위로 알려 주면 사용자가 그 금액으로 계약을 진행한다."""
    범위_보증금 = {**_통과, "lease_deposit_krw": Range(180000000, 200000000)}

    result = assess(load_program("nhuf-youth-jeonse"), 범위_보증금)

    assert result.decision.status == "PRECHECK_MATCH"
    assert result.loan_limit.amount_krw is None


def test_판정은_됐는데_한도를_못_내면_그_이유를_알려_준다() -> None:
    범위_보증금 = {**_통과, "lease_deposit_krw": Range(180000000, 200000000)}

    result = assess(load_program("nhuf-youth-jeonse"), 범위_보증금)

    assert result.next_actions == ["정확한 대출 한도를 보려면 임차보증금을 정확히 알려주세요"]


def test_애매한_값은_더_정확한_값을_달라고_안내한다() -> None:
    result = assess(load_program("nhuf-youth-jeonse"), _소득(Range(45000000, 55000000)))

    assert result.next_actions == ["부부합산 총소득이 기준에 걸칩니다. 정확한 값을 알려주세요"]

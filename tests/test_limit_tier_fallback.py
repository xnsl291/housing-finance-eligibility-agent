"""한도 구간을 모를 때 더 보수적인 구간으로 내려간다.

규칙에서 한 판단(D-24, 푸는 특례와 조이는 특례)을 한도에도 적용한다. 신혼·2자녀
구간은 한도가 **더 높다**(80%·2.22억 vs 70%·1.2억). 해당 여부를 모를 때 일반
구간을 쓰면 더 적은 금액이 나오므로 위험한 방향이 아니다.

**다만 "더 받을 수 있다"는 사실을 숨기지 않는다.** 금액만 낮게 주고 말면 사용자가
자기가 받을 수 있는 것보다 적게 알고 계약한다.
"""

from __future__ import annotations

from housing_finance_agent.assessment import assess
from housing_finance_agent.limits import estimate_loan_limit
from housing_finance_agent.rules import load_program

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


def test_유리한_구간_해당_여부를_모르면_일반_구간으로_계산한다() -> None:
    """전에는 아무 금액도 못 냈다. 조건은 통과인데 한도가 비어 모순이었다."""
    limit = estimate_loan_limit(load_program("nhuf-general-jeonse"), _일반)

    assert limit.amount_krw == 105000000  # 1.5억의 70%
    assert limit.tier == "general"


def test_더_받을_수_있다는_사실을_함께_알린다() -> None:
    """금액만 낮게 주고 말면 받을 수 있는 것보다 적게 알고 계약한다."""
    limit = estimate_loan_limit(load_program("nhuf-general-jeonse"), _일반)

    assert "newlywed_or_two_children" in limit.skipped_tiers


def test_해당하는_것이_확인되면_유리한_구간을_쓴다() -> None:
    신혼 = {**_일반, "marital_status": "NEWLYWED", "lease_deposit_krw": 250000000}

    limit = estimate_loan_limit(load_program("nhuf-general-jeonse"), 신혼)

    assert limit.tier == "newlywed_or_two_children"
    assert limit.amount_krw == 200000000  # 2.5억의 80%
    assert limit.skipped_tiers == ()


def test_해당하지_않는_것이_확인되면_건너뛴_것으로_세지_않는다() -> None:
    """모르는 것과 아닌 것은 다르다. 아니라고 확인됐으면 안내할 이유가 없다."""
    확인됨 = {**_일반, "marital_status": "SINGLE", "minor_children_count": 0}

    limit = estimate_loan_limit(load_program("nhuf-general-jeonse"), 확인됨)

    assert limit.tier == "general"
    assert limit.skipped_tiers == ()


def test_조이는_구간은_모르면_계산하지_않는다() -> None:
    """청년전용의 만 25세 미만 단독세대주 구간은 한도가 **더 낮다**(1.2억 vs 1.5억).

    모르는 채로 일반 구간을 쓰면 실제보다 큰 금액을 알려 준다.
    """
    청년 = {"age": 24, "lease_deposit_krw": 200000000}  # 단독세대주 여부를 모른다

    limit = estimate_loan_limit(load_program("nhuf-youth-jeonse"), 청년)

    assert limit.amount_krw is None
    assert limit.reason == "TIER_UNKNOWN"


def test_화면이_더_받을_수_있다는_안내를_받는다() -> None:
    result = assess(load_program("nhuf-general-jeonse"), _일반)

    assert any("늘어날 수 있습니다" in action for action in result.next_actions)

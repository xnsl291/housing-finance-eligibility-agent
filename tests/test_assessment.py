"""판정·한도·안내를 한 번에 내는 진입점.

화면과 API가 부를 자리다. 셋을 따로 부르게 하면 부르는 순서를 지키는 책임이
호출부로 넘어간다. 조건 불충족인 사람에게 한도를 계산해 주는 실수가 거기서 난다.

**안내 문구는 지어내지 않는다.** 확인 방법이 원문에 적혀 있는 항목에만 붙이고,
없는 항목은 이름만 보여 준다. 없는 창구를 안내하면 판정이 맞아도 쓸모가 없다.
"""

from __future__ import annotations

from housing_finance_agent.assessment import assess
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


def test_조건을_만족하면_판정과_한도를_함께_준다() -> None:
    result = assess(load_program("nhuf-youth-jeonse"), _통과)

    assert result.decision.status == "PRECHECK_MATCH"
    assert result.loan_limit.amount_krw == 150000000


def test_조건_불충족이면_한도를_계산하지_않는다() -> None:
    """탈락한 사람에게 금액을 알려 주면 안 된다. 부르는 순서를 이 함수가 강제한다."""
    result = assess(load_program("nhuf-youth-jeonse"), {**_통과, "age": 35})

    assert result.decision.status == "NOT_MATCHED"
    assert result.loan_limit is None


def test_불충족_사유를_사람이_읽을_문장으로_준다() -> None:
    result = assess(load_program("nhuf-youth-jeonse"), {**_통과, "age": 35})

    assert result.next_actions == ["만 34세를 넘으면 신청 대상이 아님"]


def test_부족한_항목은_한국어_이름으로_알려_준다() -> None:
    """화면에 net_asset_krw라고 띄울 수는 없다."""
    모름 = {key: value for key, value in _통과.items() if key != "net_asset_krw"}

    result = assess(load_program("nhuf-youth-jeonse"), 모름)

    assert result.decision.status == "INSUFFICIENT_INFORMATION"
    assert any("순자산" in action for action in result.next_actions)


def test_확인_방법이_원문에_있는_항목은_그것도_알려_준다() -> None:
    """순자산은 어디서 확인하는지가 원문에 적혀 있다."""
    모름 = {key: value for key, value in _통과.items() if key != "net_asset_krw"}

    result = assess(load_program("nhuf-youth-jeonse"), 모름)

    assert any("주택도시기금" in action for action in result.next_actions)


def test_확인_방법이_없는_항목은_이름만_알려_준다() -> None:
    """없는 창구를 지어내지 않는다. 모른다는 사실만 정확히 전한다.

    나이를 예로 쓴다. 전용면적을 쓰다가 2026-09-22에 그 항목에 `how_to_check`가
    붙어서(평으로 말한 수를 쓰지 말라는 안내) 이 테스트가 깨졌다. 확인 방법이
    **정말로** 없는 항목을 골라야 뜻이 유지된다.
    """
    모름 = {key: value for key, value in _통과.items() if key != "age"}

    result = assess(load_program("nhuf-youth-jeonse"), 모름)

    안내 = [action for action in result.next_actions if "나이" in action]
    assert 안내 == ["나이 정보가 필요합니다"]


def test_항목_안내는_두_상품이_함께_쓴다() -> None:
    """순자산·나이 같은 항목은 상품이 달라도 같은 안내다. 한 곳에 두고 읽을 때 합친다."""
    program = load_program("nhuf-general-jeonse")

    assert program["field_guides"]["net_asset_krw"]["label"] == "순자산"

"""대출 한도 계산.

판정과 성격이 다르다. 판정은 참·거짓이고 계산은 숫자다. 그래서 판정 엔진에 넣지
않고 따로 뒀다. 조건 불충족인 사람에게 한도를 알려 주면 안 되므로, 부르는 쪽이
판정을 먼저 하고 통과했을 때만 이것을 부른다.

**모르면 계산하지 않는다.** 지역을 모르는데 한쪽 기준으로 계산하면 틀린 금액을
알려 주게 된다. 판정에서 "모르는 것과 충족한 것은 다르다"고 한 것과 같은 이유다.
"""

from __future__ import annotations

from housing_finance_agent.limits import estimate_loan_limit
from housing_finance_agent.rules import load_program

_청년 = {
    "age": 30,
    "household_type": "SINGLE",
    "lease_deposit_krw": 200000000,
}


def test_비율과_상한_중_작은_쪽을_쓴다() -> None:
    """보증금 2억의 80%는 1.6억이지만 상한이 1.5억이라 1.5억이 된다."""
    limit = estimate_loan_limit(load_program("nhuf-youth-jeonse"), _청년)

    assert limit.amount_krw == 150000000
    assert limit.ratio_amount_krw == 160000000
    assert limit.cap_amount_krw == 150000000


def test_비율이_상한보다_작으면_비율이_적용된다() -> None:
    """보증금 1.5억의 80%는 1.2억으로 상한 1.5억보다 작다."""
    limit = estimate_loan_limit(
        load_program("nhuf-youth-jeonse"), {**_청년, "lease_deposit_krw": 150000000}
    )

    assert limit.amount_krw == 120000000


def test_만_25세_미만_단독세대주는_상한이_낮다() -> None:
    """같은 보증금인데 나이 때문에 한도가 달라진다."""
    limit = estimate_loan_limit(load_program("nhuf-youth-jeonse"), {**_청년, "age": 24})

    assert limit.amount_krw == 120000000
    assert limit.tier == "under_25_single"


def test_일반_버팀목은_지역에_따라_상한이_다르다() -> None:
    program = load_program("nhuf-general-jeonse")
    profile = {
        "lease_deposit_krw": 100000000,
        "marital_status": "SINGLE",
        "minor_children_count": 0,
    }

    수도권 = estimate_loan_limit(program, {**profile, "region": "CAPITAL_AREA"})
    지방 = estimate_loan_limit(program, {**profile, "region": "NON_CAPITAL_AREA"})

    # 1억의 70%는 7천만원으로 두 지역 상한(1.2억·8천만원)보다 작다
    assert 수도권.amount_krw == 70000000
    assert 지방.amount_krw == 70000000

    큰_보증금 = {**profile, "lease_deposit_krw": 300000000}
    assert estimate_loan_limit(program, {**큰_보증금, "region": "CAPITAL_AREA"}).amount_krw == (
        120000000
    )
    assert estimate_loan_limit(program, {**큰_보증금, "region": "NON_CAPITAL_AREA"}).amount_krw == (
        80000000
    )


def test_신혼가구는_비율과_상한이_모두_올라간다() -> None:
    """일반가구는 70%에 1.2억, 신혼은 80%에 2.22억이다."""
    program = load_program("nhuf-general-jeonse")
    profile = {
        "lease_deposit_krw": 300000000,
        "region": "CAPITAL_AREA",
        "minor_children_count": 0,
        "marital_status": "NEWLYWED",
    }

    limit = estimate_loan_limit(program, profile)

    assert limit.tier == "newlywed_or_two_children"
    assert limit.ratio_amount_krw == 240000000  # 3억의 80%
    assert limit.amount_krw == 222000000  # 상한이 더 작다


def test_지역을_모르면_계산하지_않는다() -> None:
    """한쪽 기준으로 임의 계산하면 틀린 금액을 알려 주게 된다."""
    limit = estimate_loan_limit(
        load_program("nhuf-general-jeonse"),
        {"lease_deposit_krw": 100000000, "marital_status": "SINGLE", "minor_children_count": 0},
    )

    assert limit is None


def test_특례_구간에_해당하는지_모르면_일반_구간으로_내려가지_않는다() -> None:
    """만 24세인데 단독세대주인지 모르는 경우다.

    단독세대주면 상한이 1.2억이고 아니면 1.5억이다. 모르는 채로 일반 구간을 쓰면
    실제보다 3천만원 큰 금액을 알려 주게 된다. 판정 엔진이 특례를 모를 때 일반
    규칙도 적용하지 않는 것과 같은 규칙이다.
    """
    limit = estimate_loan_limit(
        load_program("nhuf-youth-jeonse"),
        {"age": 24, "lease_deposit_krw": 200000000},  # household_type 없음
    )

    assert limit is None


def test_보증금을_모르면_계산하지_않는다() -> None:
    limit = estimate_loan_limit(
        load_program("nhuf-youth-jeonse"), {"age": 30, "household_type": "SINGLE"}
    )

    assert limit is None


def test_검수되지_않은_한도는_계산하지_않는다() -> None:
    """판정 규칙과 같은 기준이다. 사람이 원문과 대조하지 않은 값은 쓰지 않는다."""
    program = load_program("nhuf-youth-jeonse")
    program["limits"]["loan_amount"]["human_reviewed"] = False

    assert estimate_loan_limit(program, _청년) is None


def test_계산_근거를_함께_돌려준다() -> None:
    """화면이 '무엇을 근거로 이 금액이 나왔는지'를 보여 줄 수 있어야 한다."""
    limit = estimate_loan_limit(load_program("nhuf-youth-jeonse"), _청년)

    assert "1억 5천만원" in limit.citation
    assert limit.rule_id == "B-12"

"""실제 규칙 파일로 판정이 나는지 확인한다.

엔진 단위 테스트(test_eligibility.py)는 지어낸 규칙을 쓴다. 여기서는 공식 문서에서
뽑아 검수한 진짜 규칙 파일을 읽어 판정한다. 규칙 파일과 엔진이 맞물리는지,
그리고 경계에서 실제로 결과가 갈리는지를 본다.
"""

from __future__ import annotations

import pytest

from housing_finance_agent.eligibility import evaluate
from housing_finance_agent.rules import load_program

# 청년전용 버팀목을 통과하는 조건. 여기서 한 항목씩 바꿔 경계를 확인한다.
_청년_통과 = {
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
}


def test_청년전용_규칙으로_실제_판정이_난다() -> None:
    """검수를 마친 규칙이므로 판정이 나와야 한다. 검수 전에는 정보 부족만 나왔다."""
    decision = evaluate(load_program("nhuf-youth-jeonse"), _청년_통과)

    assert decision.status == "PRECHECK_MATCH"
    assert decision.failed_rules == []
    assert decision.missing_fields == []


def test_만_34세는_되고_만_35세는_안_된다() -> None:
    """나이 상한의 경계. 한 살 차이로 결과가 갈리는 것을 눈으로 보여 주는 자리다."""
    program = load_program("nhuf-youth-jeonse")

    assert evaluate(program, {**_청년_통과, "age": 34}).status == "PRECHECK_MATCH"

    탈락 = evaluate(program, {**_청년_통과, "age": 35})
    assert 탈락.status == "NOT_MATCHED"
    assert "B-02" in 탈락.failed_rules


def test_만_25세_미만_단독세대주는_60제곱미터_기준이_적용된다() -> None:
    """같은 70㎡ 주택인데 나이에 따라 결과가 갈린다. 특례가 일반 규칙을 덮는 자리다."""
    program = load_program("nhuf-youth-jeonse")
    넓은_집 = {**_청년_통과, "housing_area_m2": 70}

    assert evaluate(program, {**넓은_집, "age": 30}).status == "PRECHECK_MATCH"

    탈락 = evaluate(program, {**넓은_집, "age": 24})
    assert 탈락.status == "NOT_MATCHED"
    assert "B-10" in 탈락.failed_rules


def test_보증금을_5퍼센트_미만_지불했으면_탈락한다() -> None:
    """기금 공식 페이지에는 없고 은행 상품안내에서 찾은 조건이다."""
    탈락 = evaluate(
        load_program("nhuf-youth-jeonse"), {**_청년_통과, "deposit_paid_ratio": 0.03}
    )

    assert 탈락.status == "NOT_MATCHED"
    assert "B-17" in 탈락.failed_rules


def test_일반_버팀목은_지역에_따라_보증금_상한이_갈린다() -> None:
    """수도권 2억 5천이면 통과하고 수도권 밖이면 탈락한다."""
    program = load_program("nhuf-general-jeonse")
    profile = {
        "age": 40,
        "household_head_status": "HEAD",
        "home_ownership_status": "NO_HOME_ALL_MEMBERS",
        "combined_annual_income_krw": 40000000,
        "minor_children_count": 0,
        "marital_status": "SINGLE",
        "net_asset_krw": 100000000,
        "housing_area_m2": 59,
        "lease_deposit_krw": 250000000,
    }

    assert evaluate(program, {**profile, "region": "CAPITAL_AREA"}).status == "PRECHECK_MATCH"

    탈락 = evaluate(program, {**profile, "region": "NON_CAPITAL_AREA"})
    assert 탈락.status == "NOT_MATCHED"
    assert "N-10" in 탈락.failed_rules


def test_지역을_모르면_판정하지_않는다() -> None:
    """수도권인지 모르는 채로 한쪽 기준을 적용하면 틀린 판정이 나간다."""
    program = load_program("nhuf-general-jeonse")
    decision = evaluate(
        program,
        {
            "age": 40,
            "household_head_status": "HEAD",
            "home_ownership_status": "NO_HOME_ALL_MEMBERS",
            "combined_annual_income_krw": 40000000,
            "minor_children_count": 0,
            "marital_status": "SINGLE",
            "net_asset_krw": 100000000,
            "housing_area_m2": 59,
            "lease_deposit_krw": 250000000,
        },
    )

    assert decision.status == "INSUFFICIENT_INFORMATION"
    assert "region" in decision.missing_fields


def test_없는_규칙_파일을_찾으면_오류로_알린다() -> None:
    with pytest.raises(FileNotFoundError):
        load_program("없는-상품")

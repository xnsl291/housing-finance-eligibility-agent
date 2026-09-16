"""두 번째 시니어 검수에서 나온 것을 고친다.

가장 심각한 것은 특례 둘이 같은 일반 규칙을 덮을 때 서로를 못 덮어 **더 엄격한
쪽이 이기던 것**이다. 2자녀이면서 신혼인 사람이 신혼 기준으로는 통과인데
2자녀 기준에 걸려 탈락했다.
"""

from __future__ import annotations

import re

from housing_finance_agent.eligibility import evaluate
from housing_finance_agent.extraction import ExtractionError, extract_profile  # noqa: F401
from housing_finance_agent.rules import load_program

_기본 = {
    "age": 30,
    "household_head_status": "HEAD",
    "home_ownership_status": "NO_HOME_ALL_MEMBERS",
    "net_asset_krw": 100000000,
    "household_type": "SINGLE",
    "housing_area_m2": 59,
    "lease_deposit_krw": 200000000,
    "deposit_paid_ratio": 0.10,
    "contract_balance_date": "2026-03-10",
    "move_in_date": "2026-04-20",
    "application_date": "2026-05-01",
}


def test_신혼이면서_2자녀면_더_넓은_기준이_적용된다() -> None:
    """2자녀는 6천, 신혼은 7.5천이다. 둘 다 해당하면 신혼 기준으로 봐야 한다."""
    신혼_2자녀 = {
        **_기본,
        "minor_children_count": 2,
        "marital_status": "NEWLYWED",
        "combined_annual_income_krw": 70000000,
    }

    assert evaluate(load_program("nhuf-youth-jeonse"), 신혼_2자녀).status == "PRECHECK_MATCH"


def test_2자녀인데_혼인_상태를_모르면_묻는다() -> None:
    """신혼이면 통과할 수 있다. 모르는 채로 탈락시키면 안 된다."""
    혼인_모름 = {
        **_기본,
        "minor_children_count": 2,
        "combined_annual_income_krw": 70000000,
    }

    decision = evaluate(load_program("nhuf-youth-jeonse"), 혼인_모름)

    assert decision.status == "INSUFFICIENT_INFORMATION"
    assert "marital_status" in decision.missing_fields
    assert decision.failed_rules == []


def test_미혼_2자녀는_6천_기준으로_탈락한다() -> None:
    """특례를 넓힌 것이 잘못 통과시키는 쪽으로 새면 안 된다."""
    미혼_2자녀 = {
        **_기본,
        "minor_children_count": 2,
        "marital_status": "SINGLE",
        "combined_annual_income_krw": 70000000,
    }

    assert evaluate(load_program("nhuf-youth-jeonse"), 미혼_2자녀).status == "NOT_MATCHED"


def test_신혼이어도_7500만원을_넘으면_탈락한다() -> None:
    넘김 = {
        **_기본,
        "minor_children_count": 2,
        "marital_status": "NEWLYWED",
        "combined_annual_income_krw": 80000000,
    }

    assert evaluate(load_program("nhuf-youth-jeonse"), 넘김).status == "NOT_MATCHED"


def test_일반_버팀목도_같은_구조다() -> None:
    신혼_2자녀 = {
        **_기본,
        "region": "CAPITAL_AREA",
        "minor_children_count": 2,
        "marital_status": "NEWLYWED",
        "combined_annual_income_krw": 70000000,
    }

    assert evaluate(load_program("nhuf-general-jeonse"), 신혼_2자녀).status == "PRECHECK_MATCH"


# --- 계좌번호 탐지가 날짜를 잡던 것 ---


class _고정LLM:
    def generate(self, prompt: str) -> str:
        return "{}"


def test_날짜를_계좌번호로_보지_않는다() -> None:
    """잔금지급일과 전입일이 필수 입력이라 데모에서 반드시 걸리던 자리다."""
    result = extract_profile(_고정LLM(), "잔금은 2026-10-01이고 전입은 2026-10-15입니다")

    assert result.warnings == []


def test_계좌번호는_여전히_잡는다() -> None:
    result = extract_profile(_고정LLM(), "계좌는 110-1234-567890 입니다")

    assert result.warnings


def test_경고문에_같은_말이_겹치지_않는다() -> None:
    result = extract_profile(_고정LLM(), "주민번호 900101-1234567")

    assert result.warnings
    assert not re.search(r"보이는.*보이는", result.warnings[0])

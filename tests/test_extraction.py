"""문장에서 신청자 조건을 뽑는다.

**이 시스템에서 LLM이 닿는 유일한 자리다.** 판정과 계산은 LLM이 못 건드린다.
그래서 여기의 관심사는 "잘 뽑는가"보다 **"잘못 뽑은 것을 걸러내는가"**다.

걸러내는 기준은 셋이다.
- 모르는 항목 이름이 오면 버린다
- 정해진 값이 아닌 것이 오면 버린다 (`HEAD`가 아니라 `가장`)
- 금액은 LLM의 숫자를 믿지 않고 표현을 파서에 넘긴다

**버린 것은 null이 된다. 억지로 고치지 않는다.** 판정은 사용자가 확인한 뒤에 돈다.

테스트는 가짜 LLM으로 한다. 실물을 부르면 느리고 CI에서 돌지 않는다.
"""

from __future__ import annotations

import json

import pytest

from housing_finance_agent.amount import Range
from housing_finance_agent.extraction import ExtractionError, extract_profile


class FakeLlm:
    """정해진 답을 돌려주는 LLM. 여러 개를 주면 부를 때마다 차례로 준다."""

    def __init__(self, *replies: str) -> None:
        self.replies = list(replies)
        self.prompts: list[str] = []

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.replies.pop(0) if self.replies else "{}"


def _reply(**fields: object) -> str:
    return json.dumps(fields, ensure_ascii=False)


def test_문장에서_조건을_뽑는다() -> None:
    llm = FakeLlm(
        _reply(
            age=29,
            household_head_status="HEAD",
            home_ownership_status="NO_HOME_ALL_MEMBERS",
            combined_annual_income_krw="4천만원",
            region="CAPITAL_AREA",
            lease_deposit_krw="1억8천",
        )
    )

    result = extract_profile(llm, "만 29세 직장인이고 무주택 세대주입니다")

    assert result.values["age"] == 29
    assert result.values["combined_annual_income_krw"] == 40000000
    assert result.values["lease_deposit_krw"] == 180000000


def test_금액은_LLM_숫자가_아니라_파서가_만든다() -> None:
    """LLM이 1억8천을 18000000으로 쓰면 아무도 모른다. 표현을 받아 코드가 바꾼다."""
    llm = FakeLlm(_reply(lease_deposit_krw="1억8천"))

    result = extract_profile(llm, "보증금 1억8천")

    assert result.values["lease_deposit_krw"] == 180000000


def test_대략적인_금액은_범위로_들어간다() -> None:
    llm = FakeLlm(_reply(combined_annual_income_krw="4천만원 후반"))

    result = extract_profile(llm, "연봉은 4천 후반대예요")

    assert result.values["combined_annual_income_krw"] == Range(45000000, 50000000)


def test_읽지_못한_금액은_넣지_않고_원문을_남긴다() -> None:
    """빈칸만 보여 주면 사용자가 무엇을 고쳐야 하는지 모른다."""
    llm = FakeLlm(_reply(combined_annual_income_krw="작년보다 조금 올랐어요"))

    result = extract_profile(llm, "작년보다 조금 올랐어요")

    assert "combined_annual_income_krw" not in result.values
    assert result.unreadable["combined_annual_income_krw"] == "작년보다 조금 올랐어요"


def test_모르는_항목_이름은_버린다() -> None:
    llm = FakeLlm(_reply(age=29, favorite_color="파랑"))

    result = extract_profile(llm, "만 29세")

    assert "favorite_color" not in result.values
    assert result.values["age"] == 29


def test_정해진_값이_아니면_버린다() -> None:
    """세대주 여부는 HEAD 아니면 PROSPECTIVE_HEAD다. 가장이라고 오면 쓸 수 없다."""
    llm = FakeLlm(_reply(age=29, household_head_status="가장"))

    result = extract_profile(llm, "만 29세 가장입니다")

    assert "household_head_status" not in result.values
    assert result.values["age"] == 29


def test_null은_넣지_않는다() -> None:
    """문장에 없는 값을 추측하지 말라고 시켰고, 그 결과가 null이다."""
    llm = FakeLlm(_reply(age=29, net_asset_krw=None))

    result = extract_profile(llm, "만 29세")

    assert "net_asset_krw" not in result.values


def test_어디서_읽었는지_함께_준다() -> None:
    """화면이 '나이 29세 ← 만 29세에서 읽음'으로 보여 줘야 사용자가 틀린 것을 잡는다."""
    llm = FakeLlm(_reply(age=29, _sources={"age": "만 29세"}))

    result = extract_profile(llm, "만 29세 직장인입니다")

    assert result.sources["age"] == "만 29세"


def test_JSON이_깨지면_한_번만_다시_부른다() -> None:
    llm = FakeLlm("이건 JSON이 아닙니다", _reply(age=29))

    result = extract_profile(llm, "만 29세")

    assert result.values["age"] == 29
    assert len(llm.prompts) == 2


def test_두_번_다_깨지면_실패로_끝낸다() -> None:
    """부분 결과를 쓰지 않는다. 무엇이 빠졌는지 모르는 프로필이 더 위험하다."""
    llm = FakeLlm("깨짐", "또 깨짐")

    with pytest.raises(ExtractionError):
        extract_profile(llm, "만 29세")


def test_주민번호가_있으면_저장하지_않고_경고한다() -> None:
    """계획서 §16 안전 테스트. 받지 않기로 한 정보다."""
    llm = FakeLlm(_reply(age=29))

    result = extract_profile(llm, "제 주민번호는 900101-1234567이고 만 29세입니다")

    assert result.warnings
    assert all("900101" not in warning for warning in result.warnings)
    assert all("900101" not in str(value) for value in result.values.values())


def test_프롬프트에_항목과_허용값이_들어간다() -> None:
    """LLM이 무엇을 뽑아야 하는지 모르면 아무거나 만든다."""
    llm = FakeLlm(_reply(age=29))

    extract_profile(llm, "만 29세")

    prompt = llm.prompts[0]
    assert "age" in prompt
    assert "PROSPECTIVE_HEAD" in prompt
    assert "null" in prompt


def test_지역은_이름만_뽑고_수도권_여부는_만들지_않는다() -> None:
    """수도권 여부는 판정 직전에 profile.enrich가 만든다.

    여기서 만들면 사용자가 화면에서 지역을 고쳐도 옛 파생값이 판정에 간다
    (2026-09-14 검토에서 발견).
    """
    result = extract_profile(FakeLlm(_reply(region_name="경기도 성남시")), "경기도 성남시")

    assert result.values["region_name"] == "경기도 성남시"
    assert "region" not in result.values

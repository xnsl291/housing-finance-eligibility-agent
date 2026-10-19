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
    # 버리되 흔적은 남긴다. 확인 화면이 원문을 보여 주고 직접 고르게 한다.
    assert result.unreadable["household_head_status"] == "가장"


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


def test_불리언은_참만_받고_거짓은_버린다() -> None:
    """모델이 내는 false는 "아니다"가 아니라 기본값이다.

    두 항목 모두 정의가 "**직접 말한 경우만** true"다. false를 그대로 받으면
    판정이 조용히 망가진다 — 둘은 소득 기준을 올려 주는 '푸는 특례'이고, 엔진은
    적용 여부를 모를 때 사용자에게 묻도록 `relaxes: true`로 만들어 두었다.
    추출이 false로 단정하면 엔진이 물어볼 기회를 잃고 해당자를 탈락시킨다.

    2026-09-22 측정에서 환각 15건 중 12건이 정확히 이것이었다
    (`evaluation/extraction/report-2026-09-22.md`).
    """
    llm = FakeLlm(
        _reply(
            age=30,
            is_redevelopment_area_tenant=False,
            is_innovation_city_relocated_worker=False,
        )
    )

    result = extract_profile(llm, "만 30세입니다")

    assert result.values == {"age": 30}, "거짓을 버리지 않았다"


def test_직접_말한_참은_받는다() -> None:
    """위 테스트의 짝. 참까지 버리면 특례 해당자가 그 사실을 못 전한다."""
    llm = FakeLlm(_reply(is_innovation_city_relocated_worker=True))

    result = extract_profile(llm, "혁신도시 이전 기관에서 일합니다")

    assert result.values == {"is_innovation_city_relocated_worker": True}


def test_평으로_말한_면적은_쓰지_않고_원문을_남긴다() -> None:
    """산수가 안 되는 게 아니다. 1평 = 3.3058㎡는 확정된 상수다.

    **어느 면적인지가 문장으로 정해지지 않는다.** "25평 아파트"는 보통 공급면적을
    말하고 판정이 보는 것은 전용면적이다. 25 × 3.3058 = 82.6㎡로 환산하면 실제
    전용면적(보통 59㎡ 근처)과 크게 다르고, 대응이 단지마다 달라 공개 자료에
    고정된 표가 없다.

    그대로 두면 **전용 82㎡인 집이 60㎡ 특례를 통과한다**(2026-09-22 측정 E-18).
    잘못 통과시키는 방향이라 가장 위험하다.
    """
    llm = FakeLlm(
        json.dumps(
            {"housing_area_m2": 25.0, "_sources": {"housing_area_m2": "25평 아파트"}},
            ensure_ascii=False,
        )
    )

    result = extract_profile(llm, "25평 아파트를 보고 있습니다")

    assert "housing_area_m2" not in result.values, "평으로 말한 수를 그대로 썼다"
    assert result.unreadable["housing_area_m2"] == "25평 아파트", "원문을 안 남겼다"


def test_제곱미터로_말한_면적은_그대로_쓴다() -> None:
    """위 테스트의 짝. 제곱미터까지 버리면 정상 입력이 막힌다."""
    llm = FakeLlm(
        json.dumps(
            {"housing_area_m2": 59.0, "_sources": {"housing_area_m2": "전용면적 59제곱미터"}},
            ensure_ascii=False,
        )
    )

    result = extract_profile(llm, "전용면적 59제곱미터입니다")

    assert result.values == {"housing_area_m2": 59.0}
    assert not result.unreadable


def test_특례를_막는_값은_추출로_받지_않는다() -> None:
    """불리언에서 거짓을 버리는 것과 같은 이유다. 틀리면 해당자가 조용히 탈락한다.

    - "직장인"을 `OTHER`로 채우면 청년 전세의 병역 특례 판단이 막힌다(2026-10-02 E-02)
    - "결혼 2년차"를 `MARRIED`로 읽으면 신혼 소득 기준(7.5천만원)이 빠진다(E-03)

    버리면 빈칸으로 남고 질문 루프가 직접 묻는다.
    """
    llm = FakeLlm(_reply(age=31, employment_category="OTHER", marital_status="MARRIED"))

    result = extract_profile(llm, "결혼 2년차 직장인이고 만 31세입니다")

    assert result.values == {"age": 31}, "단정할 수 없는 값을 받았다"


def test_특례를_여는_값은_받는다() -> None:
    """위 테스트의 짝. 신혼·중소기업까지 버리면 해당자가 그 사실을 못 전한다."""
    llm = FakeLlm(_reply(employment_category="SME_OR_MID_SIZED", marital_status="NEWLYWED"))

    result = extract_profile(llm, "중소기업에 다니고 결혼 1년차입니다")

    assert result.values == {
        "employment_category": "SME_OR_MID_SIZED",
        "marital_status": "NEWLYWED",
    }


def test_단위를_채우며_떨어뜨린_어림말을_근거에서_되살린다() -> None:
    """"연 7천 정도"가 `7천만원`으로 오면 한 값으로 굳는다(2026-10-02 측정 E-09).

    사용자는 6.3천~7.7천 어딘가라고 했다. 기준선 근처에서는 이 차이가 판정을 가른다.
    """
    llm = FakeLlm(
        _reply(
            combined_annual_income_krw="7천만원",
            _sources={"combined_annual_income_krw": "연 7천 정도"},
        )
    )

    result = extract_profile(llm, "연 7천 정도 법니다")

    assert result.values["combined_annual_income_krw"] == Range(63000000, 77000000)


def test_근거에_어림말이_없으면_정확한_값으로_둔다() -> None:
    """위 테스트의 짝. 아무 금액이나 범위로 넓히면 정확히 말한 사람의 값이 흐려진다."""
    llm = FakeLlm(
        _reply(
            combined_annual_income_krw="7천만원",
            _sources={"combined_annual_income_krw": "연봉 7천"},
        )
    )

    result = extract_profile(llm, "연봉 7천입니다")

    assert result.values["combined_annual_income_krw"] == 70000000


def test_연도를_말하지_않은_날짜는_쓰지_않고_원문을_남긴다() -> None:
    """날짜 칸은 `YYYY-MM-DD`라 모델이 연도를 지어낸다(2026-10-02 측정 E-20).

    "4월 20일"이 2024-04-20으로 들어가면 신청 기한 판정이 2년 어긋난다. 앞 날짜의
    연도를 이어 붙이지 않는다 — 해를 넘기는 경우에 틀린다.
    """
    llm = FakeLlm(
        _reply(
            contract_balance_date="2026-03-10",
            move_in_date="2024-04-20",
            _sources={
                "contract_balance_date": "잔금은 2026년 3월 10일",
                "move_in_date": "전입은 4월 20일",
            },
        )
    )

    result = extract_profile(llm, "잔금은 2026년 3월 10일, 전입은 4월 20일")

    assert result.values == {"contract_balance_date": "2026-03-10"}
    assert result.unreadable["move_in_date"] == "전입은 4월 20일", "원문을 안 남겼다"


@pytest.mark.parametrize("근거", ["2026-03-10", "2026.3.10", "26년 3월 10일"])
def test_연도를_말한_날짜는_받는다(근거: str) -> None:
    """위 테스트의 짝. 연도를 적는 여러 모양을 다 막으면 정상 입력이 빈칸이 된다."""
    llm = FakeLlm(
        _reply(contract_balance_date="2026-03-10", _sources={"contract_balance_date": 근거})
    )

    result = extract_profile(llm, f"잔금일은 {근거}입니다")

    assert result.values == {"contract_balance_date": "2026-03-10"}


def test_모양이_틀린_숫자는_조용히_버리지_않고_원문을_남긴다() -> None:
    """모델이 면적을 `"59제곱미터"` 문자열로 줬다(2026-10-19 측정 E-17).

    실수 항목이 문자열을 버리면서 `unreadable`에도 안 남겨, 확인 화면에서 사용자가
    말한 면적이 흔적 없이 사라졌다.
    """
    llm = FakeLlm(
        _reply(
            housing_area_m2="59제곱미터",
            _sources={"housing_area_m2": "전용면적 59제곱미터"},
        )
    )

    result = extract_profile(llm, "전용면적 59제곱미터 아파트입니다")

    assert result.values == {}
    assert result.unreadable == {"housing_area_m2": "전용면적 59제곱미터"}


def test_불리언의_거짓은_원문으로도_남기지_않는다() -> None:
    """위 테스트의 짝. 거짓을 버리는 것은 의도라 경고를 띄우면 안 된다."""
    llm = FakeLlm(_reply(is_redevelopment_area_tenant=False))

    result = extract_profile(llm, "만 30세입니다")

    assert result.unreadable == {}

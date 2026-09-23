"""시니어 검토에서 나온 것을 고친다.

가장 심각한 것은 지역 매핑이 사용자 수정 경로에서 무력화되던 것이다. region은
extraction이 만들고 있었는데, 화면에서 지역을 고쳐도 판정에는 추출 당시 값이 갔다.
프롬프트로 안 돼서 코드로 옮긴 매핑이 정작 고치는 자리에서 되살아난 셈이다.
"""

from __future__ import annotations

from housing_finance_agent.amount import Range
from housing_finance_agent.assessment import assess
from housing_finance_agent.eligibility import evaluate
from housing_finance_agent.limits import estimate_loan_limit
from housing_finance_agent.profile import enrich
from housing_finance_agent.rules import field_catalog, load_program

_기본 = {
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


# --- 1. 지역 파생을 판정 직전에 한다 ---


def test_지역명을_고치면_수도권_여부도_따라_바뀐다() -> None:
    """화면에서 사용자가 고치는 것은 지역명뿐이다. 수도권 여부는 판정 직전에 다시 만든다."""
    assert enrich({"region_name": "경기도 성남시"})["region"] == "CAPITAL_AREA"
    assert enrich({"region_name": "부산"})["region"] == "NON_CAPITAL_AREA"


def test_추출_당시_수도권_값이_남아_있어도_지역명을_따른다() -> None:
    """사용자가 지역을 고쳤는데 옛 파생값이 남아 판정을 뒤집는 것을 막는다."""
    stale = {"region_name": "부산", "region": "CAPITAL_AREA"}

    assert enrich(stale)["region"] == "NON_CAPITAL_AREA"


def test_지역명이_없으면_수도권_여부를_만들지_않는다() -> None:
    assert "region" not in enrich({"age": 30})


# --- 2. 판정 상태를 넷으로 ---


def test_값이_기준을_걸치면_추가_확인_필요다() -> None:
    """값이 아예 없는 것과 다르다. 사용자는 이미 말했고 정밀도만 모자란다."""
    걸침 = {**_기본, "combined_annual_income_krw": Range(45000000, 55000000)}

    assert evaluate(load_program("nhuf-youth-jeonse"), 걸침).status == "CONDITIONAL"


def test_값이_아예_없으면_정보_부족이다() -> None:
    없음 = {key: value for key, value in _기본.items() if key != "net_asset_krw"}

    assert evaluate(load_program("nhuf-youth-jeonse"), 없음).status == "INSUFFICIENT_INFORMATION"


def test_없는_것과_걸친_것이_함께면_정보_부족이_먼저다() -> None:
    """더 근본적인 부족이 앞선다. 정밀도를 묻기 전에 없는 값을 먼저 받아야 한다."""
    섞임 = {
        key: value for key, value in _기본.items() if key != "net_asset_krw"
    } | {"combined_annual_income_krw": Range(45000000, 55000000)}

    assert evaluate(load_program("nhuf-youth-jeonse"), 섞임).status == "INSUFFICIENT_INFORMATION"


# --- 3. 규칙마다 어떻게 됐는지 ---


def test_평가되지_않은_규칙도_이유와_함께_남는다() -> None:
    """통과·불충족만 보여 주면 "왜 이 조건은 안 보이나"에 답을 못 한다."""
    decision = evaluate(load_program("nhuf-youth-jeonse"), _기본)
    결과 = {item.rule_id: item.outcome for item in decision.rule_outcomes}

    assert 결과["B-09"] == "PASSED"  # 전용면적 85㎡ 일반 규칙
    assert 결과["B-10"] == "NOT_APPLICABLE"  # 만 25세 미만 단독세대주 특례
    assert 결과["B-06"] == "NOT_APPLICABLE"  # 2자녀 이상 소득 특례


def test_특례가_적용되면_일반_규칙은_대체됨으로_남는다() -> None:
    어린_단독세대주 = {**_기본, "age": 24}

    decision = evaluate(load_program("nhuf-youth-jeonse"), 어린_단독세대주)
    결과 = {item.rule_id: item.outcome for item in decision.rule_outcomes}

    assert 결과["B-10"] == "PASSED"  # 59㎡는 60㎡ 이하라 통과
    assert 결과["B-09"] == "SUPERSEDED"


def test_값이_없는_규칙은_값_없음으로_남는다() -> None:
    없음 = {key: value for key, value in _기본.items() if key != "net_asset_krw"}

    decision = evaluate(load_program("nhuf-youth-jeonse"), 없음)
    결과 = {item.rule_id: item.outcome for item in decision.rule_outcomes}

    assert 결과["B-08"] == "MISSING_VALUE"


def test_규칙_결과에_원문_인용이_함께_온다() -> None:
    """화면 4가 왜 그 판정이 나왔는지 보여 주려면 근거가 있어야 한다."""
    decision = evaluate(load_program("nhuf-youth-jeonse"), _기본)
    항목 = next(item for item in decision.rule_outcomes if item.rule_id == "B-02")

    assert "34세" in 항목.citation


# --- 4. 한도를 못 낸 이유 ---


def test_한도를_못_낸_이유를_구분해서_준다() -> None:
    program = load_program("nhuf-youth-jeonse")

    보증금_없음 = estimate_loan_limit(program, {"age": 30, "household_type": "SINGLE"})
    assert 보증금_없음.reason == "BASE_UNKNOWN"
    # 비율을 어느 값에 걸었는지도 함께 담는다. 전세는 임차보증금, 매매는 주택가격이라
    # 사유 코드만으로는 "무엇을 알려 달라"고 말할 수 없다.
    assert 보증금_없음.ratio_field == "lease_deposit_krw"

    범위 = {**_기본, "lease_deposit_krw": Range(180000000, 200000000)}
    assert estimate_loan_limit(program, 범위).reason == "BASE_IMPRECISE"

    구간_모름 = {"age": 24, "lease_deposit_krw": 200000000}
    assert estimate_loan_limit(program, 구간_모름).reason == "TIER_UNKNOWN"


def test_한도를_냈으면_사유가_없다() -> None:
    limit = estimate_loan_limit(load_program("nhuf-youth-jeonse"), _기본)

    assert limit.reason is None
    assert limit.amount_krw == 150000000


def test_화면이_한도_실패_사유를_문장으로_받는다() -> None:
    범위 = {**_기본, "lease_deposit_krw": Range(180000000, 200000000)}

    result = assess(load_program("nhuf-youth-jeonse"), 범위)

    assert result.next_actions == ["정확한 대출 한도를 보려면 임차보증금을 정확히 알려주세요"]


# --- 5. 화면이 쓸 항목 목록 ---


def test_항목_목록에_표기와_선택지가_들어_있다() -> None:
    """화면이 항목 이름과 허용값을 따로 적으면 정본이 둘로 갈라진다."""
    catalog = field_catalog()

    assert catalog["net_asset_krw"]["label"] == "순자산"
    assert catalog["household_head_status"]["choices"] == ["HEAD", "PROSPECTIVE_HEAD"]
    assert catalog["combined_annual_income_krw"]["kind"] == "AMOUNT"


def test_파생_항목은_편집_대상에서_뺀다() -> None:
    """수도권 여부와 병역 반영 나이는 코드가 만든다. 사용자가 고칠 값이 아니다."""
    catalog = field_catalog()

    assert "region" not in catalog
    assert "age_after_service_credit" not in catalog
    assert "region_name" in catalog

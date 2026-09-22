"""신청자 정보 항목의 정의.

추출과 화면이 같은 목록을 봐야 한다. 두 곳에 따로 적으면 항목이 하나 늘 때마다
두 곳을 고쳐야 하고, 한쪽만 고치면 화면에 없는 항목을 LLM이 뽑거나 그 반대가 된다.

**파생 항목은 여기 없다.** 수도권 여부(`region`)와 병역을 반영한 나이
(`age_after_service_credit`)는 코드가 만든다. 사용자가 고칠 값이 아니다.
"""

from __future__ import annotations

AMOUNT = "AMOUNT"

SPEC: dict[str, object] = {
    "age": int,
    "household_head_status": ["HEAD", "PROSPECTIVE_HEAD"],
    "household_type": ["SINGLE", "MULTI"],
    "home_ownership_status": ["NO_HOME_ALL_MEMBERS", "HAS_HOME"],
    "marital_status": ["SINGLE", "MARRIED", "NEWLYWED"],
    "is_first_time_buyer": bool,
    # 전세를 구하는가 집을 사는가. 이 항목 하나로 볼 상품이 갈린다.
    "intended_tenure": ["JEONSE", "PURCHASE"],
    "minor_children_count": int,
    # 수도권인지는 LLM에게 묻지 않는다. profile.enrich가 지역명에서 만든다.
    "region_name": str,
    "employment_category": ["SME_OR_MID_SIZED", "OTHER"],
    "military_service_years": int,
    "housing_area_m2": float,
    "deposit_paid_ratio": float,
    "is_innovation_city_relocated_worker": bool,
    "is_redevelopment_area_tenant": bool,
    "combined_annual_income_krw": AMOUNT,
    "net_asset_krw": AMOUNT,
    "lease_deposit_krw": AMOUNT,
    "housing_value_krw": AMOUNT,
    "contract_balance_date": str,
    "move_in_date": str,
    "application_date": str,
}

# 항목 이름만 주면 모델이 뜻을 짐작한다. 2026-09-14 실물 확인에서 셋이 틀렸다.
#
# - "경기도에 살아요"를 비수도권으로 읽었다. 수도권 정의가 없었다
# - "전세 1억짜리 원룸 알아보는 중"을 재개발 구역 세입자 True로 만들었다
# - "서울 전세 3억"을 주택가격에 넣었다. 임차보증금과 구분이 없었다
#
# 셋 다 판정을 뒤집는 값이라 항목마다 뜻을 적어 준다.
DESCRIPTIONS: dict[str, str] = {
    "age": "만 나이",
    "household_head_status": "세대주면 HEAD, 아직 아니고 예정이면 PROSPECTIVE_HEAD",
    "household_type": "혼자 사는 단독세대면 SINGLE, 아니면 MULTI",
    "home_ownership_status": "세대원 전원 무주택이면 NO_HOME_ALL_MEMBERS",
    "marital_status": "혼인 7년 이내면 NEWLYWED, 그 외 기혼이면 MARRIED, 미혼이면 SINGLE",
    "is_first_time_buyer": ("생애 처음으로 집을 사는 경우라고 **직접 말한 경우만** true"),
    "intended_tenure": "전세를 구하면 JEONSE, 집을 사려면 PURCHASE",
    "minor_children_count": "미성년 자녀 수",
    "region_name": '임차할 주택이 있는 지역 이름 그대로 (예: "서울", "경기도 성남시", "부산")',
    "employment_category": "중소기업 또는 중견기업 재직이면 SME_OR_MID_SIZED, 그 외 OTHER",
    "military_service_years": "병역 복무기간(년)",
    "housing_area_m2": "임차 전용면적(제곱미터)",
    "deposit_paid_ratio": "임차보증금 중 이미 지급한 비율(0~1)",
    "is_innovation_city_relocated_worker": (
        "혁신도시 이전 공공기관 종사자라고 **직접 말한 경우만** true"
    ),
    "is_redevelopment_area_tenant": (
        "재개발 구역에서 이주하는 세입자라고 **직접 말한 경우만** true"
    ),
    "combined_annual_income_krw": "본인과 배우자의 연간 합산 소득",
    "net_asset_krw": "본인과 배우자의 합산 순자산",
    "lease_deposit_krw": "전세보증금 또는 임차보증금. **'전세 3억'은 여기다**",
    "housing_value_krw": "주택의 매매가격. 전세보증금과 다르다",
    "contract_balance_date": "임대차계약 잔금지급일 (YYYY-MM-DD)",
    "move_in_date": "전입일 (YYYY-MM-DD)",
    "application_date": "대출 신청 예정일 (YYYY-MM-DD)",
}


def kind_of(name: str) -> str:
    """화면이 어떤 입력 칸을 그릴지 정하는 데 쓴다."""
    spec = SPEC[name]
    if spec is AMOUNT:
        return "AMOUNT"
    if isinstance(spec, list):
        return "CHOICE"
    if spec is bool:
        return "BOOL"
    if spec is str:
        return "TEXT"
    return "INT" if spec is int else "FLOAT"

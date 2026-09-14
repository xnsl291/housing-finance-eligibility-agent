"""신청자 조건을 판정에 쓸 수 있게 다듬는다.

규칙은 값 하나와 값 하나를 비교한다. 사람마다 기준이 달라지거나 다른 값에서
계산되는 것은 규칙 쪽에 계산을 넣는 대신 비교할 값을 여기서 하나 더 만든다.
규칙을 데이터로 유지하려면 계산이 데이터 밖에 있어야 한다.

**판정 직전에 만든다.** 뽑을 때 한 번 만들어 두면, 사용자가 화면에서 원본 값을
고쳐도 파생값은 옛것이 그대로 남아 판정을 뒤집는다. 실제로 지역 파생이 추출
단계에 있어서 이 문제가 있었다(2026-09-14 검토에서 발견).

**없는 값을 채우지 않는다.** 모르는 항목을 0이나 기본값으로 메우면 판정이
"모른다"에서 "해당 없음"으로 바뀌어 잘못된 결과가 나간다.
"""

from __future__ import annotations

# 수도권 여부는 LLM에게 맡기지 않는다.
#
# 프롬프트에 "서울·인천·경기는 CAPITAL_AREA"라고 굵게 적어도 4B 모델이 "경기도에
# 살아요"를 비수도권으로 계속 읽었다(2026-09-14 실물 확인, 프롬프트 보강 후
# 재측정에서도 동일). **프롬프트로 고쳐지지 않는 종류다.**
#
# 이 값은 판정을 뒤집는다 — 일반 버팀목의 보증금 상한이 수도권 3억, 그 외 2억이고
# 한도도 1.2억과 8천만원으로 갈린다. 금액을 파서가 맡은 것과 같은 이유로 코드가 정한다.
#
# 근거: 상품 안내의 금리 항목에 "지방 소재(서울, 인천, 경기지역 이외)"라고 적혀 있다.
_CAPITAL_AREA_KEYWORDS = ("서울", "인천", "경기")


def enrich(profile: dict) -> dict:
    """판정에 쓸 파생 값을 더한 새 dict를 준다. 받은 dict는 바꾸지 않는다."""
    enriched = dict(profile)

    # 병역을 이행하면 나이 상한이 복무기간만큼 늘어난다. 규칙의 기준값을 사람마다
    # 바꾸는 대신 비교할 나이를 되돌려 둔다. 상한 자체(만 39세)는 별도 규칙이 본다.
    age = profile.get("age")
    service_years = profile.get("military_service_years")
    if age is not None and service_years is not None:
        enriched["age_after_service_credit"] = age - service_years

    # 지역명이 있으면 수도권 여부를 여기서 다시 만든다. 사용자가 지역을 고쳤는데
    # 옛 파생값이 남아 판정을 뒤집는 일을 막는다.
    지역명 = profile.get("region_name")
    if isinstance(지역명, str) and 지역명.strip():
        enriched["region"] = (
            "CAPITAL_AREA"
            if any(keyword in 지역명 for keyword in _CAPITAL_AREA_KEYWORDS)
            else "NON_CAPITAL_AREA"
        )

    return enriched

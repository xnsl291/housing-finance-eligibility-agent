"""신청자 조건을 판정에 쓸 수 있게 다듬는다.

규칙은 값 하나와 값 하나를 비교한다. 사람마다 기준이 달라지는 조건은 규칙 쪽에
계산을 넣는 대신 비교할 값을 여기서 하나 더 만든다. 규칙을 데이터로 유지하려면
계산이 데이터 밖에 있어야 한다.

**없는 값을 채우지 않는다.** 모르는 항목을 0이나 기본값으로 메우면 판정이
"모른다"에서 "해당 없음"으로 바뀌어 잘못된 결과가 나간다.
"""

from __future__ import annotations


def enrich(profile: dict) -> dict:
    """판정에 쓸 파생 값을 더한 새 dict를 준다. 받은 dict는 바꾸지 않는다."""
    enriched = dict(profile)

    # 병역을 이행하면 나이 상한이 복무기간만큼 늘어난다. 규칙의 기준값을 사람마다
    # 바꾸는 대신 비교할 나이를 되돌려 둔다. 상한 자체(만 39세)는 별도 규칙이 본다.
    age = profile.get("age")
    service_years = profile.get("military_service_years")
    if age is not None and service_years is not None:
        enriched["age_after_service_credit"] = age - service_years

    return enriched

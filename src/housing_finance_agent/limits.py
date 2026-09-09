"""대출 한도 계산.

판정과 따로 둔 이유는 성질이 달라서다. 판정은 조건 하나하나에 참·거짓으로 답하고
독립적으로 셀 수 있다. 계산은 여러 값을 조합해야 하고, 그전에 "어느 기준이
적용되는가"를 먼저 골라야 한다.

**부르는 순서가 정해져 있다.** 판정을 먼저 하고 조건 불충족이 아닐 때만 이것을
부른다. 탈락한 사람에게 한도를 알려 주면 안 된다.

**모르면 계산하지 않는다.** 지역을 모르는데 한쪽 기준으로 계산하면 틀린 금액이
나간다. 판정 엔진이 "모르는 것과 충족한 것은 다르다"고 한 것과 같은 규칙이다.
"""

from __future__ import annotations

from dataclasses import dataclass

from housing_finance_agent.eligibility import applies_to


@dataclass(frozen=True, slots=True)
class LoanLimit:
    """계산 결과와 그 근거.

    금액만 주면 화면이 "왜 이 금액인지"를 못 보여 준다. 비율로 구한 값과 상한을
    함께 담아 어느 쪽에 걸렸는지 알 수 있게 한다.
    """

    amount_krw: int
    tier: str
    ratio_amount_krw: int
    cap_amount_krw: int
    citation: str
    rule_id: str


def estimate_loan_limit(program: dict, profile: dict) -> LoanLimit | None:
    """대출 한도를 구한다. 계산할 수 없으면 None."""
    spec = (program.get("limits") or {}).get("loan_amount")
    if not spec or not spec.get("human_reviewed"):
        return None

    deposit = profile.get("lease_deposit_krw")
    if deposit is None:
        return None

    tier = _pick_tier(spec["tiers"], profile)
    if tier is None:
        return None

    cap = _cap_of(tier, profile)
    if cap is None:
        return None

    # 원문이 "임차보증금의 N% 이내에서 최고 M원 이내"라고 적어 두 상한이 함께 걸린다.
    # 소수점은 버린다. 원 단위 아래 반올림 규칙은 원문에 없어 정하지 않았다.
    ratio_amount = int(deposit * tier["ratio_of_deposit"])
    return LoanLimit(
        amount_krw=min(ratio_amount, cap),
        tier=tier["name"],
        ratio_amount_krw=ratio_amount,
        cap_amount_krw=cap,
        citation=spec["citation"],
        rule_id=spec["rule_id"],
    )


def _pick_tier(tiers: list[dict], profile: dict) -> dict | None:
    """위에서부터 조건이 맞는 첫 칸을 고른다.

    **적용 여부를 판단할 값이 없으면 아래 칸으로 내려가지 않는다.** 특례가 걸릴지
    모르는 채로 일반 기준을 쓰면 실제보다 큰 금액을 알려 주게 된다. 신혼 여부를
    모르는 사람에게 일반가구 기준을 적용해 놓고 나중에 신혼으로 밝혀지면, 알려 준
    금액이 틀린 것이 된다.
    """
    for tier in tiers:
        applies, _unknown = applies_to(tier, profile)
        if applies is True:
            return tier
        if applies is None:
            return None
    return None


def _cap_of(tier: dict, profile: dict) -> int | None:
    """이 칸의 금액 상한. 지역으로 갈리는 상품은 지역을 알아야 한다."""
    if "cap_krw" in tier:
        return tier["cap_krw"]
    region = profile.get("region")
    return tier["cap_by_region"].get(region) if region else None

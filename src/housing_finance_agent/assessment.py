"""판정·한도·안내를 한 번에 내는 진입점.

화면과 API가 부를 자리다. 셋을 따로 부르게 하면 **부르는 순서를 지키는 책임이
호출부로 넘어간다.** 조건 불충족인 사람에게 한도를 계산해 주는 실수가 거기서 난다.
여기서 순서를 강제한다.

판정 결과만 주면 사용자는 "그래서 뭘 해야 하나"를 모른다. 다음 행동을 함께 낸다.
다만 **안내 문구를 지어내지 않는다** — 확인 방법이 원문에 적혀 있는 항목에만
붙이고, 없는 항목은 이름만 알려 준다. 없는 창구를 안내하면 판정이 맞아도 쓸모가 없다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from housing_finance_agent.eligibility import (
    CONDITIONAL,
    INSUFFICIENT_INFORMATION,
    NOT_MATCHED,
    Decision,
    evaluate,
)
from housing_finance_agent.limits import LoanLimit, estimate_loan_limit
from housing_finance_agent.profile import enrich


@dataclass(frozen=True, slots=True)
class Assessment:
    decision: Decision
    loan_limit: LoanLimit | None
    next_actions: list[str] = field(default_factory=list)


def assess(program: dict, profile: dict) -> Assessment:
    """신청자 조건 하나를 한 상품에 대고 본다."""
    enriched = enrich(profile)
    decision = evaluate(program, enriched)

    # 탈락한 사람에게 금액을 알려 주지 않는다. 판정이 먼저이고 계산이 나중이다.
    limit = None if decision.status == NOT_MATCHED else estimate_loan_limit(program, enriched)

    return Assessment(
        decision=decision, loan_limit=limit, next_actions=_next_actions(program, decision, limit)
    )


def _next_actions(program: dict, decision: Decision, limit: LoanLimit | None) -> list[str]:
    if decision.status == NOT_MATCHED:
        return _failure_reasons(program, decision.failed_rules)

    if decision.status in (INSUFFICIENT_INFORMATION, CONDITIONAL):
        return [_field_guide(program, name) for name in decision.missing_fields] + [
            _precision_guide(program, name) for name in decision.imprecise_fields
        ]

    # 판정은 됐는데 금액을 못 낸 경우. 사유마다 사용자가 할 일이 다르다.
    if limit is not None and limit.amount_krw is None:
        return [_LIMIT_REASONS.get(limit.reason, "대출 한도를 계산하지 못했습니다")]

    # 금액은 냈지만 더 유리한 구간을 몰라서 건너뛴 경우. 받을 수 있는 것보다 적게
    # 알려 준 상태이므로 그대로 두면 안 된다.
    if limit is not None and limit.skipped_tiers:
        이름 = ", ".join(_TIER_NAMES.get(tier, tier) for tier in limit.skipped_tiers)
        return [f"{이름}에 해당하면 한도가 더 늘어날 수 있습니다"]

    # 사전 조건 부합일 때의 다음 단계는 아직 넣지 않았다. 신청 방법은 취급 은행마다
    # 다른데(비대면 제한 여부, 상환 방식), 규칙 파일은 기금 기준만 담고 있다.
    return []


def _failure_reasons(program: dict, failed_rules: list[str]) -> list[str]:
    by_id = {rule["rule_id"]: rule for rule in program["rules"]}
    reasons = []
    for rule_id in failed_rules:
        rule = by_id[rule_id]
        reason = rule["failure_message"]
        if rule.get("next_action"):
            reason = f"{reason} — {rule['next_action']}"
        reasons.append(reason)
    return reasons


_TIER_NAMES = {
    "newlywed_or_two_children": "신혼 가구 또는 2자녀 이상 가구",
    "under_25_single": "만 25세 미만 단독세대주",
}

_LIMIT_REASONS = {
    "DEPOSIT_UNKNOWN": "대출 한도를 보려면 임차보증금을 알려주세요",
    "DEPOSIT_IMPRECISE": "정확한 대출 한도를 보려면 임차보증금을 정확히 알려주세요",
    "TIER_UNKNOWN": "한도 기준이 갈리는 조건을 아직 알 수 없어 금액을 내지 못했습니다",
    "REGION_UNKNOWN": "지역에 따라 한도가 달라집니다. 주택 소재지를 알려주세요",
    "NOT_REVIEWED": "한도 규칙이 아직 검수되지 않아 금액을 내지 않습니다",
}


def _precision_guide(program: dict, field_name: str) -> str:
    """값은 있는데 기준을 걸치는 경우. 없는 것과 다른 말을 해야 한다."""
    label = _label(program, field_name)
    return f"{label}이 기준에 걸칩니다. 정확한 값을 알려주세요"


def _label(program: dict, field_name: str) -> str:
    guide = (program.get("field_guides") or {}).get(field_name) or {}
    return guide.get("label", field_name)


def _field_guide(program: dict, field_name: str) -> str:
    guide = (program.get("field_guides") or {}).get(field_name) or {}
    label = guide.get("label", field_name)
    need = f"{label} 정보가 필요합니다"
    return f"{need} — {guide['how_to_check']}" if guide.get("how_to_check") else need

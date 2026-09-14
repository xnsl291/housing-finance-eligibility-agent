"""자격 판정 엔진.

여기에는 LLM이 닿지 않는다. 조건 비교를 LLM에 맡기면 왜 그 결과가 나왔는지
추적할 수 없고, 같은 입력에 다른 답이 나온다. 이 시스템의 신뢰가 이 파일에 걸린다.

판정을 통과시키는 것보다 **잘못 통과시키지 않는 것**이 중요하다. 그래서 다음 셋은
전부 통과로 세지 않는다 — 검수되지 않은 규칙, 비교할 값이 없는 규칙, 적용 조건이
맞지 않는 규칙.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date

from housing_finance_agent.amount import Range

_OPERATORS = {
    "gte": lambda actual, expected: actual >= expected,
    "gt": lambda actual, expected: actual > expected,
    "lte": lambda actual, expected: actual <= expected,
    "lt": lambda actual, expected: actual < expected,
    "eq": lambda actual, expected: actual == expected,
    "in": lambda actual, expected: actual in expected,
}

PRECHECK_MATCH = "PRECHECK_MATCH"
# 판정을 확정하려면 추가 확인이 필요한 상태. 지금은 값이 범위로만 알려져 기준을
# 걸치는 경우가 여기로 온다. 기관 심사가 남는 CONDITIONAL 규칙이 생기면 그것도
# 여기로 온다(계획서 §13.5).
CONDITIONAL = "CONDITIONAL"
NOT_MATCHED = "NOT_MATCHED"
INSUFFICIENT_INFORMATION = "INSUFFICIENT_INFORMATION"


@dataclass(frozen=True, slots=True)
class RuleOutcome:
    """규칙 하나가 어떻게 됐는지.

    통과·불충족만 보여 주면 "왜 이 조건은 안 보이나"에 답을 못 한다. 특례에 덮인
    규칙, 적용 대상이 아닌 규칙, 값이 없어 못 본 규칙도 남긴다.
    """

    rule_id: str
    outcome: str  # PASSED | FAILED | SUPERSEDED | NOT_APPLICABLE | MISSING_VALUE
    #             | IMPRECISE | NOT_REVIEWED
    field: str
    citation: str
    failure_message: str


@dataclass(frozen=True, slots=True)
class Decision:
    """판정 결과.

    status에 ELIGIBLE이나 APPROVED 같은 확정 표현을 쓰지 않는다. 실제 심사는
    기관이 하며 이 시스템은 신청 전 가늠만 한다.
    """

    status: str
    passed_rules: list[str] = field(default_factory=list)
    failed_rules: list[str] = field(default_factory=list)
    # 값이 아예 없는 것
    missing_fields: list[str] = field(default_factory=list)
    # 값은 있는데 범위로만 알아서 기준을 걸치는 것. 화면이 다른 말을 해야 한다 —
    # "소득을 알려주세요"가 아니라 "기준에 걸치니 정확한 값을 알려주세요"다.
    imprecise_fields: list[str] = field(default_factory=list)
    # 규칙마다 어떻게 됐는지. 화면 4가 근거를 보여 주는 데 쓴다.
    rule_outcomes: list[RuleOutcome] = field(default_factory=list)


def _has_value(profile: dict, field_name: str) -> bool:
    return field_name in profile and profile[field_name] is not None


def _apply(operator: str, actual: object, expected: object) -> bool | None:
    """값 하나를 기준과 견준다. 판단할 수 없으면 None.

    값이 범위면 세 갈래가 된다. 범위 전체가 기준 안이면 참, 전체가 밖이면 거짓,
    걸치면 모름이다. 같다·포함된다 같은 비교는 범위에 쓸 수 없으므로 모름을 준다 —
    거짓으로 단정하면 잘못 탈락시킨다.
    """
    if isinstance(actual, Range):
        comparer = getattr(actual, f"compare_{operator}", None)
        return comparer(expected) if comparer else None
    return _OPERATORS[operator](actual, expected)


def _check(condition: dict, profile: dict) -> bool | None:
    """조건 하나를 본다. 판단할 값이 없으면 None을 준다.

    None은 "거짓"이 아니라 "모른다"다. 둘을 같게 다루면 모르는 것을 조건 불충족으로
    처리하게 된다.
    """
    field_name = condition["field"]
    if not _has_value(profile, field_name):
        return None
    return _apply(condition["operator"], profile[field_name], condition["value"])


def _applies(rule: dict, profile: dict) -> tuple[bool | None, list[str]]:
    """이 규칙을 적용할 대상인지 본다. (판단, 판단하지 못한 항목)

    `all`은 전부 맞아야 하고 `any`는 하나만 맞아도 된다. 소득 특례처럼 대상이
    여러 갈래인 조건에 `any`가 쓰인다.
    """
    condition = rule.get("applies_when")
    if condition is None:
        return True, []

    if "any" in condition:
        results = [(_check(one, profile), one["field"]) for one in condition["any"]]
        # 하나라도 확실히 참이면 나머지를 몰라도 적용 대상이다.
        if any(result is True for result, _ in results):
            return True, []
        unknown = [field_name for result, field_name in results if result is None]
        return (None, unknown) if unknown else (False, [])

    conditions = condition.get("all", [condition])
    results = [(_check(one, profile), one["field"]) for one in conditions]

    # 하나라도 확실히 거짓이면 나머지를 몰라도 적용 대상이 아니다.
    if any(result is False for result, _ in results):
        return False, []
    unknown = [field_name for result, field_name in results if result is None]
    if unknown:
        return None, unknown
    return True, []


def applies_to(spec: dict, profile: dict) -> tuple[bool | None, list[str]]:
    """적용 대상인지 판단한다. 판정 규칙 밖에서도 같은 조건 문법을 쓰려고 열어 둔다.

    한도 계산의 구간 선택이 이것을 쓴다. 조건을 해석하는 방식이 두 벌이 되면
    "모르면 적용하지 않는다"는 원칙이 한쪽에서만 지켜질 수 있다.
    """
    return _applies(spec, profile)


def _add_months(base: date, months: int) -> date:
    """달을 더한다. 더한 달에 그 날짜가 없으면 그 달의 마지막 날로 맞춘다.

    1월 31일에 한 달을 더하면 2월 31일이 없다. 신청 기한을 다루는 자리라
    없는 날짜를 다음 달로 넘기면 기한이 하루 늘어난다.
    """
    month_index = base.month - 1 + months
    year = base.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, min(base.day, calendar.monthrange(year, month)[1]))


def _required_fields(rule: dict) -> list[str]:
    """이 규칙을 판정하려면 프로필에 있어야 하는 항목."""
    reference = rule.get("reference")
    return [rule["field"], *reference["fields"]] if reference else [rule["field"]]


def _compare(rule: dict, profile: dict) -> bool | None:
    """규칙 하나를 프로필에 대고 본다. 값이 범위여서 판단할 수 없으면 None."""
    if rule["operator"] != "within_months_after":
        return _apply(rule["operator"], profile[rule["field"]], rule["value"])

    # 기준 날짜가 둘 이상이고 어느 쪽을 쓰는지가 상품마다 다르다. 버팀목은 빠른 날,
    # HUG는 늦은 날이다. 같은 두 날짜에서 결과가 갈리므로 mode를 규칙에 적어 둔다.
    reference = rule["reference"]
    dates = [date.fromisoformat(profile[name]) for name in reference["fields"]]
    base = min(dates) if reference["mode"] == "earliest" else max(dates)
    return date.fromisoformat(profile[rule["field"]]) <= _add_months(base, rule["value"])


def evaluate(program: dict, profile: dict) -> Decision:
    """규칙과 신청자 조건을 대조해 판정한다.

    결과는 셋 중 하나다. 확인된 불충족이 하나라도 있으면 조건 불충족,
    불충족은 없는데 비교하지 못한 규칙이 있으면 정보 부족, 나머지가 사전 조건 부합이다.

    불충족이 정보 부족보다 앞서는 이유는 이미 확인된 탈락 사유가 있으면 더 물어볼
    이유가 없기 때문이다.
    """
    reviewed = [rule for rule in program["rules"] if rule.get("human_reviewed")]

    missing: list[str] = []
    imprecise: list[str] = []

    def remember_unknown(field_names: list[str]) -> None:
        """판단하지 못한 항목을 적어 둔다.

        값이 아예 없는 것과 범위로만 알아 걸치는 것을 나눈다. 화면이 물어보는 말이
        달라야 한다 — 전자는 "알려주세요", 후자는 "더 정확히 알려주세요"다.
        """
        for field_name in field_names:
            target = imprecise if _has_value(profile, field_name) else missing
            if field_name not in target:
                target.append(field_name)

    # 특례가 일반 규칙을 덮는지 먼저 정한다. 적용 여부를 모르는 특례도 덮는 것으로
    # 본다 — 특례가 걸릴지 모르는 채로 일반 기준을 적용하면, 통과시켜서는 안 될 것을
    # 통과시킨다. 나이를 모르는 만 24세 단독세대주가 85㎡ 기준으로 통과하는 경우다.
    applicability: dict[str, bool | None] = {}
    suppressed: set[str] = set()
    # 푸는 특례의 적용 여부를 모를 때, 그 특례가 덮는 일반 규칙이 실제로 걸리면
    # 그때 가서 묻는다. {일반 규칙 id: 물어야 할 항목}
    보류된_특례: dict[str, list[str]] = {}

    for rule in reviewed:
        applies, unknown = _applies(rule, profile)
        rule_id = rule["rule_id"]
        applicability[rule_id] = applies

        # 특례에는 두 방향이 있다. 기준을 조이는 특례(전용면적 85→60)는 적용 여부를
        # 모르면 일반 규칙까지 덮어야 한다 — 안 덮으면 잘못 통과시킨다. 반대로
        # 기준을 푸는 특례(소득 5천→6천, 나이 34→39)는 건너뛰는 쪽이 더 엄격하므로
        # 몰라도 그냥 넘어가면 된다.
        #
        # 방향을 구분하지 않으면 드문 특례 때문에 모두에게 묻게 된다. 실물 확인에서
        # 물어보는 항목이 12개까지 늘었다(2026-09-14).
        if applies is None and rule.get("relaxes"):
            for target in rule.get("overrides") or []:
                보류된_특례.setdefault(target, []).extend(unknown)
            continue

        if unknown:
            remember_unknown(unknown)
        if applies is not False:
            suppressed.update(rule.get("overrides") or [])

    passed: list[str] = []
    failed: list[str] = []
    outcomes: list[RuleOutcome] = []
    evaluated = 0

    def 남김(rule: dict, label: str) -> None:
        outcomes.append(
            RuleOutcome(
                rule_id=rule["rule_id"],
                outcome=label,
                field=rule["field"],
                citation=rule.get("citation", ""),
                failure_message=rule.get("failure_message", ""),
            )
        )

    for rule in program["rules"]:
        rule_id = rule["rule_id"]

        if not rule.get("human_reviewed"):
            # 판정에 쓰지 않지만 몇 건이 빠졌는지는 보여 줘야 한다.
            남김(rule, "NOT_REVIEWED")
            continue
        if rule_id in suppressed:
            남김(rule, "SUPERSEDED")
            continue
        if applicability[rule_id] is False:
            남김(rule, "NOT_APPLICABLE")
            continue
        if applicability[rule_id] is None:
            # 적용 대상인지조차 판단하지 못했다.
            남김(rule, "MISSING_VALUE")
            continue

        absent = [name for name in _required_fields(rule) if not _has_value(profile, name)]
        if absent:
            remember_unknown(absent)
            남김(rule, "MISSING_VALUE")
            continue

        outcome = _compare(rule, profile)
        if outcome is None:
            # 값은 있는데 범위로만 알아서 기준을 걸친다. 통과로도 탈락으로도 세지 않는다.
            remember_unknown([rule["field"]])
            남김(rule, "IMPRECISE")
            continue

        evaluated += 1
        if outcome:
            passed.append(rule_id)
            남김(rule, "PASSED")
        else:
            failed.append(rule_id)
            남김(rule, "FAILED")

    # 푸는 특례를 건너뛰었는데 일반 규칙이 걸렸다면, 특례에 해당하면 통과할 수도
    # 있다. 여기서만 특례 조건을 묻는다. 통과했으면 묻지 않는다.
    for rule_id in list(failed):
        if rule_id in 보류된_특례:
            failed.remove(rule_id)
            remember_unknown(보류된_특례[rule_id])
            outcomes = [
                RuleOutcome(
                    rule_id=item.rule_id,
                    outcome="MISSING_VALUE" if item.rule_id == rule_id else item.outcome,
                    field=item.field,
                    citation=item.citation,
                    failure_message=item.failure_message,
                )
                for item in outcomes
            ]

    if failed:
        status = NOT_MATCHED
    elif missing:
        # 값이 아예 없는 것이 먼저다. 정밀도를 묻기 전에 없는 값부터 받아야 한다.
        status = INSUFFICIENT_INFORMATION
    elif imprecise:
        # 값은 있는데 기준을 걸친다. 사용자는 이미 말했고 정밀도만 모자라므로
        # 화면이 다른 말을 해야 한다.
        status = CONDITIONAL
    elif evaluated == 0:
        # 비교한 규칙이 하나도 없으면 통과라고 말할 수 없다. 검수된 규칙이 없거나
        # 전부 적용 대상이 아닌 경우가 여기로 온다.
        status = INSUFFICIENT_INFORMATION
    else:
        status = PRECHECK_MATCH

    return Decision(
        status=status,
        passed_rules=passed,
        failed_rules=failed,
        missing_fields=missing,
        imprecise_fields=imprecise,
        rule_outcomes=outcomes,
    )

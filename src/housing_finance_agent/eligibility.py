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

_OPERATORS = {
    "gte": lambda actual, expected: actual >= expected,
    "gt": lambda actual, expected: actual > expected,
    "lte": lambda actual, expected: actual <= expected,
    "lt": lambda actual, expected: actual < expected,
    "eq": lambda actual, expected: actual == expected,
    "in": lambda actual, expected: actual in expected,
}

PRECHECK_MATCH = "PRECHECK_MATCH"
NOT_MATCHED = "NOT_MATCHED"
INSUFFICIENT_INFORMATION = "INSUFFICIENT_INFORMATION"


@dataclass(frozen=True, slots=True)
class Decision:
    """판정 결과.

    status에 ELIGIBLE이나 APPROVED 같은 확정 표현을 쓰지 않는다. 실제 심사는
    기관이 하며 이 시스템은 신청 전 가늠만 한다.
    """

    status: str
    passed_rules: list[str] = field(default_factory=list)
    failed_rules: list[str] = field(default_factory=list)
    missing_fields: list[str] = field(default_factory=list)


def _has_value(profile: dict, field_name: str) -> bool:
    return field_name in profile and profile[field_name] is not None


def _check(condition: dict, profile: dict) -> bool | None:
    """조건 하나를 본다. 판단할 값이 없으면 None을 준다.

    None은 "거짓"이 아니라 "모른다"다. 둘을 같게 다루면 모르는 것을 조건 불충족으로
    처리하게 된다.
    """
    field_name = condition["field"]
    if not _has_value(profile, field_name):
        return None
    return _OPERATORS[condition["operator"]](profile[field_name], condition["value"])


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


def _compare(rule: dict, profile: dict) -> bool:
    """규칙 하나를 프로필에 대고 본다."""
    if rule["operator"] != "within_months_after":
        return _OPERATORS[rule["operator"]](profile[rule["field"]], rule["value"])

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

    def remember_missing(field_names: list[str]) -> None:
        for field_name in field_names:
            if field_name not in missing:
                missing.append(field_name)

    # 특례가 일반 규칙을 덮는지 먼저 정한다. 적용 여부를 모르는 특례도 덮는 것으로
    # 본다 — 특례가 걸릴지 모르는 채로 일반 기준을 적용하면, 통과시켜서는 안 될 것을
    # 통과시킨다. 나이를 모르는 만 24세 단독세대주가 85㎡ 기준으로 통과하는 경우다.
    applicability: dict[str, bool | None] = {}
    suppressed: set[str] = set()
    for rule in reviewed:
        applies, unknown = _applies(rule, profile)
        applicability[rule["rule_id"]] = applies
        if unknown:
            remember_missing(unknown)
        if applies is not False:
            suppressed.update(rule.get("overrides") or [])

    passed: list[str] = []
    failed: list[str] = []
    evaluated = 0

    for rule in reviewed:
        rule_id = rule["rule_id"]
        if rule_id in suppressed or applicability[rule_id] is not True:
            continue

        absent = [name for name in _required_fields(rule) if not _has_value(profile, name)]
        if absent:
            remember_missing(absent)
            continue

        evaluated += 1
        if _compare(rule, profile):
            passed.append(rule_id)
        else:
            failed.append(rule_id)

    if failed:
        status = NOT_MATCHED
    elif missing or evaluated == 0:
        # 비교한 규칙이 하나도 없으면 통과라고 말할 수 없다. 검수된 규칙이 없거나
        # 전부 적용 대상이 아닌 경우가 여기로 온다.
        status = INSUFFICIENT_INFORMATION
    else:
        status = PRECHECK_MATCH

    return Decision(
        status=status, passed_rules=passed, failed_rules=failed, missing_fields=missing
    )

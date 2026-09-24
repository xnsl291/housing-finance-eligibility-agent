"""다음에 무엇을 할지 — 하나를 더 물을지, 이제 결과를 낼지.

이 시스템을 Agent로 만드는 자리다(D-27). 상태를 보고 다음 행동을 정하고, 종료
조건까지 반복한다. **정책은 전부 여기 코드에 있고 LLM은 닿지 않는다.** 같은 상태에는
같은 질문이 나온다.

지금까지는 모르는 항목을 **전부** 나열했다. 문장 하나를 넣으면 10개가 한꺼번에 나왔다.
"남은 항목이 있다"와 "물어볼 값어치가 있다"는 다르다. 여기서 그 차이를 가른다.

**질문 순위를 규칙 파일(YAML)에 두지 않는다.** 규칙 파일은 원문 인용이 붙는 조건만
담는다. 질문 순서는 인용할 원문이 없는 이 시스템의 정책이고, 판정 결과를 입력으로
받아야 계산된다.

**질문은 제안이고 강제가 아니다.** 사용자가 모른다고 한 항목은 다시 묻지 않는다.
답을 받아야만 진행되는 루프는 모르는 것을 찍게 만든다.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Iterable
from dataclasses import dataclass

from housing_finance_agent import fields
from housing_finance_agent.assessment import assess
from housing_finance_agent.eligibility import NOT_MATCHED
from housing_finance_agent.profile import DERIVED_FROM

# 정책이 바뀌면 올린다. 판정 기록에 함께 남겨, 옛 세션을 다시 돌렸을 때 질문이
# 달라지면 정책이 바뀐 탓인지 알 수 있게 한다.
POLICY_VERSION = 1

ASK = "ASK"
RESULT = "RESULT"

# 결과를 내는 이유. 화면이 다른 말을 해야 한다 — "더 물을 게 없다"와 "남은 것을
# 사용자가 모른다고 했다"는 결과의 확실성이 다르다(D-27 다시 볼 시점).
ALL_NOT_MATCHED = "ALL_NOT_MATCHED"
COMPLETE = "COMPLETE"
ONLY_DECLINED_LEFT = "ONLY_DECLINED_LEFT"

# 값이 아예 없는 것과 범위로만 알아 기준에 걸치는 것. 묻는 말이 다르다.
MISSING = "MISSING"
IMPRECISE = "IMPRECISE"

_TENURE_FIELD = "intended_tenure"


@dataclass(frozen=True, slots=True)
class NextAction:
    action: str  # ASK | RESULT
    # ASK일 때
    field: str | None = None
    ask_kind: str | None = None  # MISSING | IMPRECISE
    why: str | None = None
    # 이 값이 있어야 판정이 진행되는 상품
    needed_by: list[str] = dataclasses.field(default_factory=list)
    # RESULT일 때
    reason: str | None = None
    # 판정이 끝나지 않았는데 사용자가 모른다고 해서 묻지 않은 항목
    declined_needed: list[str] = dataclasses.field(default_factory=list)
    # 전세/매매로 거른 뒤 남은 상품
    candidates: list[str] = dataclasses.field(default_factory=list)
    policy_version: int = POLICY_VERSION


@dataclass(frozen=True, slots=True)
class _Need:
    field: str
    ask_kind: str
    needed_by: list[str]


def next_action(
    programs: dict[str, dict], profile: dict, declined: Iterable[str] = ()
) -> NextAction:
    """지금 상태에서 다음 행동 하나를 정한다.

    `programs`는 {상품 id: 규칙}이다. `declined`는 사용자가 모른다고 한 항목이다.
    """
    declined = set(declined)
    candidates = _candidates(programs, profile)
    # 상품 id 순으로 돌린다. dict 순서에 기대면 같은 상태에서 다른 질문이 나올 수 있다.
    statuses = {pid: assess(programs[pid], profile).decision for pid in sorted(candidates)}
    open_ids = [pid for pid, decision in statuses.items() if decision.status != NOT_MATCHED]

    if not open_ids:
        return NextAction(action=RESULT, reason=ALL_NOT_MATCHED, candidates=sorted(candidates))

    # 1순위. 전세인지 매매인지를 모르면 그것부터 묻는다. 이 값 하나로 볼 상품이
    # 갈린다. 정보 이득을 계산하지 않는다 — 상품의 `tenure` 한 줄로 집합이 갈리므로
    # 계산이 아니라 구조로 얻는다.
    tenures = {programs[pid]["program"].get("tenure") for pid in open_ids}
    if len(tenures) > 1 and _TENURE_FIELD not in profile and _TENURE_FIELD not in declined:
        return NextAction(
            action=ASK,
            field=_TENURE_FIELD,
            ask_kind=MISSING,
            why="전세를 구하는지 집을 사는지에 따라 볼 상품이 갈립니다",
            needed_by=open_ids,
            candidates=sorted(candidates),
        )

    needs = _needs({pid: statuses[pid] for pid in open_ids}, profile)
    askable = [need for need in needs if need.field not in declined]

    if not askable:
        declined_needed = sorted(need.field for need in needs)
        return NextAction(
            action=RESULT,
            reason=ONLY_DECLINED_LEFT if declined_needed else COMPLETE,
            declined_needed=declined_needed,
            candidates=sorted(candidates),
        )

    best = min(askable, key=_rank)
    return NextAction(
        action=ASK,
        field=best.field,
        ask_kind=best.ask_kind,
        why=_why(best, programs, len(open_ids)),
        needed_by=best.needed_by,
        candidates=sorted(candidates),
    )


def _candidates(programs: dict[str, dict], profile: dict) -> list[str]:
    """전세/매매를 알면 그쪽 상품만 남긴다. 모르면 전부다."""
    tenure = profile.get(_TENURE_FIELD)
    if tenure is None:
        return list(programs)
    return [pid for pid, program in programs.items() if program["program"].get("tenure") == tenure]


def _needs(decisions: dict, profile: dict) -> list[_Need]:
    """판정이 끝나지 않은 상품들이 무엇을 모르는지 모은다.

    **"물어도 결과가 안 바뀌는" 항목은 여기서 자연히 빠진다.** 엔진이 이미 조건
    불충족인 상품, 특례로 덮인 규칙, 적용 대상이 아닌 규칙의 항목은 모르는 항목으로
    내지 않는다. 그래서 여기 남는 것은 판정을 진행시키는 항목뿐이다.
    """
    by_field: dict[str, _Need] = {}
    for pid, decision in decisions.items():
        모르는_것 = ((MISSING, decision.missing_fields), (IMPRECISE, decision.imprecise_fields))
        for ask_kind, names in 모르는_것:
            for name in names:
                source = _askable_source(name, profile)
                if source is None:
                    continue
                need = by_field.get(source)
                if need is None:
                    by_field[source] = _Need(source, ask_kind, [pid])
                elif pid not in need.needed_by:
                    need.needed_by.append(pid)
    return list(by_field.values())


def _askable_source(name: str, profile: dict) -> str | None:
    """사용자에게 물을 수 있는 항목으로 바꾼다.

    파생 항목은 원래 항목 중 아직 모르는 것을 묻는다. 원래 항목을 다 아는데도 파생
    항목이 없다면 물어서 풀 수 있는 것이 아니므로 None을 준다.
    """
    if name in fields.SPEC:
        return name
    for source in DERIVED_FROM.get(name, ()):
        if profile.get(source) is None:
            return source
    return None


_FIELD_ORDER = {name: index for index, name in enumerate(fields.SPEC)}

# 답하는 데 드는 수고. 세대주인지·무주택인지는 고르기만 하면 되지만, 순자산이나
# 전용면적은 서류를 찾아봐야 한다. 항목 종류로 정한다 — 항목마다 점수를 매기면
# 그 점수의 근거를 또 설명해야 한다.
#
# `how_to_check`가 있는 항목을 쉬운 것으로 보지 않는다. 확인 방법이 적혀 있는 항목은
# 순자산·전용면적·주택가격처럼 **찾아봐야 답할 수 있는 것**이라 오히려 어렵다.
_EFFORT = {"CHOICE": 0, "BOOL": 0, "INT": 1, "TEXT": 2, "FLOAT": 3, "AMOUNT": 3}


def _rank(need: _Need) -> tuple:
    """작을수록 먼저 묻는다.

    1. 더 많은 상품이 기다리는 항목. 세 상품 모두 묻는 무주택 여부가 한 상품만 묻는
       잔금일보다 앞선다
    2. 없는 값이 걸치는 값보다 앞선다. 판정 엔진과 같은 순서다
    3. 답하기 쉬운 항목. 고르면 되는 것이 서류를 찾아야 하는 것보다 앞선다
    4. 항목 정의 순서. 앞의 셋이 같아도 늘 같은 질문이 나오게 한다
    """
    return (
        -len(need.needed_by),
        0 if need.ask_kind == MISSING else 1,
        _EFFORT[fields.kind_of(need.field)],
        _FIELD_ORDER[need.field],
    )


def _why(need: _Need, programs: dict[str, dict], open_count: int) -> str:
    이름 = ", ".join(programs[pid]["program"]["program_name"] for pid in need.needed_by)
    if need.ask_kind == IMPRECISE:
        return f"알려주신 값이 기준에 걸쳐 판정이 갈립니다 ({이름})"
    if len(need.needed_by) == open_count and open_count > 1:
        return f"남은 상품 {open_count}개 모두 이 값이 있어야 판정할 수 있습니다"
    return f"이 값이 있어야 판정할 수 있습니다 ({이름})"

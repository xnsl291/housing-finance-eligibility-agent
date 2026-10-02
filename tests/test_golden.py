"""골든 시나리오를 실제 규칙으로 돌린다.

시나리오는 `golden/*.yaml`에 데이터로 둔다. 규칙과 같은 방식이라 사람이 표로
검수할 수 있고, 케이스를 더할 때 이 파일을 고치지 않는다.

**통과 개수는 증거가 아니다.** 규칙을 잘못 읽었으면 기대 답도 똑같이 잘못 적힌다.
그래서 두 가지를 함께 한다.

1. 규칙 값을 공식 페이지와 은행 상품안내 두 곳에서 대조했다(검수표 v2)
2. 규칙을 일부러 틀리게 바꿨을 때 이 시나리오가 죽는지 확인한다

시나리오가 깨지면 그 케이스의 `왜`를 읽으면 무엇이 무너졌는지 알 수 있다.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from housing_finance_agent.amount import Range
from housing_finance_agent.assessment import assess
from housing_finance_agent.rules import load_program

_GOLDEN_DIR = Path(__file__).resolve().parents[1] / "golden"


def _cases() -> list[tuple[str, dict, dict, dict]]:
    """(시나리오 이름, 상품 id, 프로필, 기대) 목록으로 편다."""
    cases = []
    for path in sorted(_GOLDEN_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        for scenario in data["scenarios"]:
            # YAML에 null로 적은 항목은 "모른다"는 뜻이다. 판정 엔진도 None을 같은 뜻으로
            # 읽으므로(eligibility._has_value) 여기서 키를 지우는 층을 따로 두지 않는다.
            # 2026-09-16 변형 시험에서 그 층을 지워도 212건이 전부 통과해 없앴다.
            profile = {**data["base"], **(scenario["profile"] or {})}
            cases.append((scenario["name"], path.stem, profile, scenario["expect"]))
    return cases


def _as_value(given: object) -> object:
    """범위는 `{low, high}`로 적는다. 판정이 쓰는 모양으로 되돌린다."""
    if isinstance(given, dict) and {"low", "high"} <= given.keys():
        return Range(int(given["low"]), int(given["high"]))
    return given


@pytest.mark.parametrize(
    ("name", "program_id", "profile", "expect"),
    _cases(),
    ids=[case[0] for case in _cases()],
)
def test_골든_시나리오(name: str, program_id: str, profile: dict, expect: dict) -> None:
    프로필 = {key: _as_value(value) for key, value in profile.items()}
    result = assess(load_program(program_id), 프로필)
    decision = result.decision

    assert decision.status == expect["status"], f"{name}: 판정이 다름"

    if "failed_rules" in expect:
        assert decision.failed_rules == expect["failed_rules"], f"{name}: 불충족 규칙이 다름"

    if "missing_fields" in expect:
        assert decision.missing_fields == expect["missing_fields"], f"{name}: 모르는 항목이 다름"

    if "imprecise_fields" in expect:
        assert decision.imprecise_fields == expect["imprecise_fields"], f"{name}: 걸친 항목이 다름"

    if "superseded_rules" in expect:
        # 특례가 일반 규칙을 덮었는지. **판정 상태만 보면 안 잡히는 자리다** —
        # 덮든 안 덮든 결과가 같은 경우가 있는데, 화면 4가 "통과"로 보여 주느냐
        # "특례로 대체됨"으로 보여 주느냐가 달라진다. 전자는 사용자가 그 기준을
        # 통과했다고 읽는데 실제로는 더 엄격한 기준이 걸린다.
        덮인 = [item.rule_id for item in decision.rule_outcomes if item.outcome == "SUPERSEDED"]
        assert 덮인 == expect["superseded_rules"], f"{name}: 특례로 대체된 규칙이 다름"

    if "limit_reason" in expect:
        # 금액을 못 낸 사유. 사유마다 사용자가 할 일이 다르고, **무엇보다 "몰라서
        # 안 냈다"와 "계산해서 이 금액이다"를 구분해야 한다.**
        assert result.loan_limit is not None, f"{name}: 한도 객체가 없음"
        사유 = result.loan_limit.reason
        assert 사유 == expect["limit_reason"], f"{name}: 한도 미산출 사유가 다름"

    if "loan_amount_krw" in expect:
        assert result.loan_limit is not None, f"{name}: 한도를 내지 못함"
        assert result.loan_limit.amount_krw == expect["loan_amount_krw"], f"{name}: 한도가 다름"

    if "next_action_contains" in expect:
        조각 = expect["next_action_contains"]
        assert any(조각 in action for action in result.next_actions), f"{name}: 안내에 {조각} 없음"


def test_시나리오가_충분히_있다() -> None:
    """계획서 §16은 상품마다 통과 2·실패 2·정보부족 1·경계 1을 요구한다."""
    상품별 = {}
    for _, program_id, _, _ in _cases():
        상품별[program_id] = 상품별.get(program_id, 0) + 1

    assert len(상품별) == 3, "상품이 늘거나 줄었다. 골든 파일이 빠졌는지 확인할 것"
    assert all(count >= 6 for count in 상품별.values())


def test_시나리오마다_왜를_적어_두었다() -> None:
    """깨졌을 때 무엇이 무너졌는지 알 수 있어야 한다. 이름만으로는 부족하다."""
    for path in sorted(_GOLDEN_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        for scenario in data["scenarios"]:
            assert scenario.get("왜"), f"{path.stem}: {scenario['name']}에 왜가 없음"

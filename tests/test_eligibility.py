"""자격 판정 엔진 테스트.

이 엔진의 계약은 하나다 — **확인된 규칙만 판정에 쓴다.** 검수되지 않은 규칙,
적용 조건이 맞지 않는 규칙, 값이 없어 비교할 수 없는 규칙은 통과로 치지 않는다.

판정을 통과시키는 것보다 잘못 통과시키지 않는 것이 중요하다. 대출·보증에서
"된다"는 틀린 답은 사용자가 시간과 비용을 잃게 만든다.
"""

from __future__ import annotations

from housing_finance_agent.eligibility import evaluate


def _program(rules: list[dict]) -> dict:
    return {"program": {"program_id": "test-program"}, "rules": rules}


def _rule(rule_id: str, field_name: str, operator: str, value: object, **extra: object) -> dict:
    rule = {
        "rule_id": rule_id,
        "field": field_name,
        "operator": operator,
        "value": value,
        "type": "HARD",
        "human_reviewed": True,
        "failure_message": f"{rule_id} 불충족",
    }
    rule.update(extra)
    return rule


def test_검수된_규칙을_전부_통과하면_사전_조건_부합이다() -> None:
    program = _program([_rule("T-01", "age", "gte", 19)])

    decision = evaluate(program, {"age": 30})

    assert decision.status == "PRECHECK_MATCH"
    assert decision.passed_rules == ["T-01"]
    assert decision.failed_rules == []


def test_하드_규칙을_하나라도_못_넘기면_조건_불충족이다() -> None:
    program = _program([_rule("T-01", "age", "gte", 19), _rule("T-02", "age", "lte", 34)])

    decision = evaluate(program, {"age": 35})

    assert decision.status == "NOT_MATCHED"
    assert decision.failed_rules == ["T-02"]


def test_비교할_값이_프로필에_없으면_정보_부족이다() -> None:
    """값이 없는 것을 통과로 치면 안 된다. 모르는 것과 충족한 것은 다르다."""
    program = _program([_rule("T-01", "age", "gte", 19)])

    decision = evaluate(program, {})

    assert decision.status == "INSUFFICIENT_INFORMATION"
    assert decision.missing_fields == ["age"]
    assert decision.passed_rules == []


def test_검수되지_않은_규칙은_판정에_쓰지_않는다() -> None:
    """LLM이 문서에서 뽑았을 뿐 사람이 원문과 대조하지 않은 규칙이다.

    통과로도 불통과로도 세지 않는다. 판정할 수 있는 규칙이 하나도 없으므로
    결과는 정보 부족이다.
    """
    program = _program([_rule("T-01", "age", "gte", 19, human_reviewed=False)])

    decision = evaluate(program, {"age": 30})

    assert decision.status == "INSUFFICIENT_INFORMATION"
    assert decision.passed_rules == []
    assert decision.failed_rules == []


def test_불충족과_정보_부족이_함께면_조건_불충족이_먼저다() -> None:
    """이미 확인된 탈락 사유가 있으면 더 물어볼 이유가 없다."""
    program = _program(
        [_rule("T-01", "age", "lte", 34), _rule("T-02", "net_asset_krw", "lte", 345000000)]
    )

    decision = evaluate(program, {"age": 35})

    assert decision.status == "NOT_MATCHED"
    assert decision.failed_rules == ["T-01"]
    assert decision.missing_fields == ["net_asset_krw"]


# --- 적용 조건과 특례 ---
#
# 실제 규칙에서 나오는 모양이다. 전용면적은 85㎡가 일반이고 만 25세 미만
# 단독세대주는 60㎡이며, 보증금 상한은 수도권과 수도권 외로 갈린다.


def test_적용_조건이_맞지_않으면_그_규칙은_건너뛴다() -> None:
    program = _program(
        [
            _rule(
                "T-01",
                "lease_deposit_krw",
                "lte",
                200000000,
                applies_when={"field": "region", "operator": "eq", "value": "NON_CAPITAL_AREA"},
            ),
            _rule("T-02", "age", "gte", 19),
        ]
    )

    profile = {"region": "CAPITAL_AREA", "lease_deposit_krw": 250000000, "age": 30}

    decision = evaluate(program, profile)

    assert decision.status == "PRECHECK_MATCH"
    assert decision.passed_rules == ["T-02"]
    assert decision.failed_rules == []


def test_적용_조건이_맞으면_그_규칙을_적용한다() -> None:
    program = _program(
        [
            _rule(
                "T-01",
                "lease_deposit_krw",
                "lte",
                200000000,
                applies_when={"field": "region", "operator": "eq", "value": "NON_CAPITAL_AREA"},
            )
        ]
    )

    decision = evaluate(
        program, {"region": "NON_CAPITAL_AREA", "lease_deposit_krw": 250000000}
    )

    assert decision.status == "NOT_MATCHED"
    assert decision.failed_rules == ["T-01"]


def test_적용_조건을_판단할_값이_없으면_그_규칙을_적용하지_않는다() -> None:
    """지역을 모르는데 한쪽 기준을 임의로 적용하면 틀린 판정이 나온다.

    모른다는 사실을 결과에 담아야 화면이 그 값을 물어볼 수 있다.
    """
    program = _program(
        [
            _rule(
                "T-01",
                "lease_deposit_krw",
                "lte",
                200000000,
                applies_when={"field": "region", "operator": "eq", "value": "NON_CAPITAL_AREA"},
            )
        ]
    )

    decision = evaluate(program, {"lease_deposit_krw": 250000000})

    assert decision.status == "INSUFFICIENT_INFORMATION"
    assert decision.missing_fields == ["region"]
    assert decision.failed_rules == []


def test_특례가_적용되면_일반_규칙은_건너뛴다() -> None:
    """만 25세 미만 단독세대주는 60㎡ 기준이 85㎡ 기준을 대신한다."""
    program = _program(
        [
            _rule("T-09", "housing_area_m2", "lte", 85),
            _rule(
                "T-10",
                "housing_area_m2",
                "lte",
                60,
                applies_when={
                    "all": [
                        {"field": "age", "operator": "lt", "value": 25},
                        {"field": "household_type", "operator": "eq", "value": "SINGLE"},
                    ]
                },
                overrides=["T-09"],
            ),
        ]
    )

    decision = evaluate(
        program, {"age": 23, "household_type": "SINGLE", "housing_area_m2": 70}
    )

    assert decision.status == "NOT_MATCHED"
    assert decision.failed_rules == ["T-10"]
    assert decision.passed_rules == []


def test_특례_조건이_맞지_않으면_일반_규칙이_그대로_적용된다() -> None:
    program = _program(
        [
            _rule("T-09", "housing_area_m2", "lte", 85),
            _rule(
                "T-10",
                "housing_area_m2",
                "lte",
                60,
                applies_when={
                    "all": [
                        {"field": "age", "operator": "lt", "value": 25},
                        {"field": "household_type", "operator": "eq", "value": "SINGLE"},
                    ]
                },
                overrides=["T-09"],
            ),
        ]
    )

    decision = evaluate(
        program, {"age": 30, "household_type": "SINGLE", "housing_area_m2": 70}
    )

    assert decision.status == "PRECHECK_MATCH"
    assert decision.passed_rules == ["T-09"]


def test_특례_적용_여부를_모르면_일반_규칙도_적용하지_않는다() -> None:
    """특례가 걸릴지 모르는 채로 일반 기준을 적용하면 통과시켜서는 안 될 것을
    통과시킨다. 나이를 모르면 85㎡ 기준으로 통과시켜 놓고, 나중에 만 24세로
    밝혀지면 실제로는 60㎡ 기준에서 탈락하는 경우가 그것이다."""
    program = _program(
        [
            _rule("T-09", "housing_area_m2", "lte", 85),
            _rule(
                "T-10",
                "housing_area_m2",
                "lte",
                60,
                applies_when={
                    "all": [
                        {"field": "age", "operator": "lt", "value": 25},
                        {"field": "household_type", "operator": "eq", "value": "SINGLE"},
                    ]
                },
                overrides=["T-09"],
            ),
        ]
    )

    decision = evaluate(program, {"household_type": "SINGLE", "housing_area_m2": 70})

    assert decision.status == "INSUFFICIENT_INFORMATION"
    assert decision.missing_fields == ["age"]
    assert decision.passed_rules == []

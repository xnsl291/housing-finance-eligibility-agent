"""추출 평가셋이 지금 항목을 다 덮는지 본다. **LLM을 부르지 않는다.**

이 파일을 둔 이유가 하나다. 2026-10-02에 환각률이 4.5%에서 16.0%로 올라간 것으로
보였는데, 모델이 나빠진 게 아니라 **라벨이 낡은 것**이었다. #18이 `intended_tenure`를
만들었고 라벨 24건은 그보다 앞서 작성돼 있어서, `"전셋집을 구하고 있습니다"`에서
`JEONSE`를 맞게 뽑아도 기대 답에 없으니 환각으로 세어졌다. 6건이 그것이었다.

**측정이 조용히 낡는 것이 측정이 없는 것보다 나쁘다.** 수치가 있으니 믿게 된다.
그래서 항목이 하나 늘면 여기서 걸리게 해 둔다 — 라벨을 더하든, 안 재기로 정하고
`uncovered_fields`에 이유를 적든, 어느 쪽이든 **사람이 한 번 보게** 만든다.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from housing_finance_agent import fields

_CASES = Path(__file__).resolve().parents[1] / "evaluation/extraction/cases.yaml"


@pytest.fixture(scope="module")
def 평가셋() -> dict:
    return yaml.safe_load(_CASES.read_text(encoding="utf-8"))


def test_모든_항목이_라벨에_있거나_안_재는_이유가_적혀_있다(평가셋: dict) -> None:
    덮은 = {name for case in 평가셋["cases"] for name in (case.get("expect") or {})}
    안_재는 = set(평가셋.get("uncovered_fields") or {})

    빠진 = sorted(set(fields.SPEC) - 덮은 - 안_재는)

    assert not 빠진, (
        f"항목이 늘었는데 평가셋이 따라가지 않았습니다: {빠진}\n"
        "사례를 더하거나, 안 재기로 정했으면 cases.yaml의 uncovered_fields에 이유를 적으세요."
    )


def test_안_재는_항목에는_이유가_적혀_있다(평가셋: dict) -> None:
    """이유 없이 이름만 적으면 장치가 무의미해진다."""
    적힌 = (평가셋.get("uncovered_fields") or {}).items()
    이유_없음 = [name for name, 이유 in 적힌 if not str(이유).strip()]

    assert not 이유_없음, f"안 재는 이유가 비어 있습니다: {이유_없음}"


def test_라벨에_없는_항목_이름을_쓰지_않았다(평가셋: dict) -> None:
    """항목 이름을 바꾸면 라벨이 조용히 아무것도 재지 않게 된다."""
    쓰인 = {name for case in 평가셋["cases"] for name in (case.get("expect") or {})}
    쓰인 |= set(평가셋.get("uncovered_fields") or {})

    낯선 = sorted(쓰인 - set(fields.SPEC))

    assert not 낯선, f"항목에 없는 이름이 평가셋에 있습니다: {낯선}"


def test_사례_번호가_겹치지_않는다(평가셋: dict) -> None:
    번호들 = [case["id"] for case in 평가셋["cases"]]

    겹친 = sorted({n for n in 번호들 if 번호들.count(n) > 1})

    assert not 겹친, f"사례 번호가 겹칩니다: {겹친}"


def test_일관성에_적힌_사례가_실제로_있다(평가셋: dict) -> None:
    있는_번호 = {case["id"] for case in 평가셋["cases"]}

    없는 = sorted(set(평가셋["consistency"]["case_ids"]) - 있는_번호)

    assert not 없는, f"일관성 목록에 없는 사례가 적혀 있습니다: {없는}"

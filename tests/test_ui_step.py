"""화면이 지금 어느 단계인지 고르는 규칙.

화면 자체는 Streamlit이 그려서 테스트하지 않는다. 대신 **단계를 고르는 판단만**
떼어내 지킨다. 여기가 틀리면 사용자가 확인 화면을 건너뛰고 판정을 받는다.

2026-09-14 실물 확인에서 LLM이 "경기도에 살아요"를 비수도권으로 읽었다. 확인
단계를 건너뛰면 그 값 그대로 판정이 돌고, 그 결과는 안 보여 주는 것보다 해롭다.
"""

from __future__ import annotations

from housing_finance_agent.ui.app import STEPS, current_step

_읽은_값 = {"values": {"age": 30}, "sources": {}, "unreadable": {}, "warnings": []}


def test_아무것도_없으면_입력부터() -> None:
    assert current_step({}) == 0


def test_읽은_값이_있으면_확인_단계() -> None:
    assert current_step({"extracted": _읽은_값}) == 1


def test_문장에서_아무것도_못_읽어도_확인_단계를_거친다() -> None:
    """직접 입력으로 넘어온 경우다. 읽은 값이 비었다고 입력으로 되돌리면 막다른 길이 된다."""
    빈_결과 = {"values": {}, "sources": {}, "unreadable": {}, "warnings": []}

    assert current_step({"extracted": 빈_결과}) == 1


def test_판정_결과가_있으면_결과_단계() -> None:
    상태 = {"extracted": _읽은_값, "confirmed_profile": {"age": 30}, "results": [{"status": "X"}]}

    assert current_step(상태) == 2


def test_확인만_마치고_판정_전이면_아직_확인_단계() -> None:
    """확인을 마쳤다고 결과 화면으로 넘기지 않는다. 판정이 실패하면 보여 줄 것이 없다."""
    상태 = {"extracted": _읽은_값, "confirmed_profile": {"age": 30}}

    assert current_step(상태) == 1


def test_확인을_건너뛴_판정_결과는_만들어질_수_없다() -> None:
    """`results`는 확인 화면이 `confirmed_profile`을 채운 뒤에만 생긴다.

    단계 계산만으로는 이것을 막지 못한다. 막는 것은 `app.main`이 판정을 부르는
    조건이다. 그 조건을 지우면 이 테스트가 아니라 아래 grep이 걸린다.
    """
    from pathlib import Path

    소스 = Path(__file__).resolve().parents[1] / "src/housing_finance_agent/ui/app.py"
    본문 = 소스.read_text(encoding="utf-8")

    assert 'if st.session_state.get("confirmed_profile") and not st.session_state' in 본문


def test_단계_이름이_세_개다() -> None:
    """단계를 늘리면 current_step도 같이 고쳐야 한다."""
    assert len(STEPS) == 3

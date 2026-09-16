"""화면이 지금 어느 단계인지 고르는 규칙.

화면 자체는 Streamlit이 그려서 테스트하지 않는다. 대신 **단계를 고르는 판단만**
떼어내 지킨다. 여기가 틀리면 사용자가 확인 화면을 건너뛰고 판정을 받는다.

2026-09-14 실물 확인에서 LLM이 "경기도에 살아요"를 비수도권으로 읽었다. 확인
단계를 건너뛰면 그 값 그대로 판정이 돌고, 그 결과는 안 보여 주는 것보다 해롭다.
"""

from __future__ import annotations

from pathlib import Path

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


def test_애니메이션이_기대는_streamlit_속성이_아직_있다() -> None:
    """전환 효과 CSS는 Streamlit 내부 DOM 속성에 기댄다.

    `data-testid`는 Streamlit이 자기 테스트용으로 붙이는 것이라 버전이 오르면
    이름이 바뀔 수 있다. 바뀌면 CSS가 조용히 안 먹고 효과만 사라진다. 화면은
    그대로 돌기 때문에 아무도 모른 채 지나간다. 여기서 먼저 걸리게 한다.
    """
    import re

    import streamlit

    from housing_finance_agent.ui.app import _전환_CSS

    # CSS에 적힌 이름을 꺼내서 번들에 있는지 본다. 반대로 하면(아는 이름이 CSS에
    # 있는지 보면) 이름이 늘어났을 때 못 잡는다 — `stMainBlockContainerXX`에도
    # `stMainBlockContainer`는 들어 있다. 2026-09-16 변형 시험에서 실제로 안 죽었다.
    이름들 = set(re.findall(r'data-testid="([^"]+)"', _전환_CSS))
    assert 이름들, "전환 효과 CSS가 data-testid를 쓰지 않는다"

    번들 = Path(streamlit.__file__).parent / "static" / "static" / "js"
    본문 = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore") for path in 번들.glob("*.js")
    )
    없는_것 = sorted(이름 for 이름 in 이름들 if 이름 not in 본문)

    assert not 없는_것, f"설치된 Streamlit에 {없는_것}가 없다. 전환 효과 CSS를 고쳐야 한다"


def test_같은_단계를_다시_그릴_때는_전환_효과를_안_넣는다() -> None:
    """**매번 넣으면 입력할 때마다 화면이 미끄러진다.**

    Streamlit은 값을 하나 칠 때마다 화면 전체를 다시 그린다. 확인 화면은 입력 칸이
    스무 개가 넘어서, 조건 없이 넣으면 숫자 한 자마다 화면이 흔들린다.
    """
    from streamlit.testing.v1 import AppTest

    앱 = Path(__file__).resolve().parents[1] / "src/housing_finance_agent/ui/app.py"

    at = AppTest.from_file(str(앱), default_timeout=30).run()
    처음 = [m.value for m in at.markdown if "hfaStep" in m.value]
    assert len(처음) == 1, "첫 화면에서는 한 번 넣어야 한다"

    at.run()
    다시 = [m.value for m in at.markdown if "hfaStep" in m.value]
    assert 다시 == [], "같은 단계인데 또 넣었다"

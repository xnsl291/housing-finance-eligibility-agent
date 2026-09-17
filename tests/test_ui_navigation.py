"""버튼을 눌렀을 때 실제로 다음 단계로 넘어가는가.

**화면을 세션 값으로 직접 채워 놓고 그리는 것으로는 이걸 못 잡는다.** 단계 전환을
넣을 때 `AppTest`로 세 단계를 다 그려 봤지만, `extracted`를 세션에 직접 넣고
확인했기 때문에 "버튼을 눌러서 그 상태가 되는" 경로를 한 번도 안 지났다.

실제로는 안 넘어갔다 — `app.main`이 단계를 **먼저 계산하고** 화면을 그리는데,
버튼은 그 뒤에 눌린다. 추출이 성공해 `extracted`가 채워져도 그 실행에서 단계는
여전히 0이라 입력 화면인 채로 끝났다. 2026-09-17 사용자가 발견했다.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

_APP = Path(__file__).resolve().parents[1] / "src/housing_finance_agent/ui/app.py"

def _그려진_단계(앱) -> str:
    """**세션 값이 아니라 실제로 그려진 것을 본다.**

    세션 값으로 보면 이 버그를 못 잡는다. 버튼이 값을 채우기 때문에 실행이 끝난
    뒤의 세션에는 이미 `extracted`가 들어 있다. 정작 그 실행에서 그려진 것은
    입력 화면이었다. 그래서 화면에 찍힌 눈썹 라벨로 판단한다.
    """
    for 조각 in (m.value for m in 앱.markdown):
        if 'hfa-eyebrow">' in 조각:
            이름 = 조각.split('hfa-eyebrow">')[1].split("<")[0]
            if 이름 != "시스템 상태":
                return 이름
    return "(없음)"


_뽑은_값 = {
    "values": {"age": 30, "combined_annual_income_krw": 40000000},
    "sources": {"age": "만 30세"},
    "unreadable": {},
    "warnings": [],
}


@pytest.fixture
def 앱(monkeypatch):
    """실물 LLM과 서버를 부르지 않는다. 여기서 보는 것은 화면 전환뿐이다."""
    from housing_finance_agent.ui import api_client

    monkeypatch.setattr(api_client, "extract", lambda message: _뽑은_값)
    monkeypatch.setattr(api_client, "health", lambda: {"status": "ok", "programs": []})
    monkeypatch.setattr(api_client, "fields", lambda: {"fields": {}})
    return AppTest.from_file(str(_APP), default_timeout=30).run()


def test_조건_읽기를_누르면_확인_단계로_넘어간다(앱) -> None:
    """**여기가 이 파일의 이유다.**"""
    앱.text_area[0].set_value("만 30세이고 연봉 4천만원입니다").run()
    눌림 = [b for b in 앱.button if b.label == "조건 읽기"]
    assert 눌림, "조건 읽기 버튼이 없다"

    눌림[0].click().run()

    assert not 앱.exception, [str(e)[:300] for e in 앱.exception]
    assert _그려진_단계(앱) == "읽은 내용 확인", "버튼을 눌렀는데 입력 화면에 머물렀다"


def test_예시_버튼을_누르면_문장이_들어가고_읽기가_켜진다(앱) -> None:
    예시 = [b for b in 앱.button if b.label == "혼자 사는 직장인"]
    assert 예시, "예시 버튼이 없다"

    예시[0].click().run()

    assert 앱.text_area[0].value, "예시 문장이 입력 칸에 안 들어갔다"
    읽기 = [b for b in 앱.button if b.label == "조건 읽기"]
    assert 읽기 and not 읽기[0].disabled, "문장이 있는데 읽기 버튼이 꺼져 있다"


def test_예시를_넣고_읽기까지_눌러도_넘어간다(앱) -> None:
    """사용자가 실제로 밟은 경로다 — 예시 클릭 후 바로 읽기."""
    [b for b in 앱.button if b.label == "혼자 사는 직장인"][0].click().run()
    [b for b in 앱.button if b.label == "조건 읽기"][0].click().run()

    assert _그려진_단계(앱) == "읽은 내용 확인", "예시 경로에서 안 넘어갔다"


def test_생각중_마크업에_점이_세_개다() -> None:
    """`st.empty()` 안에 그린 것은 AppTest가 노출하지 않는다. 그래서 마크업만 따로 본다."""
    from housing_finance_agent.ui.chrome import _thinking_html

    마크업 = _thinking_html("문장을 읽고 있습니다")

    assert 마크업.count('class="d"') == 3, f"점이 세 개가 아니다: {마크업}"
    assert "문장을 읽고 있습니다" in 마크업
    assert 'class="hfa-thinking"' in 마크업


def test_생각중은_빠져나올_때_지운다() -> None:
    """안 지우면 오류 문구 옆에서 점이 계속 돈다."""
    import inspect

    from housing_finance_agent.ui import chrome

    본문 = inspect.getsource(chrome.thinking)

    assert "finally:" in 본문 and "자리.empty()" in 본문, "빠져나올 때 안 지운다"


def test_문장_읽기가_생각중으로_감싸여_있다() -> None:
    """**4~8초 걸리는 유일한 자리다.** 여기가 안 감싸이면 화면이 멈춘 것처럼 보인다.

    실제로 그려지는 순간은 추출이 끝나면 사라져서 렌더 결과로는 못 잡는다.
    그래서 호출이 감싸여 있는지를 본문에서 확인한다.
    """
    본문 = (
        Path(__file__).resolve().parents[1]
        / "src/housing_finance_agent/ui/screens/input.py"
    ).read_text(encoding="utf-8")

    감싼_줄 = "with chrome.thinking("
    assert 감싼_줄 in 본문, "추출이 생각 중 표시로 감싸여 있지 않다"
    앞 = 본문.index(감싼_줄)
    뒤 = 본문.index("api_client.extract(", 앞)
    assert 뒤 - 앞 < 120, "생각 중 표시와 추출 호출이 떨어져 있다"


def test_점이_도는_규칙이_스타일에_들어_있다() -> None:
    """점은 CSS로 돈다. 파이썬이 응답을 기다리며 막혀 있어도 돌아야 한다."""
    from housing_finance_agent.ui.chrome import _CSS

    assert "@keyframes hfaDots" in _CSS, "점이 도는 규칙이 없다"

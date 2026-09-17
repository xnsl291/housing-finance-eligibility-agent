"""화면 진입점.

    streamlit run src/housing_finance_agent/ui/app.py

실행 옵션은 `.streamlit/config.toml`이 들고 있다. 명령줄 플래그로만 두면 한 번
빼먹었을 때 그대로 노출된다.

여기는 화면 전환만 한다. 업무 판단은 담지 않는다. 화면이 판단하기 시작하면
API가 지키는 규칙(검수 안 된 규칙은 안 쓴다, 모르면 판정 안 한다)이 화면에서 깨진다.

흐름은 계획서 §15를 따른다.

    조건 입력 → 읽은 내용 확인 → 결과 요약 → 상품 상세

**확인 단계를 건너뛸 수 없다.** 실물 확인에서 LLM이 "경기도"를 비수도권으로 읽고
"원룸 알아보는 중"을 재개발 구역 세입자로 만든 적이 있다. 잘못 읽은 조건으로
판정하면 그 결과가 오히려 해롭다.

**한 번에 한 단계만 그린다.** 처음에는 세 화면을 세로로 이어 붙였는데, 판정을
받고 나면 결과를 보려고 입력 칸과 확인 항목 스무 개를 지나 스크롤해야 했다.
데모 녹화에서 결과가 화면 밖에 있게 된다.
"""

from __future__ import annotations

from collections.abc import Mapping

import streamlit as st

from housing_finance_agent.ui import chrome
from housing_finance_agent.ui.api_client import ApiError, check
from housing_finance_agent.ui.screens import confirm, input, results, sidebar

STEPS = ("조건 입력", "읽은 내용 확인", "판정 결과")


def current_step(state: Mapping) -> int:
    """지금 그릴 단계를 세션 값에서 계산한다. 0 입력 · 1 확인 · 2 결과.

    **단계를 따로 저장하지 않는다.** 저장하면 실제로 가진 값과 단계가 어긋나는
    상태가 생긴다 — 판정 결과는 있는데 단계는 입력이라 결과를 못 보는 식이다.
    되돌아가는 버튼도 단계를 낮추는 대신 그 단계에서 만든 값을 지운다.
    """
    if state.get("results"):
        return 2
    if state.get("extracted") is not None:
        return 1
    return 0


def main() -> None:
    st.set_page_config(page_title="주거금융 지원가능성 판정", layout="centered")
    chrome.스타일()
    st.title("주거금융 지원가능성 판정")
    st.caption(
        "신청 전에 가능성을 가늠하는 도구입니다. 실제 심사는 기관이 합니다. "
        "이 화면은 승인 여부를 판단하지 않습니다."
    )

    sidebar.render()

    단계 = current_step(st.session_state)
    _전환_효과(단계)
    _단계_표시(단계)

    if 단계 == 0:
        input.render()
        return

    if 단계 == 1:
        confirm.render()
        # 확인 화면이 판정을 직접 부르지 않게 한다. "확인을 마쳐야 판정한다"는
        # 순서가 한곳에서만 정해져야 화면을 늘려도 안 깨진다.
        if st.session_state.get("confirmed_profile") and not st.session_state.get("results"):
            _판정()
            if st.session_state.get("results"):
                st.rerun()
        _되돌리기("← 문장 다시 쓰기", 처음부터=True)
        return

    results.render(st.session_state["results"])
    _되돌리기("← 읽은 내용 다시 확인", 처음부터=False)


# 화면이 통째로 바뀌는데 그냥 바뀌면 방금 무엇이 일어났는지 안 읽힌다. 발표 자료가
# 장을 넘기듯 본문이 위에서 아래로 내려오며 나타나게 한다.
#
# **기댈 곳이 Streamlit 내부 DOM 속성뿐이다.** `data-testid`는 Streamlit이 자기
# 테스트용으로 붙이는 것이라 버전이 오르면 이름이 바뀔 수 있다. 바뀌면 효과만
# 사라지고 화면은 그대로 돈다 — 그래도 조용히 사라지면 모르니까
# `tests/test_ui_step.py`가 설치된 Streamlit에 이 이름이 아직 있는지 확인한다.
_전환_CSS = """
<style>
@keyframes hfaStep{단계} {{
  from {{ opacity: 0; transform: translateY(-2.5rem); }}
  to   {{ opacity: 1; transform: translateY(0); }}
}}
[data-testid="stMainBlockContainer"] {{
  animation: hfaStep{단계} 420ms cubic-bezier(0.22, 0.61, 0.36, 1);
}}
/* 움직임을 줄이도록 설정한 사용자에게는 넣지 않는다. */
@media (prefers-reduced-motion: reduce) {{
  [data-testid="stMainBlockContainer"] {{ animation: none; }}
}}
</style>
"""

_마지막_단계_키 = "_전환_효과를_준_단계"


def _전환_효과(단계: int) -> None:
    """단계가 바뀐 순간에만 효과를 넣는다.

    **매번 넣으면 안 된다.** Streamlit은 값을 하나 입력할 때마다 화면 전체를 다시
    그린다. 조건 없이 넣으면 확인 화면에서 숫자 한 자를 칠 때마다 화면이 미끄러진다.
    그래서 마지막으로 효과를 준 단계를 기억해 두고 달라졌을 때만 넣는다.

    애니메이션 이름에 단계 번호를 붙이는 것은 되돌아갈 때(결과 → 확인)도 브라우저가
    효과를 새로 시작하게 하려는 것이다. 이름이 같으면 이어서 도는 것으로 본다.
    """
    if st.session_state.get(_마지막_단계_키) == 단계:
        return
    st.session_state[_마지막_단계_키] = 단계
    st.markdown(_전환_CSS.format(단계=단계), unsafe_allow_html=True)


def _단계_표시(단계: int) -> None:
    """지금 몇 번째 단계인지. 화면이 통째로 바뀌므로 어디쯤인지 알려 줘야 한다."""
    조각 = []
    for 번호, 이름 in enumerate(STEPS):
        if 번호 < 단계:
            조각.append(f":green[✓ {이름}]")
        elif 번호 == 단계:
            조각.append(f"**{번호 + 1}. {이름}**")
        else:
            조각.append(f":gray[{번호 + 1}. {이름}]")
    st.markdown(" ⟶ ".join(조각))
    st.divider()


def _되돌리기(문구: str, *, 처음부터: bool) -> None:
    """앞 단계로 돌아간다. 단계를 낮추는 대신 그 단계에서 만든 값을 지운다.

    적어 둔 문장(`input_message`)은 지우지 않는다. 다시 쓰게 만들면 사용자는 짧게
    쓰고, 짧게 쓰면 읽히는 항목이 줄어 판정이 '정보 부족'으로 떨어진다.
    """
    st.divider()
    if not st.button(문구):
        return

    st.session_state.pop("results", None)
    st.session_state.pop("confirmed_profile", None)
    if 처음부터:
        st.session_state.pop("extracted", None)
        st.session_state.pop("extract_error", None)
        confirm.clear_edits()
    st.rerun()


def _판정() -> None:
    try:
        st.session_state["results"] = check(st.session_state["confirmed_profile"])["results"]
    except ApiError as error:
        # 판정을 못 냈으므로 확인 단계에 머문다. 여기서 rerun하면 이 문구가 사라진다.
        st.error(str(error))


if __name__ == "__main__":
    main()

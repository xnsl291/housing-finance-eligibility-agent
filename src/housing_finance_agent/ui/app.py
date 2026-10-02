"""화면 진입점.

    streamlit run src/housing_finance_agent/ui/app.py

실행 옵션은 `.streamlit/config.toml`이 들고 있다. 명령줄 플래그로만 두면 한 번
빼먹었을 때 그대로 노출된다.

여기는 화면 전환만 한다. 업무 판단은 담지 않는다. 화면이 판단하기 시작하면
API가 지키는 규칙(검수 안 된 규칙은 안 쓴다, 모르면 판정 안 한다)이 화면에서 깨진다.

흐름.

    조건 입력 → 읽은 내용 확인 → 하나씩 확인 → 판정 결과

**"하나씩 확인"은 서버가 정한 질문을 하나씩 받는 단계다(D-31).** 전에는 확인 화면에서
모르는 항목 스무 개를 한꺼번에 보여 줬다. 이제 판정에 필요한 것만, 서버가 정한 순서로
묻는다. 값과 "모르겠다"는 서버 세션에 남아 새로 고쳐도 이어진다.

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

from housing_finance_agent.ui import api_client, chrome
from housing_finance_agent.ui.flow import USER_STOPPED, stop_message, trace_lines
from housing_finance_agent.ui.screens import confirm, input, questions, results, sidebar

STEPS = ("조건 입력", "읽은 내용 확인", "하나씩 확인", "판정 결과")


def current_step(state: Mapping) -> int:
    """지금 그릴 단계를 세션 값에서 계산한다. 0 입력 · 1 확인 · 2 질문 · 3 결과.

    **단계를 따로 저장하지 않는다.** 저장하면 실제로 가진 값과 단계가 어긋나는
    상태가 생긴다 — 판정 결과는 있는데 단계는 입력이라 결과를 못 보는 식이다.
    되돌아가는 버튼도 단계를 낮추는 대신 그 단계에서 만든 값을 지운다.
    """
    if state.get("results") is not None:
        return 3
    # 확인을 마쳐야 질문으로 간다. LLM이 잘못 읽은 값을 사람이 보기 전에 그 값으로
    # 질문을 고르면, 잘못 읽은 조건 위에서 루프가 돈다.
    if state.get("confirmed") and state.get("session_id"):
        return 2
    if state.get("extracted") is not None:
        return 1
    return 0


def main() -> None:
    st.set_page_config(page_title="주거금융 지원가능성 판정", layout="wide")
    chrome.style()
    st.title("주거금융 지원가능성 판정")
    st.caption(
        "신청 전에 가능성을 가늠하는 도구입니다. 실제 심사는 기관이 합니다. "
        "이 화면은 승인 여부를 판단하지 않습니다."
    )

    sidebar.render()

    단계 = current_step(st.session_state)
    chrome.motion(단계)
    chrome.steps(STEPS, 단계)
    st.divider()

    if 단계 == 0:
        input.render()
        return

    if 단계 == 1:
        confirm.render()
        _되돌리기("← 문장 다시 쓰기")
        return

    if 단계 == 2:
        questions.render()
        _되돌리기("← 처음부터 다시")
        return

    _결과()
    # 중간에 멈춘 경우에만 이어서 답할 길을 남긴다. 모른다고 한 것만 남은 경우는
    # 이어 가도 다시 묻지 않으므로 곧바로 여기로 돌아온다.
    멈춘_이유 = st.session_state.get("stop", {}).get("reason")
    if 멈춘_이유 == USER_STOPPED and st.button("질문 이어서 하기"):
        st.session_state.pop("results", None)
        st.session_state.pop("stop", None)
        st.rerun()
    _되돌리기("← 처음부터 다시")


def _결과() -> None:
    """판정 결과. 멈춘 이유를 맨 위에, 확인 과정을 맨 아래에 둔다."""
    catalog = _항목_목록()
    멈춤 = st.session_state.get("stop") or {}
    if 멈춤:
        종류, 문구 = stop_message(멈춤["reason"], 멈춤.get("declined_needed") or [], catalog)
        getattr(st, 종류)(문구)

    results.render(st.session_state["results"])

    # 규칙마다 어떻게 됐는지는 위 상세가 보여 준다. 여기서는 값이 어디서 왔는지 —
    # 문장에서 읽었는지, 고쳤는지, 질문에 답했는지, 모른다고 했는지를 보여 준다.
    with st.expander("어떤 순서로 무엇을 확인했나"):
        try:
            기록 = api_client.trace(st.session_state["session_id"])["events"]
        except api_client.ApiError as error:
            st.caption(f"기록을 불러오지 못했습니다. {error}")
            return
        for 번호, 줄 in enumerate(trace_lines(기록, catalog), start=1):
            st.markdown(f"{번호}. {줄}")
        st.caption("입력하신 문장 자체는 저장하지 않고, 읽어 낸 값과 근거 구절만 남깁니다.")


def _항목_목록() -> dict:
    try:
        return api_client.fields()["fields"]
    except api_client.ApiError:
        # 표기를 못 받아도 결과는 보여 준다. 항목 코드가 그대로 보일 뿐이다.
        return {}


def _되돌리기(문구: str) -> None:
    """처음으로 돌아간다. 단계를 낮추는 대신 문장에서 만든 것을 지운다.

    적어 둔 문장(`input_message`)은 지우지 않는다. 다시 쓰게 만들면 사용자는 짧게
    쓰고, 짧게 쓰면 읽히는 항목이 줄어 판정이 '정보 부족'으로 떨어진다.

    질문 단계에서 확인 화면으로만 되돌아가는 길은 두지 않는다. 질문에 답한 값은 서버
    세션에 있는데 확인 화면은 문장에서 읽은 값만 그려서, 돌아가면 답한 값이 안 보인다.
    """
    st.divider()
    if not st.button(문구):
        return
    input.start_over()
    st.rerun()


if __name__ == "__main__":
    main()

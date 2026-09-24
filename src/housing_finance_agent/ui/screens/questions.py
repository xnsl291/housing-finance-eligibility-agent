"""화면 3 — 하나씩 확인.

**무엇을 물을지 여기서 정하지 않는다.** 서버의 `GET /next`가 정하고(`next_action.py`),
화면은 받은 질문 하나를 그리고 답을 돌려보낸다. 화면이 순서를 정하기 시작하면 같은
상태에 다른 질문이 나올 수 있고, "같은 입력에 같은 답"이라는 주장이 화면에서 깨진다.

**질문은 제안이다.** 매 질문에 `모르겠어요`가 있고, 언제든 그만 묻고 결과를 볼 수
있다. 답을 받아야만 넘어가는 화면은 모르는 것을 찍게 만든다.
"""

from __future__ import annotations

import streamlit as st

from housing_finance_agent.ui import api_client
from housing_finance_agent.ui.flow import USER_STOPPED
from housing_finance_agent.ui.labels import amount_text

_BOOL_OPTIONS = {"예": True, "아니오": False}


def render() -> None:
    st.subheader("3. 하나씩 확인")
    session_id = st.session_state["session_id"]

    try:
        다음 = api_client.next_action(session_id)
    except api_client.ApiError as error:
        st.error(f"다음 질문을 받지 못했습니다. {error}")
        return

    if 다음["action"] == "RESULT":
        # 더 물을 것이 없다. 결과로 넘어간다 — 멈춘 이유를 함께 넘겨야 결과 화면이
        # "다 확인함"과 "모르셔서 확정 못 함"을 다르게 말할 수 있다.
        finish(다음["reason"], 다음.get("declined_needed") or [], 다음.get("candidates"))
        return

    질문 = 다음["question"]
    답한_수 = st.session_state.get("answered_count", 0)
    st.caption(f"판정에 필요한 것만 하나씩 여쭙니다 · 지금까지 {답한_수}개 확인")

    with st.container(border=True):
        st.markdown(f"#### {질문['label']}")
        st.caption(질문["why"])
        if 질문.get("ask_kind") == "IMPRECISE":
            _지금_값(session_id, 질문)
        값 = _입력칸(질문, 답한_수)
        if 질문.get("how_to_check"):
            st.caption(f"확인 방법: {질문['how_to_check']}")

        왼쪽, 오른쪽 = st.columns(2)
        if 왼쪽.button("답하기", type="primary", use_container_width=True, disabled=값 is None):
            _답(session_id, 질문["field"], 값)
        if 오른쪽.button("모르겠어요", use_container_width=True):
            _모름(session_id, 질문["field"])

    st.divider()
    if st.button("그만 묻고 지금까지로 결과 보기"):
        finish(USER_STOPPED, [], 다음.get("candidates"))


def finish(reason: str, declined_needed: list[str], candidates: list[str] | None) -> None:
    """지금까지 모인 값으로 판정하고 결과 단계로 넘긴다.

    후보 상품만 판정한다. 전세라고 답한 사람에게 매매 상품의 "정보 부족"을 보여 주면
    자기와 무관한 결과를 읽어야 한다.
    """
    try:
        results = api_client.assess_session(st.session_state["session_id"], candidates)["results"]
    except api_client.ApiError as error:
        st.error(f"판정하지 못했습니다. {error}")
        return
    st.session_state["stop"] = {"reason": reason, "declined_needed": declined_needed}
    st.session_state["results"] = results
    st.rerun()


def _지금_값(session_id: str, 질문: dict) -> None:
    """범위로만 아는 값이면 지금 무엇으로 알고 있는지 보여 준다. 없는 것과 묻는 말이 다르다."""
    try:
        값 = api_client.session_state(session_id)["values"].get(질문["field"], {}).get("value")
    except api_client.ApiError:
        return
    if 값 is not None:
        st.info(f"지금은 {amount_text(값)}로 알고 있습니다. 기준에 걸쳐 정확한 값이 필요합니다.")


def _입력칸(질문: dict, 순번: int) -> object:
    """질문 하나의 입력 칸. 아무것도 고르지 않았으면 None — 답하기 버튼이 잠긴다.

    칸의 키에 순번을 붙인다. 같은 항목을 다시 물을 때(범위로 다시 답한 경우) 앞 답이
    칸에 남아 있으면 사용자가 새로 답했는지 알 수 없다.
    """
    kind = 질문.get("kind")
    키 = f"question:{질문['field']}:{순번}"
    if kind == "CHOICE":
        표기 = 질문.get("choice_labels") or {}
        골라진 = st.radio(
            "골라 주세요",
            질문.get("choices") or [],
            index=None,
            key=키,
            format_func=lambda code: 표기.get(code, code),
            label_visibility="collapsed",
        )
        return 골라진
    if kind == "BOOL":
        골라진 = st.radio(
            "골라 주세요",
            list(_BOOL_OPTIONS),
            index=None,
            key=키,
            horizontal=True,
            label_visibility="collapsed",
        )
        return None if 골라진 is None else _BOOL_OPTIONS[골라진]
    if kind == "AMOUNT":
        값 = st.number_input("원 단위로 적어 주세요", value=None, step=1_000_000, key=키)
        if 값 is None:
            return None
        st.caption(amount_text(int(값)))
        return int(값)
    if kind == "INT":
        값 = st.number_input("숫자로 적어 주세요", value=None, step=1, key=키)
        return None if 값 is None else int(값)
    if kind == "FLOAT":
        return st.number_input("숫자로 적어 주세요", value=None, key=키)
    값 = st.text_input("적어 주세요", key=키)
    return 값.strip() or None


def _답(session_id: str, field: str, 값: object) -> None:
    try:
        api_client.set_fields(session_id, {field: 값})
    except api_client.ApiError as error:
        # 서버가 값을 검사한다(422). 날짜 형식 같은 것을 여기서 따로 검사하지 않는다.
        st.error(str(error))
        return
    st.session_state["answered_count"] = st.session_state.get("answered_count", 0) + 1
    st.rerun()


def _모름(session_id: str, field: str) -> None:
    try:
        api_client.decline(session_id, field)
    except api_client.ApiError as error:
        st.error(str(error))
        return
    st.session_state["answered_count"] = st.session_state.get("answered_count", 0) + 1
    st.rerun()

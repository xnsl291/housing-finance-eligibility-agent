"""화면 1 — 조건 입력.

자유 문장을 받아 추출 API로 보낸다. **여기서는 아무것도 판단하지 않는다.** 문장을
훑어 값을 미리 짐작하거나 빠진 항목을 채우면, 사용자는 자기가 쓰지 않은 조건으로
판정받게 된다.

실패했을 때 **입력한 문장을 지우지 않는다.** 다시 쓰게 만들면 사용자는 짧게 쓰고,
짧게 쓰면 읽히는 항목이 줄어 판정이 '정보 부족'으로 떨어진다.
"""

from __future__ import annotations

import streamlit as st

from housing_finance_agent.ui import api_client, chrome
from housing_finance_agent.ui.screens import confirm

# API 기본값과 같은 1,000자. 서버가 상한을 내려 주지 않아 화면이 따로 들고 있다.
# 서버 상한이 바뀌면 여기도 고쳐야 한다. 화면에서 막는 것은 사용자가 긴 글을 쓰고
# 나서 거절당하지 않게 하려는 것이고, 진짜 상한은 API가 지킨다.
MAX_CHARS = 1000

_MESSAGE_KEY = "input_message"

# 사용자가 어떤 식으로 쓰면 되는지 보여 주는 예시. 주민번호·계좌번호·주소처럼
# 판정에 쓰지 않는 정보는 예시에도 넣지 않는다. 예시가 곧 입력 요구로 읽힌다.
EXAMPLES: tuple[tuple[str, str], ...] = (
    (
        "혼자 사는 직장인",
        "만 29세 직장인이고 무주택 세대주입니다. 연봉은 4천만원이고 "
        "서울에서 보증금 1억8천짜리 전셋집을 구하고 있습니다.",
    ),
    (
        "결혼 준비 중인 맞벌이",
        "결혼 2년차 맞벌이입니다. 부부합산 소득은 6천만원쯤 되고 "
        "경기도 성남에서 전세 2억5천 아파트를 알아보는 중입니다. 자녀는 없습니다.",
    ),
)


def render() -> None:
    chrome.eyebrow("조건 입력")
    st.subheader("상황을 문장으로 적어 주세요")
    st.caption("상황을 문장으로 적어 주세요. 읽은 내용은 다음 화면에서 직접 확인하고 고칩니다.")

    # 입력 칸보다 먼저 보여 준다. 다 쓰고 나서 읽는 안내는 이미 늦다.
    chrome.note(
        "주민등록번호·계좌번호·집 주소는 적지 마세요. 판정에 쓰지 않고 저장하지도 않습니다."
    )

    _예시_버튼()

    message = st.text_area(
        "상황을 자유롭게 적어 주세요",
        key=_MESSAGE_KEY,
        height=140,
        placeholder=(
            "나이, 소득, 무주택 여부, 지역, 보증금을 적어 주시면 읽을 수 있는 항목이 많아집니다."
        ),
    )

    너무_김 = len(message) > MAX_CHARS
    if 너무_김:
        넘은_글자 = len(message) - MAX_CHARS
        st.error(f"{MAX_CHARS:,}자까지 보낼 수 있습니다. {넘은_글자:,}자 줄여 주세요")
    else:
        st.caption(f"{len(message):,} / {MAX_CHARS:,}자 (남은 글자 {MAX_CHARS - len(message):,})")

    if st.button("조건 읽기", type="primary", disabled=너무_김 or not message.strip()):
        _읽기(message)

    _실패_안내()


def _예시_버튼() -> None:
    """예시를 입력 칸 값으로 넣는다.

    입력 칸이 그려진 뒤에 그 칸의 세션 값을 바꾸면 Streamlit이 예외를 낸다. 그래서
    버튼을 입력 칸보다 먼저 그리고, 넣은 뒤 다시 그린다.
    """
    st.caption("예시를 눌러 보세요")
    for column, (name, text) in zip(st.columns(len(EXAMPLES)), EXAMPLES, strict=True):
        if column.button(name, use_container_width=True):
            st.session_state[_MESSAGE_KEY] = text
            st.rerun()


def _읽기(message: str) -> None:
    st.session_state.pop("extract_error", None)
    try:
        extracted = api_client.extract(message)
    except api_client.ApiError as error:
        # 다음 실행에서도 보여 줘야 한다. 오류 아래 버튼을 누르면 화면이 다시 그려지는데
        # 그때 오류가 사라지면 그 버튼도 같이 사라진다.
        st.session_state["extract_error"] = {"status": error.status, "message": str(error)}
        return

    st.session_state["extracted"] = extracted
    # 다시 읽었으면 앞서 확인한 값과 판정 결과는 더 이상 이 문장의 것이 아니다.
    st.session_state.pop("confirmed_profile", None)
    st.session_state.pop("results", None)
    confirm.clear_edits()

    # **여기서 다시 그리지 않으면 화면이 안 넘어간다.** `app.main`은 단계를 먼저
    # 계산하고 화면을 그리는데, 이 버튼은 그 뒤에 눌린다. 값만 채우고 끝내면
    # 이번 실행에서는 단계가 여전히 0이라 입력 화면인 채로 끝난다.
    st.rerun()


def _실패_안내() -> None:
    error = st.session_state.get("extract_error")
    if not error:
        return

    if error["status"] is None:
        st.error(f"{error['message']}. 서버를 띄운 뒤 다시 눌러 주세요")
        st.caption("적어 두신 문장은 그대로 있습니다. 다시 쓰지 않으셔도 됩니다.")
        return

    if error["status"] == 503:
        # "조건이 안 맞는다"로 읽히면 안 된다. 조건을 못 읽은 것이지 탈락한 것이 아니다.
        st.error(
            "조건을 읽지 못했습니다. 문장 해석이 실패한 것이고 조건에 문제가 있는 것은 아닙니다"
        )
        st.caption("아래로 넘어가면 문장 없이 항목을 직접 채워서 판정할 수 있습니다.")
        if st.button("직접 입력으로 넘어가기"):
            st.session_state["extracted"] = {
                "values": {},
                "sources": {},
                "unreadable": {},
                "warnings": [],
            }
            st.session_state.pop("extract_error", None)
            st.session_state.pop("confirmed_profile", None)
            confirm.clear_edits()
            st.rerun()
        return

    st.error(error["message"])

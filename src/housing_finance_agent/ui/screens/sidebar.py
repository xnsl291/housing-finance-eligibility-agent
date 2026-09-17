"""화면 5 — 사이드바.

이 판정이 어떤 서버와 어떤 상품 목록에서 나왔는지 상시 보여 준다. 결과 화면만
보면 값이 어디서 왔는지 알 수 없고, 서버가 바뀌었는지 상품이 빠졌는지도 모른 채
결과만 읽게 된다.

**여기에 넣지 않는 것** — LLM 상태, 마지막 응답 시간, 외부 장애 여부. 앞의 둘은
API가 상태를 들고 있어야 낼 수 있는 값이라 `/health`를 무겁게 만들고, 외부는
로컬 LLM 하나뿐이라 서버 상태와 겹친다.

오류 문구에 로컬 경로를 넣지 않는다. 이 화면은 데모로 녹화된다. 경로 지우기는
`api_client`가 이미 하므로 여기서는 받은 문구를 그대로 쓴다.
"""

from __future__ import annotations

import streamlit as st

from housing_finance_agent.ui import chrome
from housing_finance_agent.ui.api_client import ApiError, base_url, health


def render() -> None:
    """사이드바를 그린다. 화면 전환과 상관없이 항상 같은 자리에 있다."""
    with st.sidebar:
        chrome.eyebrow("시스템 상태")
        st.caption(f"API 주소 {base_url()}")

        try:
            상태 = health()
        except ApiError as error:
            # 서버가 죽은 것을 "조건이 안 맞는다"로 읽히게 쓰면 안 된다. 사용자
            # 조건과 무관한 문제라는 것이 문구에서 드러나야 한다.
            st.error(f"API 서버에 연결되지 않았습니다 — {error}", icon="🚨")
            st.caption("서버를 띄운 뒤 화면을 새로 고쳐 주세요.")
        else:
            st.success(f"API 서버 연결됨 ({상태.get('status', '상태 표시 없음')})", icon="✅")
            _상품_목록(상태.get("programs") or [])

        st.divider()
        _초기화()

        st.divider()
        st.caption("입력한 내용은 판정에만 쓰고 서버에 저장하지 않습니다.")


def _상품_목록(program_ids: list[str]) -> None:
    """지금 판정에 쓰는 상품.

    상품 이름과 자료 확인일은 `/health`에 없고 판정 응답에 있다. 사이드바가 그
    값을 따로 들고 있으면 판정 전과 후에 다른 목록이 보이므로, 여기서는 서버가
    아는 상품 id만 보여 주고 상세는 결과 화면(화면 4)에 맡긴다.
    """
    st.markdown("**판정에 쓰는 상품**")
    if not program_ids:
        st.caption("서버가 알려 준 상품이 없습니다")
        return
    for program_id in program_ids:
        st.markdown(f"- `{program_id}`")


def _초기화() -> None:
    """데모 녹화용 전체 초기화.

    녹화 중에 앞사람 입력이 남아 있으면 그 데이터가 그대로 찍힌다. 화면별로
    지우면 빠뜨리는 키가 생기므로 세션을 통째로 비운다. 지울 키 목록을 여기에
    적어 두면 화면이 하나 늘 때마다 이 파일을 같이 고쳐야 하는 문제도 있다.
    """
    if st.button("전체 초기화", use_container_width=True):
        st.session_state.clear()
        st.rerun()
    st.caption("입력한 문장과 판정 결과를 모두 지웁니다. 데모를 다시 시작할 때 쓰세요.")

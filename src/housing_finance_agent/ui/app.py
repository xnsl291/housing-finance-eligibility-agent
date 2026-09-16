"""화면 진입점.

    streamlit run src/housing_finance_agent/ui/app.py \
      --server.address 127.0.0.1 --browser.gatherUsageStats false

**옵션 둘을 반드시 붙인다.** Streamlit 기본값은 전 인터페이스 바인딩에 사용 통계
전송이다. 신청자의 나이·소득·자산을 다루는 화면에서 기본값을 쓰면 로컬 LLM을
쓰는 이유가 무너진다.

여기는 화면 전환만 한다. 업무 판단은 담지 않는다. 화면이 판단하기 시작하면
API가 지키는 규칙(검수 안 된 규칙은 안 쓴다, 모르면 판정 안 한다)이 화면에서 깨진다.

흐름은 계획서 §15를 따른다.

    조건 입력 → 읽은 내용 확인 → 결과 요약 → 상품 상세

**확인 단계를 건너뛸 수 없다.** 실물 확인에서 LLM이 "경기도"를 비수도권으로 읽고
"원룸 알아보는 중"을 재개발 구역 세입자로 만든 적이 있다. 잘못 읽은 조건으로
판정하면 그 결과가 오히려 해롭다.
"""

from __future__ import annotations

import streamlit as st

from housing_finance_agent.ui.api_client import ApiError, check
from housing_finance_agent.ui.screens import confirm, input, results, sidebar


def main() -> None:
    st.set_page_config(page_title="주거금융 지원가능성 판정", layout="centered")
    st.title("주거금융 지원가능성 판정")
    st.caption(
        "신청 전에 가능성을 가늠하는 도구입니다. 실제 심사는 기관이 합니다. "
        "이 화면은 승인 여부를 판단하지 않습니다."
    )

    sidebar.render()
    input.render()

    # 뽑은 결과가 있어야 확인 화면이 뜬다. 확인을 마쳐야 판정이 돈다.
    if st.session_state.get("extracted"):
        confirm.render()

    # 확인을 마쳤는데 아직 판정이 없으면 여기서 부른다. 확인 화면이 직접 부르지
    # 않게 해서 "확인 → 판정" 순서가 한곳에서만 정해지게 한다.
    if st.session_state.get("confirmed_profile") and not st.session_state.get("results"):
        _판정()

    if st.session_state.get("results"):
        results.render(st.session_state["results"])


def _판정() -> None:
    try:
        st.session_state["results"] = check(st.session_state["confirmed_profile"])["results"]
    except ApiError as error:
        st.error(str(error))


if __name__ == "__main__":
    main()

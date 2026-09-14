"""화면.

업무 판단을 담지 않는다. API만 부르고 받은 것을 보여 준다. 화면이 판단을 하기
시작하면 API가 지키는 규칙(검수 안 된 규칙은 안 쓴다, 모르면 판정 안 한다)이
화면에서 깨진다.

흐름은 계획서 §15를 따른다.

    조건 입력 → 읽은 내용 확인 → 판정 결과

**확인 화면을 건너뛰지 않는다.** 잘못 읽은 조건으로 판정하면 그 결과가 오히려
해롭다. 사용자가 확인 버튼을 눌러야 판정이 돈다.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

import streamlit as st

_API = os.environ.get("HFA_API_URL", "http://127.0.0.1:8000")

_STATUS_LABEL = {
    "PRECHECK_MATCH": ("사전 조건 부합", "✅"),
    "CONDITIONAL": ("추가 확인 필요", "🟡"),
    "NOT_MATCHED": ("조건 불충족", "❌"),
    "INSUFFICIENT_INFORMATION": ("정보 부족", "🔍"),
}

_예시 = (
    "만 29세 직장인이고 무주택 세대주입니다. "
    "연봉은 4천만원이고 서울에서 보증금 1억8천짜리 전셋집을 구하고 있습니다."
)


def _call(path: str, payload: dict) -> dict | None:
    request = urllib.request.Request(
        f"{_API}{path}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = json.loads(error.read() or b"{}").get("detail", "상세 없음")
        st.error(f"요청이 거부됐습니다 (HTTP {error.code}): {detail}")
    except (OSError, ValueError):
        st.error(f"API 서버에 연결할 수 없습니다. 서버가 떠 있는지 확인하세요 ({_API})")
    return None


def _금액(value: object) -> str:
    if isinstance(value, dict) and "low" in value:
        return f"{value['low']:,}원 ~ {value['high']:,}원"
    return f"{value:,}원" if isinstance(value, int | float) else str(value)


def main() -> None:
    st.set_page_config(page_title="주거금융 지원가능성 판정", layout="centered")
    st.title("주거금융 지원가능성 판정")
    st.caption(
        "신청 전에 가능성을 가늠하는 도구입니다. 실제 심사는 기관이 합니다. "
        "이 화면은 승인 여부를 판단하지 않습니다."
    )

    st.info(
        "주민등록번호·계좌번호·주소는 입력하지 마세요. 판정에 쓰지 않으며 저장하지 않습니다.",
        icon="🔒",
    )

    message = st.text_area("상황을 자유롭게 적어 주세요", value=_예시, height=110)

    if st.button("조건 읽기", type="primary"):
        extracted = _call("/v1/profiles/extract", {"message": message})
        if extracted:
            st.session_state["extracted"] = extracted
            st.session_state.pop("results", None)

    if "extracted" in st.session_state:
        _확인_화면(st.session_state["extracted"])

    if "results" in st.session_state:
        _결과_화면(st.session_state["results"])


def _확인_화면(extracted: dict) -> None:
    st.divider()
    st.subheader("이렇게 읽었습니다")
    st.caption("틀린 곳이 있으면 고쳐 주세요. 확인하셔야 판정이 돕니다.")

    for warning in extracted.get("warnings", []):
        st.warning(warning, icon="🔒")

    values = dict(extracted["values"])
    sources = extracted.get("sources", {})

    for name, value in values.items():
        읽은_곳 = sources.get(name)
        label = f"{name}" + (f"  ← “{읽은_곳}”에서 읽음" if 읽은_곳 else "")
        st.text(f"{label}\n    {_금액(value) if '_krw' in name else value}")

    for name, 원문 in extracted.get("unreadable", {}).items():
        # 빈칸만 보여 주면 무엇을 고쳐야 하는지 모른다.
        st.warning(f"{name}: “{원문}”을 숫자로 읽지 못했습니다. 직접 입력해 주세요")

    if st.button("이 조건으로 판정"):
        checked = _call("/v1/eligibility/check", {"profile": values})
        if checked:
            st.session_state["results"] = checked["results"]


def _결과_화면(results: list[dict]) -> None:
    st.divider()
    st.subheader("판정 결과")

    for result in results:
        label, mark = _STATUS_LABEL.get(result["status"], (result["status"], "•"))
        with st.expander(f"{mark} {result['program_name']} — {label}", expanded=True):
            for action in result["next_actions"]:
                st.write(f"- {action}")

            limit = result.get("loan_limit")
            if limit:
                st.metric("예상 대출 한도", f"{limit['amount_krw']:,}원")
                st.caption(
                    f"보증금 대비 {limit['ratio_amount_krw']:,}원, "
                    f"상한 {limit['cap_amount_krw']:,}원 중 작은 쪽입니다"
                )
                st.caption(f"근거: {limit['citation']}")

            st.caption(
                f"통과 {len(result['passed_rules'])}건 · 불충족 {len(result['failed_rules'])}건"
            )
            st.caption(f"출처: {result['source_url']} ({result['source_checked_at']} 확인)")


if __name__ == "__main__":
    main()

"""화면 3(결과 요약)과 화면 4(상품 상세).

두 화면을 한 파일에 둔 이유는 둘이 같은 판정 응답 하나를 넓이만 달리해 보여 주기
때문이다. 요약이 쓰는 필드와 상세가 쓰는 필드가 같은 응답에서 나오므로, 파일을
나누면 응답 모양이 바뀔 때 두 곳을 같이 고쳐야 한다.

**여기서 판단하지 않는다.** 받은 것을 그대로 보여 준다. 화면이 값을 고르거나 합치기
시작하면 API가 지키는 규칙(검수 안 된 규칙은 판정에 안 쓴다, 모르면 판정하지
않는다)이 화면에서 조용히 깨진다.

확정 표현을 쓰지 않는다. `승인`·`자격 있음`·`가능합니다`는 이 도구가 할 수 있는 말이
아니다. 실제 심사는 기관이 한다.

화면 4는 이 프로젝트가 내세우는 것(모든 조건에 출처가 붙는다)을 증명하는 자리다.
그래서 통과·불충족만 나열하지 않고 판정에 쓰이지 않은 규칙, 아직 다루지 않는 조건,
검수 대기 건수까지 전부 드러낸다. 여기서 근거가 안 보이면 주장이 성립하지 않는다.
"""

from __future__ import annotations

import streamlit as st

from housing_finance_agent.ui import labels

_심사_안내 = "실제 심사와 승인은 기관이 합니다. 이 화면은 신청 전 가늠만 합니다."

# 판정 상태별 아이콘과 색. 한국어 이름은 labels가 정본이고 여기에는 표시 방식만 둔다.
_판정_표시: dict[str, tuple[str, str]] = {
    "PRECHECK_MATCH": ("✅", "green"),
    "CONDITIONAL": ("🟡", "orange"),
    "NOT_MATCHED": ("❌", "red"),
    "INSUFFICIENT_INFORMATION": ("🔍", "blue"),
}

# 규칙 묶음을 보여 주는 순서. 사용자가 먼저 찾는 것(통과·불충족)을 위에 두고,
# 판정에 쓰이지 못한 이유들을 아래에 둔다. NOT_REVIEWED는 성격이 달라 따로 다룬다.
_표시_순서 = (
    "PASSED",
    "FAILED",
    "IMPRECISE",
    "MISSING_VALUE",
    "SUPERSEDED",
    "NOT_APPLICABLE",
)

# 한도를 못 낸 사유마다 사용자가 할 일이 다르다. 한 문구로 뭉치면 무엇을 더 알려
# 줘야 금액이 나오는지 알 수 없다. 사유 코드는 limits.LoanLimit.reason을 따른다.
_한도_미산출: dict[str, str] = {
    "DEPOSIT_UNKNOWN": "임차보증금을 입력하면 한도를 계산할 수 있습니다",
    "DEPOSIT_IMPRECISE": (
        "임차보증금이 범위로만 들어와 금액을 내지 않았습니다. 정확한 금액을 입력해 주세요"
    ),
    "TIER_UNKNOWN": "한도 기준이 갈리는 조건을 아직 알 수 없어 금액을 내지 못했습니다",
    "REGION_UNKNOWN": "지역에 따라 한도가 달라집니다. 주택 소재지를 입력해 주세요",
    "NOT_REVIEWED": "한도 규칙이 아직 검수되지 않아 금액을 내지 않습니다",
}
_한도_미산출_기본 = "대출 한도를 계산하지 못했습니다"

_인용_없음 = "이 규칙에는 원문 인용이 붙어 있지 않습니다"


def render(results: list[dict]) -> None:
    """화면 3 — 상품별 판정을 한눈에 보여 준다."""
    st.subheader("판정 결과")
    st.info(_심사_안내, icon="ℹ️")

    if not results:
        st.info("판정한 상품이 없습니다.")
        return

    for result in results:
        _요약_카드(result)


def _요약_카드(result: dict) -> None:
    """상품 하나의 요약.

    `st.expander`를 쓰지 않는다. 상세(화면 4)를 그 안에서 펼치는데, 접는 상자는
    안에 또 접는 상자를 넣지 못해 검수 대기 규칙을 접어 둘 자리가 없어진다.
    """
    아이콘, 색 = _판정_표시.get(result["status"], ("•", "gray"))
    with st.container(border=True):
        st.markdown(f"### {아이콘} {result['program_name']}")
        st.markdown(f":{색}[**{labels.status_label(result['status'])}**]")

        # 판정만 주면 "그래서 뭘 해야 하나"에 답이 없다. 사용자에게는 이쪽이 더 급하다.
        actions = result.get("next_actions") or []
        for action in actions:
            st.markdown(f"- {action}")
        if not actions:
            st.caption("다음에 할 일로 안내할 내용이 아직 없습니다. 아래 근거를 확인해 주세요.")

        _한도_요약(result.get("loan_limit"))

        # 상단 안내 한 번으로는 안 읽힌다. 판정마다 다시 적는다.
        st.caption(_심사_안내)

        # 토글은 상태를 스스로 들고 있어 화면이 세션 상태를 따로 관리하지 않아도 된다.
        # 사이드바의 전체 초기화가 세션을 비우면 이 상태도 같이 닫힌다.
        if st.toggle("판정 근거 자세히 보기", key=f"상세::{result['program_id']}"):
            st.divider()
            render_detail(result)


def _한도_요약(limit: dict | None) -> None:
    """예상 한도. 금액이 없으면 왜 못 냈는지를 대신 보여 준다."""
    if limit is None:
        return
    if limit.get("amount_krw") is None:
        st.caption(_한도_미산출.get(limit.get("reason") or "", _한도_미산출_기본))
        return

    st.metric("예상 대출 한도", labels.amount_text(limit["amount_krw"]))
    st.caption(_한도_설명(limit))


def _한도_설명(limit: dict) -> str:
    """금액만 보여 주면 왜 그 금액인지 알 수 없다. 두 상한 중 어느 쪽에 걸렸는지 적는다."""
    비율 = limit.get("ratio_amount_krw")
    상한 = limit.get("cap_amount_krw")
    if 비율 is None or 상한 is None:
        return "계산 근거를 응답에서 받지 못했습니다"

    걸린_쪽 = "보증금 비율" if 비율 <= 상한 else "금액 상한"
    return (
        f"보증금 비율로 구한 {labels.amount_text(비율)}과 "
        f"금액 상한 {labels.amount_text(상한)} 중 작은 쪽입니다 — {걸린_쪽}에 걸렸습니다"
    )


def render_detail(result: dict) -> None:
    """화면 4 — 왜 그 판정이 나왔는지 규칙 단위로 보여 준다."""
    _규칙_목록(result.get("rule_outcomes") or [])
    _한도_근거(result.get("loan_limit"))

    # 아직 다루지 않는 조건을 숨기면 판정 범위를 실제보다 넓게 오해한다.
    st.markdown("#### 아직 다루지 않는 조건")
    unresolved = result.get("unresolved") or []
    for item in unresolved:
        st.markdown(f"- {item}")
    if not unresolved:
        st.caption("이 상품에 적어 둔 미해결 조건이 없습니다")

    st.markdown("#### 출처")
    if result.get("source_url"):
        st.markdown(f"- 원문 {result['source_url']}")
    st.markdown(f"- 자료 확인일 {result.get('source_checked_at') or '표시 없음'}")
    st.markdown(f"- 규칙 버전 {result.get('rule_version') or '표시 없음'}")


def _규칙_목록(outcomes: list[dict]) -> None:
    """규칙별 결과를 결과 종류로 묶어 보여 준다.

    묶는 이유는 일곱 가지를 한 줄씩 섞어 놓으면 "통과 몇 건, 못 본 게 몇 건"이
    안 읽히기 때문이다. 묶음 이름은 labels가 정본이라 여기서 다시 짓지 않는다.
    """
    st.markdown("#### 규칙별 판정")
    if not outcomes:
        st.caption("규칙 결과를 응답에서 받지 못했습니다")
        return

    묶음: dict[str, list[dict]] = {}
    for item in outcomes:
        묶음.setdefault(item["outcome"], []).append(item)

    # 엔진에 결과 종류가 하나 늘어도 화면에서 조용히 빠지면 안 된다. 모르는 코드는
    # 아래에 붙여 그대로 내보낸다.
    낯선 = sorted(code for code in 묶음 if code not in _표시_순서 and code != "NOT_REVIEWED")

    for outcome in (*_표시_순서, *낯선):
        규칙들 = 묶음.get(outcome) or []
        if not 규칙들:
            continue
        st.markdown(f"**{labels.outcome_label(outcome)} {len(규칙들)}건**")
        for rule in 규칙들:
            _규칙_한_건(rule, 탈락_문구=outcome == "FAILED")

    _검수_대기(묶음.get("NOT_REVIEWED") or [])


def _규칙_한_건(rule: dict, *, 탈락_문구: bool) -> None:
    """규칙 하나와 그 원문 인용.

    인용은 `st.text`로 낸다. 마크다운으로 넘기면 원문에 든 `*`나 `_`가 서식으로
    먹혀 글자가 바뀐다. 원문을 그대로 보여 주는 것이 이 화면의 존재 이유라
    보기 좋은 쪽보다 안 바뀌는 쪽을 골랐다.
    """
    st.markdown(f"`{rule['rule_id']}` · 항목 `{rule['field']}`")
    if 탈락_문구 and rule.get("failure_message"):
        st.markdown(f":red[{rule['failure_message']}]")
    st.text(rule.get("citation") or _인용_없음)


def _검수_대기(규칙들: list[dict]) -> None:
    """검수 대기 규칙. 판정에 쓰지 않았지만 몇 건이 빠졌는지는 보여 준다.

    건수까지 숨기면 화면에 보이는 것이 이 상품 조건의 전부라고 읽힌다. 그래서
    건수를 먼저 눈에 띄게 보여 주고, 내용은 판정에 쓰이지 않았다는 뜻으로 접어 둔다.
    """
    if not 규칙들:
        return

    st.markdown("#### 검수 대기")
    st.warning(f"{len(규칙들)}건은 검수 전이라 이번 판정에 쓰이지 않았습니다", icon="⚠️")
    with st.expander(f"검수 대기 규칙 {len(규칙들)}건 보기"):
        for rule in 규칙들:
            _규칙_한_건(rule, 탈락_문구=False)


def _한도_근거(limit: dict | None) -> None:
    """한도가 어떻게 나왔는지. 금액을 못 냈으면 못 낸 사유를 같은 자리에 적는다."""
    st.markdown("#### 한도 계산 근거")
    if limit is None:
        st.caption("이 판정에서는 한도를 계산하지 않았습니다")
        return

    if limit.get("amount_krw") is None:
        st.caption(_한도_미산출.get(limit.get("reason") or "", _한도_미산출_기본))
    else:
        st.markdown(f"**{labels.amount_text(limit['amount_krw'])}**")
        st.caption(_한도_설명(limit))
        if limit.get("tier"):
            st.caption(f"적용 구간 `{limit['tier']}`")

    if limit.get("rule_id"):
        st.markdown(f"근거 규칙 `{limit['rule_id']}`")
    st.text(limit.get("citation") or _인용_없음)

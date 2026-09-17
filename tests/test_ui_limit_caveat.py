"""판정이 안 끝났을 때 한도를 확정처럼 보여 주지 않는다.

한도는 임차보증금만 있으면 계산된다. 그래서 소득도 순자산도 모르는 `정보 부족`
상태에서도 금액이 나온다. **계산은 틀리지 않았다** — "자격이 된다면 이 정도"라는
뜻이다. 문제는 화면이 그 단서 없이 `사전 조건 부합`일 때와 똑같이 보여 주면
사용자가 그 금액을 확정으로 읽는 것이다.

2026-09-16 데모 시나리오를 검증하다 발견했다. 소득·순자산을 하나도 모르는 입력에
`1억 4,400만원`이 `st.metric`으로 크게 떴다.

여기서 지키는 것은 두 가지다.

1. 확인 안 된 조건이 남아 있으면 금액을 `st.metric`으로 내지 않는다
2. 몇 개가 남았는지를 같이 낸다 — 판정이 내려 준 목록을 그대로 세므로 문구가 근거와
   어긋날 수 없다
"""

from __future__ import annotations

import pytest

from housing_finance_agent.assessment import assess
from housing_finance_agent.rules import load_program

_통과 = {
    "age": 32,
    "marital_status": "NEWLYWED",
    "household_head_status": "HEAD",
    "home_ownership_status": "NO_HOME_ALL_MEMBERS",
    "combined_annual_income_krw": 60000000,
    "net_asset_krw": 100000000,
    "housing_area_m2": 59,
    "lease_deposit_krw": 250000000,
    "minor_children_count": 0,
    "region_name": "경기도 성남시",
    "is_innovation_city_relocated_worker": False,
    "is_redevelopment_area_tenant": False,
}


def _결과(profile: dict) -> dict:
    """API가 화면에 내려보내는 모양으로 맞춘다. 필드 이름은 api.py가 정본이다."""
    assessment = assess(load_program("nhuf-general-jeonse"), profile)
    return {
        "program_id": "nhuf-general-jeonse",
        "program_name": "버팀목전세자금",
        "status": assessment.decision.status,
        "missing_fields": assessment.decision.missing_fields,
        "imprecise_fields": assessment.decision.imprecise_fields,
        "next_actions": assessment.next_actions,
        "loan_limit": None
        if assessment.loan_limit is None
        else {
            "amount_krw": assessment.loan_limit.amount_krw,
            "reason": assessment.loan_limit.reason,
            "ratio_amount_krw": assessment.loan_limit.ratio_amount_krw,
            "cap_amount_krw": assessment.loan_limit.cap_amount_krw,
            "tier": assessment.loan_limit.tier,
        },
        "rule_outcomes": [],
        "unresolved": [],
    }


def test_정보가_모자라도_한도는_계산된다() -> None:
    """이 전제가 깨지면 아래 테스트들이 무의미해진다. 먼저 못 박아 둔다."""
    보증금만 = {"lease_deposit_krw": 250000000, "region_name": "서울"}

    결과 = _결과(보증금만)

    assert 결과["status"] == "INSUFFICIENT_INFORMATION"
    assert 결과["loan_limit"]["amount_krw"] is not None, "한도가 안 나오면 이 문제 자체가 없다"


def test_확인_안_된_조건이_없는_것은_사전_조건_부합뿐이다() -> None:
    """화면은 판정 상태가 아니라 '남은 항목 개수'로 표시를 가른다.

    개수로 가르는 이유는 문구가 "N개 남았습니다"이기 때문이다 — 세는 대상과 말하는
    대상이 같아야 어긋나지 않는다. 다만 그러려면 **개수가 0인 것과 통과인 것이 같아야**
    한다. 그 전제를 여기서 지킨다.
    """
    통과 = _결과(_통과)
    부족 = _결과({"lease_deposit_krw": 250000000, "region_name": "서울"})

    assert 통과["status"] == "PRECHECK_MATCH"
    assert 통과["missing_fields"] == [] and 통과["imprecise_fields"] == []
    assert 부족["missing_fields"], "정보 부족인데 모르는 항목이 비어 있다"


def _render_only(payload):
    # 이 함수만 ASCII로 둔다. AppTest가 함수 소스를 임시 파일로 옮겨 적는데, 그때
    # 쓰는 인코딩이 UTF-8이 아니라서 한글 이름이 깨진다(2026-09-17 확인).
    # 값도 클로저로는 안 넘어가므로 kwargs로 받는다.
    from housing_finance_agent.ui.screens import results

    results.render([payload])


@pytest.fixture
def 화면():
    """결과 하나를 실제로 그려 본다. 무엇이 그려졌는지는 사람이 아니라 여기서 본다."""
    from streamlit.testing.v1 import AppTest

    def 그리기(결과: dict):
        at = AppTest.from_function(
            _render_only, default_timeout=30, kwargs={"payload": 결과}
        ).run()
        assert not at.exception, [str(e)[:300] for e in at.exception]
        return at

    return 그리기


def test_통과일_때만_금액을_metric으로_낸다(화면) -> None:
    at = 화면(_결과(_통과))

    assert [m.label for m in at.metric] == ["예상 대출 한도"]


def test_정보가_모자라면_금액을_metric으로_내지_않는다(화면) -> None:
    """**여기가 이 파일의 이유다.** metric은 확정된 수치를 보여 주는 자리다."""
    at = 화면(_결과({"lease_deposit_krw": 250000000, "region_name": "서울"}))

    assert at.metric == [], "판정이 안 끝났는데 금액을 확정처럼 냈다"


def test_정보가_모자라면_몇_개가_남았는지_알려_준다(화면) -> None:
    결과 = _결과({"lease_deposit_krw": 250000000, "region_name": "서울"})
    남은_개수 = len(결과["missing_fields"]) + len(결과["imprecise_fields"])

    at = 화면(결과)

    경고 = [w.value for w in at.warning]
    assert any(f"{남은_개수}개" in 문구 for 문구 in 경고), f"남은 개수를 안 알려 줌: {경고}"


def test_금액은_그대로_보여_준다(화면) -> None:
    """숨기지 않는다. 보증금만 알아도 대략을 보는 것은 쓸모가 있다."""
    결과 = _결과({"lease_deposit_krw": 250000000, "region_name": "서울"})

    at = 화면(결과)

    본문 = " ".join(m.value for m in at.markdown)
    assert "1억 2,000만원" in 본문, f"금액이 사라졌다: {본문}"

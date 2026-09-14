"""화면 표기 변환.

**자릿수를 잘못 보여 주면 확인 화면이 무의미해진다.** 사용자가 이 화면에서 확인하는
것이 바로 자릿수라서(소득 4천만원이 4억으로 읽히면 판정이 뒤집힌다) 표기 규칙을
눈으로 보지 않고 테스트로 고정한다.
"""

from __future__ import annotations

from housing_finance_agent.ui.labels import amount_text, outcome_label, status_label


def test_만원_단위로_끊어_보여_준다() -> None:
    assert amount_text(40_000_000) == "4,000만원"
    assert amount_text(50_000_000) == "5,000만원"


def test_억이_넘으면_억과_만원을_나눠_적는다() -> None:
    assert amount_text(100_000_000) == "1억원"
    assert amount_text(180_000_000) == "1억 8,000만원"
    assert amount_text(250_000_000) == "2억 5,000만원"


def test_만원_단위로_안_떨어지면_끊지_않는다() -> None:
    # `4,000만 3,210원`으로 쪼개면 오히려 읽기 어렵다.
    assert amount_text(40_003_210) == "40,003,210원"
    assert amount_text(5_000) == "5,000원"


def test_영은_0원이다() -> None:
    assert amount_text(0) == "0원"


def test_범위는_뒤쪽에만_원을_붙인다() -> None:
    # `4천 후반대`를 한 숫자로 접지 않고 범위 그대로 보여 주기 위한 표기다.
    assert amount_text({"low": 45_000_000, "high": 50_000_000}) == "4,500만~5,000만원"


def test_없는_값은_빈_문자열이다() -> None:
    # 화면이 `None원`이나 `0원`을 그리면 사용자가 말하지 않은 값을 말한 것처럼 보인다.
    assert amount_text(None) == ""


def test_숫자가_아니면_그대로_보여_준다() -> None:
    assert amount_text("작년보다 조금 올랐어요") == "작년보다 조금 올랐어요"


def test_판정_상태_네_가지() -> None:
    assert status_label("PRECHECK_MATCH") == "사전 조건 부합"
    assert status_label("CONDITIONAL") == "추가 확인 필요"
    assert status_label("NOT_MATCHED") == "조건 불충족"
    assert status_label("INSUFFICIENT_INFORMATION") == "정보 부족"


def test_규칙_결과_일곱_가지() -> None:
    assert outcome_label("PASSED") == "통과"
    assert outcome_label("FAILED") == "불충족"
    assert outcome_label("SUPERSEDED") == "특례로 대체됨"
    assert outcome_label("NOT_APPLICABLE") == "적용 대상 아님"
    assert outcome_label("MISSING_VALUE") == "값 없음"
    assert outcome_label("IMPRECISE") == "값이 기준에 걸쳐 판단 불가"
    assert outcome_label("NOT_REVIEWED") == "검수 전이라 판정에 쓰지 않음"


def test_모르는_코드는_지어내지_않는다() -> None:
    # 엔진에 상태가 하나 늘었을 때 화면이 엉뚱한 한국어를 붙이는 것보다 낫다.
    assert status_label("BRAND_NEW") == "BRAND_NEW"
    assert outcome_label("BRAND_NEW") == "BRAND_NEW"


def test_판정_라벨에_확정_표현을_쓰지_않는다() -> None:
    # 이 도구는 신청 전 가늠이고 심사는 기관이 한다. `승인`이라고 쓰면 약속이 된다.
    금지 = ("승인", "자격 있음", "가능합니다")
    for label in (status_label(code) for code in ("PRECHECK_MATCH", "CONDITIONAL")):
        assert not any(말 in label for 말 in 금지)

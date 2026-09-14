"""한국어 금액 표현을 숫자로 바꾼다.

**자릿수를 한 번 틀리면 판정이 통째로 뒤집힌다.** 소득 4천만원이 4억이 되면 탈락하고
400만원이 되면 통과한다. 그래서 이 변환을 LLM에 맡기지 않고 여기서 한다. LLM이
맥락을 읽어 표현을 정리하면(`연봉 4천` → `4천만원`) 숫자로 바꾸는 것은 코드가 한다.

읽지 못하는 표현은 억지로 읽지 않고 None을 준다. 추측한 숫자가 들어오는 것보다
"모른다"가 낫다.
"""

from __future__ import annotations

import pytest

from housing_finance_agent.amount import Range, parse_amount

# --- 기본 표기 ---


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("4천만원", 40000000),
        ("4000만원", 40000000),
        ("4,000만원", 40000000),
        ("4천만 원", 40000000),
        ("40000000", 40000000),
        ("40,000,000원", 40000000),
        ("1억", 100000000),
        ("1억8천", 180000000),
        ("1억 8천만원", 180000000),
        ("1억8천만", 180000000),
        ("3억5천만원", 350000000),
        # 우리 규칙 데이터에도 나오는 표기다
        ("2억2천2백만원", 222000000),
        ("1.8억", 180000000),
        ("7천5백만원", 75000000),
        ("5천만원 이하", 50000000),
    ],
)
def test_금액_표현을_숫자로_바꾼다(text: str, expected: int) -> None:
    assert parse_amount(text) == expected


# --- 범위 표현 ---
#
# 정확한 값을 몰라도 판정이 되는 경우가 있다. "4천 후반대"는 5천만원 기준을
# 넘지 않으므로 더 물어볼 필요가 없다. 범위를 좁게 잡으면 경계를 안 걸쳐서
# 잘못 통과시키므로 넓게 잡는다.


@pytest.mark.parametrize(
    ("text", "low", "high"),
    [
        ("4천 후반대", 45000000, 50000000),
        ("4천만원 후반", 45000000, 50000000),
        ("4천 초반", 40000000, 45000000),
        ("4천만원대", 40000000, 50000000),
        ("1억 초반", 100000000, 150000000),
        ("4천만~5천만원", 40000000, 50000000),
        ("4천만원에서 5천만원 사이", 40000000, 50000000),
    ],
)
def test_범위_표현은_범위로_읽는다(text: str, low: int, high: int) -> None:
    parsed = parse_amount(text)

    assert isinstance(parsed, Range)
    assert (parsed.low, parsed.high) == (low, high)


def test_대략적_표현은_넓게_잡는다() -> None:
    """좁게 잡으면 경계를 안 걸쳐서 잘못 통과시킨다. 넓게 잡아 물어보게 하는 편이 안전하다."""
    parsed = parse_amount("5천만원쯤")

    assert isinstance(parsed, Range)
    assert parsed.low < 50000000 < parsed.high


# --- 읽지 못하는 것 ---


@pytest.mark.parametrize(
    "text",
    [
        "",
        "잘 모르겠어요",
        "적당히 벌어요",
        "작년보다 조금 올랐어요",
    ],
)
def test_읽지_못하면_None을_준다(text: str) -> None:
    """추측한 숫자가 들어오는 것보다 모른다가 낫다."""
    assert parse_amount(text) is None


def test_단위가_없으면_읽지_않는다() -> None:
    """'4천'만으로는 4천원인지 4천만원인지 알 수 없다.

    맥락을 채우는 것은 LLM의 몫이다. 파서가 짐작하면 자릿수가 세 자리 틀린다.
    """
    assert parse_amount("4천") is None


# --- 범위 자체의 동작 ---


def test_범위는_기준과_비교해_참_거짓_모름을_준다() -> None:
    """엔진이 이미 쓰는 세 값 논리에 그대로 들어간다."""
    사천_후반 = Range(45000000, 50000000)

    assert 사천_후반.compare_lte(50000000) is True  # 전체가 기준 안
    assert 사천_후반.compare_lte(40000000) is False  # 전체가 기준 밖
    assert 사천_후반.compare_lte(47000000) is None  # 걸침 — 물어봐야 함


def test_범위가_한_점이면_숫자처럼_동작한다() -> None:
    정확한_값 = Range(50000000, 50000000)

    assert 정확한_값.compare_lte(50000000) is True
    assert 정확한_값.compare_gte(50000001) is False

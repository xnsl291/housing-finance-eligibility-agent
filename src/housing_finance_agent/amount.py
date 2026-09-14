"""한국어 금액 표현을 숫자로 바꾼다.

**자릿수를 한 번 틀리면 판정이 통째로 뒤집힌다.** 소득 4천만원이 4억이 되면 탈락하고
400만원이 되면 통과한다. 그래서 이 변환을 LLM에 맡기지 않는다. LLM은 맥락을 읽어
표현을 정리하고(`연봉 4천` → `4천만원`, `월 300` → 월 단위 표시), 숫자로 바꾸는 것은
테스트된 코드가 한다.

**읽지 못하면 억지로 읽지 않는다.** 추측한 숫자가 들어오는 것보다 "모른다"가 낫다.
단위가 없는 `4천`은 4천원인지 4천만원인지 알 수 없으므로 읽지 않는다. 짐작하면
자릿수가 세 자리 틀린다.

대략적인 표현(`4천 후반대`)은 범위로 읽는다. 정확한 값을 몰라도 범위 전체가 기준
한쪽에 떨어지면 판정이 된다. 범위를 좁게 잡으면 경계를 안 걸쳐서 잘못 통과시키므로
넓게 잡는다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_억 = 100_000_000
_만 = 10_000

# 값을 확정하는 꼬리말. 떼어내고 숫자만 읽는다.
_EXACT_SUFFIX = re.compile(r"(이하|이상|미만|초과)$")
# 값을 흐리는 꼬리말. 범위로 읽는다.
_FUZZY_SUFFIX = re.compile(r"(쯤|정도|가량|남짓|언저리)$")


@dataclass(frozen=True, slots=True)
class Range:
    """구간으로만 아는 값.

    엔진이 이미 쓰는 세 값 논리(참·거짓·모름)에 그대로 들어간다. 구간 전체가 기준
    안이면 참, 전체가 밖이면 거짓, 걸치면 모름이다. 모름이면 화면이 정확한 값을 묻는다.
    """

    low: int
    high: int

    def compare_lte(self, threshold: float) -> bool | None:
        if self.high <= threshold:
            return True
        return False if self.low > threshold else None

    def compare_lt(self, threshold: float) -> bool | None:
        if self.high < threshold:
            return True
        return False if self.low >= threshold else None

    def compare_gte(self, threshold: float) -> bool | None:
        if self.low >= threshold:
            return True
        return False if self.high < threshold else None

    def compare_gt(self, threshold: float) -> bool | None:
        if self.low > threshold:
            return True
        return False if self.high <= threshold else None


def parse_amount(text: str) -> int | Range | None:
    """금액 표현 하나를 읽는다. 읽지 못하면 None."""
    cleaned = text.replace(",", "").replace(" ", "").strip()
    if not cleaned:
        return None
    return _parse_range(cleaned) or _parse_exact(cleaned)


def _parse_range(text: str) -> Range | None:
    between = _split_between(text)
    if between:
        low, high = (_parse_base(part) for part in between)
        return Range(low, high) if low is not None and high is not None else None

    for pattern, share in (("후반", (0.5, 1.0)), ("초반", (0.0, 0.5)), ("중반", (0.25, 0.75))):
        if text.endswith(pattern) or text.endswith(pattern + "대"):
            return _spread(text.removesuffix("대").removesuffix(pattern), *share)

    if text.endswith("대"):
        return _spread(text.removesuffix("대"), 0.0, 1.0)

    if _FUZZY_SUFFIX.search(text):
        # "5천만원쯤"은 5천만원 언저리다. 어느 쪽으로 벗어났는지 모르므로 양쪽으로 연다.
        base = _parse_base(_FUZZY_SUFFIX.sub("", text))
        return Range(int(base * 0.9), int(base * 1.1)) if base else None

    return None


def _split_between(text: str) -> tuple[str, str] | None:
    """`4천만~5천만원`, `4천만원에서 5천만원 사이` 형태를 둘로 가른다."""
    trimmed = text.removesuffix("사이")
    for separator in ("~", "∼", "-", "에서", "부터"):
        if separator in trimmed:
            left, _, right = trimmed.partition(separator)
            if left and right:
                return left, right
    return None


def _spread(text: str, low_share: float, high_share: float) -> Range | None:
    """`4천 후반대`처럼 자릿수만 아는 표현을 범위로 편다.

    한 칸의 크기는 앞에 붙은 숫자로 역산한다. `4천만`이면 4가 붙어 있으므로 한 칸이
    1천만이고, `1억`이면 한 칸이 1억이다.
    """
    base = _parse_base(text)
    leading = re.search(r"\d+(?:\.\d+)?", text)
    if base is None or leading is None or float(leading.group()) == 0:
        return None
    step = base / float(leading.group())
    return Range(int(base + step * low_share), int(base + step * high_share))


def _parse_base(text: str) -> int | None:
    """숫자를 읽되, 단위가 빠졌으면 만 단위로 본다.

    `4천 후반대`의 `4천`은 문맥상 4천만원이다. 다만 이 보정은 범위 표현 안에서만 한다
    — 단독으로 온 `4천`은 여전히 읽지 않는다.
    """
    return _parse_exact(text) or _parse_exact(f"{text}만")


def _parse_exact(text: str) -> int | None:
    rest = _EXACT_SUFFIX.sub("", text).removesuffix("원")
    if not rest:
        return None

    total = 0.0
    found = False

    if "억" in rest:
        left, _, rest = rest.partition("억")
        counted = _digits(left) if left else 1.0
        if counted is None:
            return None
        total += counted * _억
        found = True

    if rest:
        if "만" in rest:
            left, _, rest = rest.partition("만")
            counted = _digits(left) if left else 1.0
            if counted is None:
                return None
            total += counted * _만
            found = True
        elif found:
            # 억 뒤에 만 없이 오는 천·백은 천만·백만을 뜻한다. `1억8천`은 1억 8천만원이다.
            counted = _digits(rest)
            if counted is None:
                return None
            total += counted * _만
            rest = ""
        elif rest.isdigit():
            # 단위가 하나도 없는 순수 숫자는 원으로 본다.
            total += float(rest)
            found = True
            rest = ""
        else:
            return None

    if rest:
        if not rest.isdigit():
            return None
        total += float(rest)

    return int(total) if found else None


def _digits(text: str) -> float | None:
    """`2천2백` 같은 묶음을 숫자로. 천·백·십이 하나도 없으면 그대로 숫자로 읽는다."""
    if not text:
        return None
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        return float(text)

    total = 0.0
    found = False
    for unit, multiplier in (("천", 1000), ("백", 100), ("십", 10)):
        match = re.search(rf"(\d+(?:\.\d+)?)?{unit}", text)
        if match:
            found = True
            counted = float(match.group(1)) if match.group(1) else 1.0
            total += counted * multiplier
            text = text.replace(match.group(0), "", 1)

    if text:
        if not text.isdigit():
            return None
        total += float(text)
        found = True

    return total if found else None

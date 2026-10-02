"""문장에서 신청자 조건을 뽑는다.

**이 시스템에서 LLM이 닿는 유일한 자리다.** 판정과 계산은 LLM이 못 건드린다.
그래서 여기의 관심사는 "잘 뽑는가"보다 **"잘못 뽑은 것을 걸러내는가"**다.

걸러내는 기준이 셋이다.

1. 모르는 항목 이름은 버린다
2. 정해진 값이 아니면 버린다 — 세대주 여부에 `가장`이 오면 쓸 수 없다
3. 금액은 LLM이 준 숫자를 믿지 않는다. 표현을 받아 파서가 바꾼다

**버린 것은 값이 없는 상태가 된다. 억지로 고치지 않는다.** 뽑은 결과는 그대로
판정에 들어가지 않고 사용자 확인을 거친다(계획서 §13.3).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Protocol

from housing_finance_agent.amount import parse_amount
from housing_finance_agent.fields import AMOUNT as _AMOUNT
from housing_finance_agent.fields import DESCRIPTIONS as _DESCRIPTIONS
from housing_finance_agent.fields import SPEC as _FIELDS


class LlmClient(Protocol):
    def generate(self, prompt: str) -> str: ...


class ExtractionError(Exception):
    """뽑기에 실패했다. 부분 결과를 쓰지 않는다."""


# 받지 않기로 한 정보(계획서 §12). 문장에 있으면 저장하지 않고 알린다.
# 앞뒤로 숫자가 더 붙은 경우를 걸러야 한다. 앞이 없으면 "2026-10-01"의
# "026-10-01"이 계좌번호로 잡힌다. 잔금지급일과 전입일이 필수 입력이라
# 데모에서 반드시 걸리던 자리다(2026-09-14 검수).
_SENSITIVE = (
    (re.compile(r"(?<!\d)\d{6}\s*-\s*\d{7}(?!\d)"), "주민등록번호"),
    (re.compile(r"(?<!\d)\d{2,3}-\d{2,6}-\d{2,6}(?!\d)"), "계좌번호"),
)


@dataclass(frozen=True, slots=True)
class ExtractedProfile:
    values: dict[str, object] = field(default_factory=dict)
    # 각 값을 문장 어디에서 읽었는지. 화면이 "나이 29세 ← '만 29세'"로 보여 준다.
    sources: dict[str, str] = field(default_factory=dict)
    # 금액 표현이었으나 숫자로 읽지 못한 것. 빈칸만 보여 주면 무엇을 고칠지 모른다.
    unreadable: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def extract_profile(llm: LlmClient, text: str) -> ExtractedProfile:
    """문장 하나에서 조건을 뽑는다."""
    warnings = _sensitive_warnings(text)
    raw = _ask(llm, text)

    values: dict[str, object] = {}
    unreadable: dict[str, str] = {}
    sources = {
        name: str(phrase)
        for name, phrase in (raw.get("_sources") or {}).items()
        if name in _FIELDS
    }

    for name, given in raw.items():
        if name not in _FIELDS or given is None:
            continue
        if _평으로_말했나(name, sources):
            # 산수가 안 되는 게 아니다. 1평 = 3.3058㎡는 확정된 상수다.
            #
            # 문제는 **어느 면적인지가 문장으로 정해지지 않는다는 것**이다. 한국에서
            # "25평 아파트"는 보통 공급면적을 말하고, 규칙이 보는 것은 전용면적이다.
            # 25 × 3.3058 = 82.6㎡로 환산하면 실제 전용면적(보통 59㎡ 근처)과 크게
            # 다르고, "25평 → 전용 몇 ㎡"는 단지마다 달라 공개 자료에 고정 대응이 없다.
            #
            # 그대로 두면 **전용 82㎡인 집이 60㎡ 특례를 통과한다**(2026-09-22 측정
            # E-18). 잘못 통과시키는 방향이라 가장 위험하다.
            #
            # 그래서 버리고 원문을 남긴다. 단위가 빠진 금액(`4천`)을 파서가 거절하는
            # 것과 같은 자리다 — 문장이 값을 정하지 못하면 사람에게 넘긴다.
            unreadable[name] = str(sources.get(name) or given)
            continue
        if _FIELDS[name] is _AMOUNT:
            parsed = parse_amount(str(given))
            if parsed is None:
                unreadable[name] = str(given)
            else:
                values[name] = parsed
            continue
        accepted = _accept(_FIELDS[name], given)
        if accepted is not None:
            values[name] = accepted

    return ExtractedProfile(
        values=values, sources=sources, unreadable=unreadable, warnings=warnings
    )


# 면적을 평으로 말한 경우를 알아보는 데 쓴다. 전용면적만 이 문제가 있다 —
# 금액은 파서가 단위를 보고, 나머지 항목에는 평 단위가 없다.
_평_항목 = "housing_area_m2"


def _평으로_말했나(name: str, sources: dict[str, str]) -> bool:
    return name == _평_항목 and "평" in (sources.get(name) or "")


def _ask(llm: LlmClient, text: str) -> dict:
    """LLM을 부르고 JSON으로 읽는다. 깨지면 한 번만 다시 부른다(계획서 §13.9).

    두 번 다 깨지면 실패로 끝낸다. 부분 결과를 쓰면 무엇이 빠졌는지 모르는 프로필이
    판정에 들어간다.
    """
    prompt = build_prompt(text)
    for _ in range(2):
        try:
            parsed = json.loads(_strip_fence(llm.generate(prompt)))
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ExtractionError("LLM 응답을 JSON으로 읽지 못함")


def _strip_fence(reply: str) -> str:
    """```json 으로 감싸 오는 경우가 있다. 모델이 흔히 하는 일이라 여기서 벗긴다."""
    stripped = reply.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[a-zA-Z]*\n?", "", stripped)
        stripped = re.sub(r"\n?```$", "", stripped)
    return stripped


def _accept(spec: object, given: object) -> object | None:
    """정해진 값인지 본다. 아니면 None — 버린다는 뜻이다."""
    if isinstance(spec, list):
        return given if given in spec else None
    if spec is bool:
        # **거짓은 버린다.** 불리언 항목은 전부 "직접 말한 경우만 true"로 정의돼 있고
        # (fields.DESCRIPTIONS), 모델이 내는 false는 말했다는 뜻이 아니라 기본값이다.
        #
        # 2026-09-22 측정에서 환각 15건 중 12건이 이 두 항목에 false를 채운 것이었다
        # (`evaluation/extraction/report-2026-09-22.md`). 그냥 두면 판정이 조용히
        # 망가진다 — 두 항목은 소득 기준을 올려 주는 '푸는 특례'이고, 엔진은 적용
        # 여부를 모를 때 사용자에게 묻도록 `relaxes: true`로 만들어 두었다. 추출이
        # false로 단정하면 엔진이 물어볼 기회를 잃고 해당자를 탈락시킨다.
        #
        # 버리면 "모름"으로 남아 확인 화면의 예/아니오/모름에서 사용자가 직접 고른다.
        # 진짜로 "아니다"라고 말한 사람에게 한 번 더 묻는 비용은, 해당자를 조용히
        # 탈락시키는 것보다 싸다.
        return True if given is True else None
    if spec is str:
        return given.strip() if isinstance(given, str) and given.strip() else None
    if spec in (int, float) and isinstance(given, int | float) and not isinstance(given, bool):
        return spec(given)
    return None


def scrub(text: str) -> str:
    """민감정보로 보이는 부분을 가린다. **저장하기 전에 통과시킨다.**

    세션이 근거 구절(값을 문장 어디에서 읽었나)을 남기는데, 사용자가 문장에 주민번호를
    적었고 모델이 그걸 어느 항목의 근거로 붙이면 그대로 저장된다. 경고만으로는
    부족하다 — 경고는 화면에 뜨고 사라지지만 저장된 값은 남는다.

    **같은 정규식을 쓴다.** 여기에 따로 적으면 한쪽만 고쳐져서, 경고는 뜨는데 저장은
    안 가려지는 상태가 된다.
    """
    가린 = text
    for pattern, label in _SENSITIVE:
        가린 = pattern.sub(f"[{label} 가림]", 가린)
    return 가린


def _sensitive_warnings(text: str) -> list[str]:
    """받지 않기로 한 정보가 있으면 알린다. **값 자체는 경고문에 담지 않는다.**"""
    return [
        f"{label}로 보이는 내용이 있어 저장하지 않았습니다"
        for pattern, label in _SENSITIVE
        if pattern.search(text)
    ]


def build_prompt(text: str) -> str:
    """뽑을 항목과 받아들일 값을 적어 준다.

    무엇을 뽑아야 하는지 알려 주지 않으면 모델이 아무 이름이나 만든다. 그리고
    **없는 값을 추측하지 말라고 분명히 적는다** — 추측한 값이 판정을 뒤집는다.

    금액은 숫자로 바꾸지 말라고 한다. 자릿수를 틀려도 아무도 모르기 때문이고,
    그 변환은 테스트된 파서가 맡는다.
    """
    lines = []
    for name, spec in _FIELDS.items():
        뜻 = _DESCRIPTIONS.get(name, "")
        if spec is _AMOUNT:
            형식 = '금액 표현 그대로 (예: "4천만원", "1억8천")'
        elif isinstance(spec, list):
            형식 = " | ".join(spec)
        else:
            형식 = getattr(spec, "__name__", str(spec))
        lines.append(f"- {name} ({형식}): {뜻}")
    fields = "\n".join(lines)

    return f"""아래 문장에서 대출 신청 조건을 뽑아 JSON 하나로만 답하세요.

뽑을 항목:
{fields}

규칙:
- 문장에 없는 항목은 값을 null로 두세요. **추측하지 마세요.**
- **true/false 항목은 문장에 그렇다고 직접 쓰여 있을 때만 true로 하세요.**
  그럴듯하다는 이유로 true를 만들면 안 됩니다.
- 금액은 숫자로 바꾸지 마세요. 표현을 그대로 주되 **단위가 빠졌으면 채워 주세요.**
  "연봉 4천" → "4천만원", "전세 3억" → "3억", "연 7천" → "7천만원"
  단위를 채울 수 없으면 그 항목은 null로 두세요.
- 월 단위 소득이면 "월 300만원"처럼 월이라고 적어 주세요.
- 목록이 있는 항목은 그 목록의 값만 쓰세요.
- 각 값을 문장의 어느 부분에서 읽었는지 "_sources"에 함께 담으세요.
  **읽은 근거를 댈 수 없으면 그 항목은 null로 두세요.**
- JSON 외에 다른 말은 쓰지 마세요.

예시 1
문장: 만 29세 무주택 세대주이고 연봉 4천만원입니다
답: {{"age": 29, "household_head_status": "HEAD", \
"home_ownership_status": "NO_HOME_ALL_MEMBERS", "combined_annual_income_krw": "4천만원", \
"_sources": {{"age": "만 29세", "combined_annual_income_krw": "연봉 4천만원"}}}}

예시 2 (정확한 값을 모를 때도 표현 그대로 담습니다)
문장: 대전에서 전세 알아보는데 소득은 4천 후반대예요
답: {{"region_name": "대전", "combined_annual_income_krw": "4천 후반대", \
"_sources": {{"region_name": "대전에서", "combined_annual_income_krw": "소득은 4천 후반대"}}}}

문장: {text}
답:"""

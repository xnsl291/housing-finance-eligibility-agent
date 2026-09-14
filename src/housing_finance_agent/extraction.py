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


class LlmClient(Protocol):
    def generate(self, prompt: str) -> str: ...


class ExtractionError(Exception):
    """뽑기에 실패했다. 부분 결과를 쓰지 않는다."""


# 뽑을 항목과 받아들일 값.
#
# - `AMOUNT`는 LLM이 표현 그대로 주고 파서가 숫자로 바꾼다
# - 목록이 있는 항목은 그 안의 값만 받는다
# - 나머지는 타입만 본다
_AMOUNT = "AMOUNT"
_FIELDS: dict[str, object] = {
    "age": int,
    "household_head_status": ["HEAD", "PROSPECTIVE_HEAD"],
    "household_type": ["SINGLE", "MULTI"],
    "home_ownership_status": ["NO_HOME_ALL_MEMBERS", "HAS_HOME"],
    "marital_status": ["SINGLE", "MARRIED", "NEWLYWED"],
    "minor_children_count": int,
    "region": ["CAPITAL_AREA", "NON_CAPITAL_AREA"],
    "employment_category": ["SME_OR_MID_SIZED", "OTHER"],
    "military_service_years": int,
    "housing_area_m2": float,
    "deposit_paid_ratio": float,
    "is_innovation_city_relocated_worker": bool,
    "is_redevelopment_area_tenant": bool,
    "combined_annual_income_krw": _AMOUNT,
    "net_asset_krw": _AMOUNT,
    "lease_deposit_krw": _AMOUNT,
    "housing_value_krw": _AMOUNT,
}

# 받지 않기로 한 정보(계획서 §12). 문장에 있으면 저장하지 않고 알린다.
_SENSITIVE = (
    (re.compile(r"\d{6}\s*-\s*\d{7}"), "주민등록번호"),
    (re.compile(r"\d{2,3}-\d{2,6}-\d{2,6}"), "계좌번호로 보이는 숫자"),
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
        return given if isinstance(given, bool) else None
    if spec in (int, float) and isinstance(given, int | float) and not isinstance(given, bool):
        return spec(given)
    return None


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
        if spec is _AMOUNT:
            lines.append(f"- {name}: 금액 표현을 그대로 (예: \"4천만원\", \"1억8천\")")
        elif isinstance(spec, list):
            lines.append(f"- {name}: {' | '.join(spec)} 중 하나")
        else:
            lines.append(f"- {name}: {getattr(spec, '__name__', spec)}")
    fields = "\n".join(lines)

    return f"""아래 문장에서 대출 신청 조건을 뽑아 JSON 하나로만 답하세요.

뽑을 항목:
{fields}

규칙:
- 문장에 없는 항목은 값을 null로 두세요. **추측하지 마세요.**
- 금액은 숫자로 바꾸지 말고 문장에 쓰인 표현을 그대로 주세요.
- 월 단위 소득이면 "월 300만원"처럼 월이라고 적어 주세요.
- 목록이 있는 항목은 그 목록의 값만 쓰세요.
- 각 값을 문장의 어느 부분에서 읽었는지 "_sources"에 함께 담으세요.
- JSON 외에 다른 말은 쓰지 마세요.

예시
문장: 만 29세 무주택 세대주이고 연봉 4천만원입니다
답: {{"age": 29, "household_head_status": "HEAD", \
"home_ownership_status": "NO_HOME_ALL_MEMBERS", "combined_annual_income_krw": "4천만원", \
"_sources": {{"age": "만 29세", "combined_annual_income_krw": "연봉 4천만원"}}}}

문장: {text}
답:"""

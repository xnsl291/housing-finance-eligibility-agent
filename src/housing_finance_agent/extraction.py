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
    # 수도권인지는 LLM에게 묻지 않는다. 아래 _REGION 주석 참고.
    "region_name": str,
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

# 항목 이름만 주면 모델이 뜻을 짐작한다. 2026-09-14 실물 확인에서 세 가지가 틀렸다.
#
# - "경기도에 살아요"를 NON_CAPITAL_AREA로 읽었다. 수도권 정의가 없었다
# - "전세 1억짜리 원룸 알아보는 중"을 재개발 구역 세입자 True로 만들었다. 근거가 없다
# - "서울 전세 3억"을 주택가격에 넣었다. 임차보증금과 구분이 없었다
#
# 셋 다 판정을 뒤집는 값이라 항목마다 뜻을 적어 준다.
_DESCRIPTIONS = {
    "age": "만 나이",
    "household_head_status": "세대주면 HEAD, 아직 아니고 예정이면 PROSPECTIVE_HEAD",
    "household_type": "혼자 사는 단독세대면 SINGLE, 아니면 MULTI",
    "home_ownership_status": "세대원 전원 무주택이면 NO_HOME_ALL_MEMBERS",
    "marital_status": "혼인 7년 이내면 NEWLYWED, 그 외 기혼이면 MARRIED, 미혼이면 SINGLE",
    "minor_children_count": "미성년 자녀 수",
    "region_name": '임차할 주택이 있는 지역 이름을 그대로 (예: "서울", "경기도 성남시", "부산")',
    "employment_category": "중소기업 또는 중견기업 재직이면 SME_OR_MID_SIZED, 그 외 OTHER",
    "military_service_years": "병역 복무기간(년)",
    "housing_area_m2": "임차 전용면적(제곱미터)",
    "deposit_paid_ratio": "임차보증금 중 이미 지급한 비율(0~1)",
    "is_innovation_city_relocated_worker": (
        "혁신도시 이전 공공기관 종사자라고 **직접 말한 경우만** true"
    ),
    "is_redevelopment_area_tenant": "재개발 구역에서 이주하는 세입자라고 **직접 말한 경우만** true",
    "combined_annual_income_krw": "본인과 배우자의 연간 합산 소득",
    "net_asset_krw": "본인과 배우자의 합산 순자산",
    "lease_deposit_krw": "전세보증금 또는 임차보증금. **'전세 3억'은 여기다**",
    "housing_value_krw": "주택의 매매가격. 전세보증금과 다르다",
}

# 수도권 여부는 LLM에게 맡기지 않는다.
#
# 프롬프트에 "서울·인천·경기는 CAPITAL_AREA"라고 굵게 적어도 4B 모델이 "경기도에
# 살아요"를 NON_CAPITAL_AREA로 계속 읽었다(2026-09-14 실물 확인, 프롬프트 보강 후
# 재측정에서도 동일). **프롬프트로 고쳐지지 않는 종류다.**
#
# 이 값은 판정을 뒤집는다 — 일반 버팀목의 보증금 상한이 수도권 3억, 그 외 2억이고
# 한도도 1.2억과 8천만원으로 갈린다. 금액을 파서가 맡은 것과 같은 이유로 여기도
# 코드가 정한다. LLM은 지역 이름만 뽑는다.
#
# 근거: 상품 안내의 금리 항목에 "지방 소재(서울, 인천, 경기지역 이외)"라고 적혀 있다.
_CAPITAL_AREA_KEYWORDS = ("서울", "인천", "경기")

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

    지역명 = values.get("region_name")
    if isinstance(지역명, str) and 지역명.strip():
        values["region"] = (
            "CAPITAL_AREA"
            if any(keyword in 지역명 for keyword in _CAPITAL_AREA_KEYWORDS)
            else "NON_CAPITAL_AREA"
        )

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
    if spec is str:
        return given.strip() if isinstance(given, str) and given.strip() else None
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

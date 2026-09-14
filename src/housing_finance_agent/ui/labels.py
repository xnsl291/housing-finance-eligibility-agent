"""화면 표기 변환.

금액과 판정 코드를 사람이 읽는 문구로 바꾼다. **표기만 바꾸고 값을 바꾸지 않는다.**
여기서 반올림하거나 없는 값을 채우면 화면이 판정에 없는 사실을 만들어 내게 된다.

항목 이름과 허용값은 여기 없다. 그것은 `GET /v1/fields`가 정본이고, 화면이 따로
적으면 항목이 하나 늘 때 두 곳이 갈라진다. 여기 두는 것은 API가 내려 주지 않는
표기, 즉 금액 서식과 판정·규칙 결과 코드의 한국어 이름뿐이다.

모르는 코드는 지어내지 않고 코드 그대로 돌려준다. 엔진에 상태가 하나 늘었을 때
화면이 엉뚱한 한국어를 붙이는 것보다 낯선 코드가 보이는 편이 낫다.
"""

from __future__ import annotations

_억 = 100_000_000
_만 = 10_000

# 판정 상태 네 가지. `승인`, `자격 있음` 같은 확정 표현을 쓰지 않는다. 이 도구는
# 신청 전 가늠이고 심사는 기관이 한다.
STATUS_LABELS: dict[str, str] = {
    "PRECHECK_MATCH": "사전 조건 부합",
    "CONDITIONAL": "추가 확인 필요",
    "NOT_MATCHED": "조건 불충족",
    "INSUFFICIENT_INFORMATION": "정보 부족",
}

# 규칙 하나하나의 결과. 통과·불충족만 보여 주면 "내 조건인데 왜 이 규칙은 안
# 보이나"에 답을 못 한다. 빠진 이유까지 이름을 붙인다.
OUTCOME_LABELS: dict[str, str] = {
    "PASSED": "통과",
    "FAILED": "불충족",
    "SUPERSEDED": "특례로 대체됨",
    "NOT_APPLICABLE": "적용 대상 아님",
    "MISSING_VALUE": "값 없음",
    "IMPRECISE": "값이 기준에 걸쳐 판단 불가",
    "NOT_REVIEWED": "검수 전이라 판정에 쓰지 않음",
}


def status_label(status: str) -> str:
    return STATUS_LABELS.get(status, status)


def outcome_label(outcome: str) -> str:
    return OUTCOME_LABELS.get(outcome, outcome)


def amount_text(value: object) -> str:
    """금액을 읽기 쉬운 한국어 표기로 바꾼다.

    `40000000`을 `40,000,000원`으로 쓰면 자릿수를 세어야 한다. 이 화면에서 사용자가
    확인해야 하는 것이 바로 자릿수라서(소득 4천만원이 4억이 되면 판정이 뒤집힌다)
    억·만 단위로 끊어 준다.

    범위는 `{"low": .., "high": ..}`로 들어온다. 뒤쪽에만 `원`을 붙여
    `4,500만~5,000만원`처럼 읽히게 한다.

    만원 단위로 떨어지지 않는 값은 끊지 않고 그대로 쓴다. `4,000만 3,210원`처럼
    쪼개면 오히려 읽기 어렵다.
    """
    if value is None:
        return ""
    if isinstance(value, dict) and {"low", "high"} <= value.keys():
        return f"{_금액_몸통(value['low'])}~{_금액_몸통(value['high'])}원"
    if isinstance(value, bool) or not isinstance(value, int | float):
        return str(value)
    return f"{_금액_몸통(value)}원"


def _금액_몸통(value: object) -> str:
    """`원`을 뗀 금액 표기. 범위를 `4,500만~5,000만원`으로 쓰려면 뒤쪽만 `원`이 붙는다."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return str(value)
    if value == 0:
        return "0"
    if value != int(value) or int(value) % _만 != 0:
        return f"{value:,}"

    남은 = int(value)
    부호 = "-" if 남은 < 0 else ""
    남은 = abs(남은)
    억, 만 = divmod(남은 // _만, _만)
    if 억 and 만:
        return f"{부호}{억:,}억 {만:,}만"
    if 억:
        return f"{부호}{억:,}억"
    return f"{부호}{만:,}만"

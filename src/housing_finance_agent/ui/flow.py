"""화면 흐름에서 쓰는 계산. Streamlit을 부르지 않는다.

화면 코드는 Streamlit이 그려서 테스트하기 어렵다. 그래서 **판단이 들어가는 조각을
여기로 떼어** 테스트한다. 무엇을 서버로 보낼지, 멈춘 이유를 어떻게 말할지, 기록을
어떻게 읽어 줄지가 여기 있다.

여기서도 업무 판단은 하지 않는다. 다음에 무엇을 물을지는 서버(`next_action.py`)가
정하고, 화면은 받은 것을 사람이 읽을 말로 바꾸기만 한다.
"""

from __future__ import annotations

from housing_finance_agent.ui.labels import amount_text


def extracted_from(response: dict) -> dict:
    """세션에 문장을 넣은 응답을 확인 화면이 읽는 모양으로 편다.

    세션 응답은 값마다 출처가 붙은 모양(`{"value", "source", "phrase"}`)이고, 확인
    화면은 값·근거 구절·못 읽은 것·경고를 따로 받는다. 확인 화면을 세션에 맞춰
    다시 쓰는 대신 여기서 한 번 바꾼다.
    """
    values = response.get("values") or {}
    return {
        "values": {name: held["value"] for name, held in values.items()},
        "sources": {name: held["phrase"] for name, held in values.items() if held.get("phrase")},
        "unreadable": response.get("unreadable") or {},
        "warnings": response.get("warnings") or [],
    }


def confirm_updates(read_values: dict, confirmed: dict) -> dict:
    """확인 화면에서 서버로 보낼 것. 읽은 값과 달라진 것만 보낸다.

    - 고친 값, 새로 채운 값 → 그 값
    - 읽었는데 사용자가 비운 값 → `None` (서버에서 "모른다"로 되돌린다)
    - 그대로 둔 값 → 보내지 않는다

    **그대로 둔 값을 다시 보내지 않는다.** 보내면 출처가 "문장에서 읽음"에서 "직접
    넣음"으로 바뀌어, 나중에 기록을 볼 때 사용자가 무엇을 고쳤는지 구분이 안 된다.
    """
    updates = {name: value for name, value in confirmed.items() if read_values.get(name) != value}
    for name in read_values:
        if name not in confirmed:
            updates[name] = None
    return updates


def _이름들(fields: list[str], catalog: dict) -> str:
    return ", ".join(catalog.get(name, {}).get("label", name) for name in fields)


USER_STOPPED = "USER_STOPPED"


def stop_message(reason: str, declined_needed: list[str], catalog: dict) -> tuple[str, str]:
    """멈춘 이유를 사람이 읽을 말로. (표시 종류, 문구)

    **"물을 게 없어서 멈춤"과 "모르셔서 멈춤"을 다르게 말한다(D-27·D-31).** 둘을 같게
    말하면 사용자는 확정되지 않은 결과를 확정된 것으로 읽는다.

    확정 표현(`승인`, `자격 있음`)을 쓰지 않는다.
    """
    if reason == "COMPLETE":
        return "success", "판정에 필요한 항목을 모두 확인했습니다."
    if reason == "ALL_NOT_MATCHED":
        return "info", (
            "확인한 조건으로는 남은 상품 모두 조건에 맞지 않아 더 묻지 않았습니다. "
            "아래에서 어느 조건 때문인지 확인할 수 있습니다."
        )
    if reason == "ONLY_DECLINED_LEFT":
        return "warning", (
            f"{_이름들(declined_needed, catalog)}을(를) 모르셔서 확정하지 못한 부분이 있습니다. "
            "확인되면 이어서 판정할 수 있습니다."
        )
    if reason == USER_STOPPED:
        return "warning", "질문을 중간에 멈췄습니다. 지금까지 확인한 값으로만 판정했습니다."
    return "info", "판정했습니다."


def _값_보기(value: object, spec: dict) -> str:
    if isinstance(value, dict) and {"low", "high"} <= value.keys():
        return amount_text(value)
    if spec.get("kind") == "AMOUNT" and isinstance(value, int):
        return amount_text(value)
    if isinstance(value, bool):
        return "예" if value else "아니오"
    표기 = spec.get("choice_labels") or {}
    return str(표기.get(value, value))


def trace_lines(events: list[dict], catalog: dict) -> list[str]:
    """세션 기록을 "무엇을 어떤 순서로 확인했나"로 읽어 준다(Decision Trace 일부).

    결과 화면은 규칙마다 어떻게 됐는지를 이미 보여 준다. 여기서 더하는 것은 **값이
    어디서 왔는지** — 문장에서 읽었는지, 확인 화면에서 고쳤는지, 질문에 답했는지,
    모른다고 했는지다. 같은 판정이라도 모른다고 한 항목이 있으면 무게가 다르다.
    """
    lines = []
    for event in events:
        kind = event["kind"]
        payload = event.get("payload") or {}
        if kind == "EXTRACTED":
            읽은 = list((payload.get("values") or {}).keys())
            if 읽은:
                lines.append(f"문장에서 읽음 — {_이름들(읽은, catalog)}")
        elif kind == "FIELD_SET":
            for name, value in (payload.get("values") or {}).items():
                label = catalog.get(name, {}).get("label", name)
                if value is None:
                    lines.append(f"{label} — 비움")
                else:
                    lines.append(f"{label} — {_값_보기(value, catalog.get(name, {}))}")
        elif kind == "FIELD_DECLINED":
            label = catalog.get(payload.get("field"), {}).get("label", payload.get("field"))
            lines.append(f"{label} — 모른다고 함")
        elif kind == "ASSESSED":
            lines.append("판정함")
    return lines

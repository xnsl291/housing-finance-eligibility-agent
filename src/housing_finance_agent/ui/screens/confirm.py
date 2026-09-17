"""화면 2 — 읽은 내용 확인.

**이 프로젝트의 핵심이 이 화면이다.** 2026-09-14 실물 확인에서 LLM이 "경기도에
살아요"를 비수도권으로 읽고, "전세 1억짜리 원룸 알아보는 중"을 재개발 구역 세입자로
만들었다. 둘 다 판정을 뒤집는 값이다. 사람이 보고 고치지 않으면 잘못 읽은 조건으로
판정이 돌고, 그 결과는 안 보여 주는 것보다 해롭다.

**항목 이름과 허용값을 여기 적지 않는다.** `GET /v1/fields`가 정본이다. 화면이 따로
적으면 항목이 하나 늘 때 두 곳을 고쳐야 하고, 한쪽만 고치면 화면에 없는 항목을
LLM이 뽑는다.

**화면이 값을 보정하지 않는다.** 빈칸은 빈칸으로 보낸다. 화면이 기본값을 채우면
판정은 사용자가 말한 적 없는 조건으로 돌고, 근거를 붙인다는 이 도구의 주장이 깨진다.
수도권 여부도 여기서 계산하지 않는다. 사용자는 지역 이름만 고치고 수도권인지는
서버가 정한다.
"""

from __future__ import annotations

import streamlit as st

from housing_finance_agent.ui import api_client, chrome
from housing_finance_agent.ui.labels import amount_text

# 입력 칸의 세션 키 앞자리. 문장을 다시 읽었을 때 이전 문장의 수정값이 남지 않게
# 한꺼번에 지우려면 앞자리가 필요하다.
KEY_PREFIX = "field:"

_BOOL_OPTIONS = ("예", "아니오", "모름")
# 체크박스를 쓰지 않는다. 체크하지 않은 것과 "모른다"가 구분되지 않아서, 모른다는
# 뜻이 '아니오'로 판정에 들어간다.
_BOOL_VALUES: dict[str, bool | None] = {"예": True, "아니오": False, "모름": None}


def clear_edits() -> None:
    """입력 칸에 남은 값을 지운다. 새 문장을 읽었을 때 앞 문장의 수정값이 섞이지 않게 한다."""
    for key in [key for key in st.session_state if key.startswith(KEY_PREFIX)]:
        del st.session_state[key]


def render() -> None:
    chrome.eyebrow("읽은 내용 확인")
    st.subheader("이렇게 읽었습니다")

    extracted = st.session_state.get("extracted")
    if extracted is None:
        # app.current_step이 읽은 값이 있을 때만 이 화면을 부르므로 평소에는
        # 여기까지 오지 않는다. 화면을 직접 불러 쓸 때를 위한 방어선이다.
        st.info("먼저 조건 입력 단계에서 문장을 적고 `조건 읽기`를 눌러 주세요")
        return

    try:
        catalog = api_client.fields()["fields"]
    except api_client.ApiError as error:
        st.error(f"항목 목록을 받지 못했습니다. {error}")
        return

    st.caption(
        "틀린 곳이 있으면 고쳐 주세요. 고치지 않고 넘어가면 읽은 값 그대로 판정합니다. "
        "확인 버튼을 누르기 전에는 판정하지 않습니다."
    )

    for warning in extracted.get("warnings", []):
        st.warning(warning, icon="🔒")

    values = extracted.get("values", {})
    못_읽은 = extracted.get("unreadable", {})
    읽은_항목 = [name for name in catalog if name in values or name in 못_읽은]
    빈_항목 = [name for name in catalog if name not in 읽은_항목]

    profile: dict = {}
    errors: list[str] = []

    if 읽은_항목:
        st.markdown("**문장에서 읽은 항목**")
    for name in 읽은_항목:
        _받기(name, catalog[name], extracted, profile, errors)

    with st.expander(f"비어 있는 항목 {len(빈_항목)}개 — 아는 값이 있으면 직접 채워 주세요"):
        st.caption("비워 두면 그 항목은 '모름'으로 판정합니다. 화면이 대신 채우지 않습니다.")
        for name in 빈_항목:
            _받기(name, catalog[name], extracted, profile, errors)

    st.divider()
    for message in errors:
        st.error(message)

    if st.button("이 조건으로 판정", type="primary", disabled=bool(errors)):
        if not profile:
            # 빈 프로필로 두면 판정이 돌지 않는데 성공 문구만 떠서 막다른 길이 된다.
            # 직접 입력으로 넘어온 사용자가 바로 만나는 자리다(2026-09-14 검수).
            st.error("채운 항목이 없습니다. 아는 값을 하나 이상 넣어 주세요")
            return
        st.session_state["confirmed_profile"] = profile
        # 앞선 판정 결과는 고치기 전 값으로 낸 것이라 그대로 두면 안 된다.
        st.session_state.pop("results", None)
        st.success(f"{len(profile)}개 항목으로 판정합니다")


def _받기(name: str, spec: dict, extracted: dict, profile: dict, errors: list[str]) -> None:
    """항목 하나를 그리고 사용자가 넣은 값을 `profile`에 담는다.

    빈 값은 키 자체를 넣지 않는다. 빈 문자열이나 0을 넣으면 판정 쪽에서 "모른다"가
    아니라 "그 값이다"가 된다.
    """
    label = spec.get("label", name)
    도움말 = spec.get("how_to_check")
    kind = spec.get("kind")
    읽은_값 = extracted.get("values", {}).get(name)
    못_읽은_원문 = extracted.get("unreadable", {}).get(name)

    if 못_읽은_원문:
        # 빈칸만 보여 주면 무엇을 고쳐야 하는지 모른다. 원문을 요약하지 않고 그대로 쓴다.
        st.warning(f"{label}: “{못_읽은_원문}”을 숫자로 읽지 못했습니다. 직접 넣어 주세요")

    if kind == "AMOUNT":
        value, error = _금액칸(name, label, 도움말, 읽은_값)
        if error:
            errors.append(error)
    elif kind == "CHOICE":
        선택지 = ["", *spec.get("choices", [])]
        기본 = 선택지.index(읽은_값) if 읽은_값 in 선택지 else 0
        # 화면에는 한국어를 보이고 판정에는 코드를 보낸다. 표기의 정본은
        # rules/field_guides.yaml이고 화면이 따로 들지 않는다.
        표기 = spec.get("choice_labels") or {}
        value = st.selectbox(
            label,
            선택지,
            index=기본,
            key=_key(name),
            help=도움말,
            format_func=lambda code: 표기.get(code, code) if code else "— 모름 —",
        )
    elif kind == "BOOL":
        골라진 = st.radio(
            label,
            _BOOL_OPTIONS,
            index=_bool_index(읽은_값),
            key=_key(name),
            help=도움말,
            horizontal=True,
        )
        value = _BOOL_VALUES[골라진]
    elif kind == "INT":
        value = st.number_input(
            label, value=_숫자(읽은_값, int), step=1, key=_key(name), help=도움말
        )
    elif kind == "FLOAT":
        value = st.number_input(label, value=_숫자(읽은_값, float), key=_key(name), help=도움말)
    else:
        value = st.text_input(
            label, value="" if 읽은_값 is None else str(읽은_값), key=_key(name), help=도움말
        )

    근거 = _근거_문구(value, 읽은_값, extracted.get("sources", {}).get(name))
    if 근거:
        # 빈 줄을 그리면 항목 사이가 들쭉날쭉해져서 읽기 나빠진다.
        st.caption(근거)

    if value is not None and value != "":
        profile[name] = value


def _금액칸(
    name: str, label: str, 도움말: str | None, 읽은_값: object
) -> tuple[object, str | None]:
    """금액 칸. 범위로 읽힌 값은 범위 그대로 두 칸에 보여 준다.

    범위를 한 숫자로 접어 보여 주면 사용자는 우리가 고른 숫자를 자기 값으로 착각한다.
    `4천 후반대`를 4,500만원으로 접으면 5,000만원 기준을 통과해 버리는데, 원문에는
    그런 근거가 없다.
    """
    if isinstance(읽은_값, dict) and {"low", "high"} <= 읽은_값.keys():
        st.write(f"**{label}**")
        왼쪽, 오른쪽 = st.columns(2)
        low = 왼쪽.number_input(
            "최소",
            value=_숫자(읽은_값["low"], int),
            step=10_000,
            key=_key(f"{name}:low"),
            help=도움말,
        )
        high = 오른쪽.number_input(
            "최대", value=_숫자(읽은_값["high"], int), step=10_000, key=_key(f"{name}:high")
        )
        st.caption("정확한 값을 아시면 두 칸에 같은 값을 넣어 주세요")
        if (low is None) != (high is None):
            return None, f"{label}: 범위는 두 칸을 모두 채우거나 모두 비워 주세요"
        if low is not None and low > high:
            return None, f"{label}: 최소가 최대보다 큽니다"
        return (None if low is None else {"low": int(low), "high": int(high)}), None

    value = st.number_input(
        label, value=_숫자(읽은_값, int), step=10_000, key=_key(name), help=도움말
    )
    if value is not None:
        st.caption(f"{amount_text(int(value))}")
    return (None if value is None else int(value)), None


def _근거_문구(value: object, 읽은_값: object, 원문: str | None) -> str:
    """이 값이 어디서 왔는지 한 줄로 적는다.

    사용자가 고친 값과 LLM이 읽은 값을 섞어 보여 주면, 확인 화면을 한 번 지난 뒤에는
    무엇을 자기가 고쳤는지 알 수 없다. 다시 볼 때 어디를 손댔는지 알아야 한다.
    """
    읽음 = "" if 읽은_값 is None else f"← “{원문}”에서 읽음" if 원문 else "← 문장에서 읽음"

    if _같은_값(value, 읽은_값):
        if isinstance(읽은_값, dict):
            # 범위 해석은 파서 규칙이 만든 것이라 사용자가 검증할 수 있어야 한다.
            return f"{읽음} · {amount_text(읽은_값)}으로 읽었습니다. 다르면 고쳐주세요"
        return f"{읽음}" if 읽음 else ""
    if 읽은_값 is None:
        return "✏️ 직접 넣은 값"
    return f"✏️ 고친 값 (읽은 값: {_보기(읽은_값)}) {읽음}"


def _같은_값(value: object, 읽은_값: object) -> bool:
    if isinstance(읽은_값, dict) and isinstance(value, dict):
        return int(읽은_값["low"]) == int(value["low"]) and int(읽은_값["high"]) == int(
            value["high"]
        )
    if value == "" and 읽은_값 is None:
        return True
    if isinstance(value, int | float) and isinstance(읽은_값, int | float):
        return float(value) == float(읽은_값)
    return value == 읽은_값


def _보기(value: object) -> str:
    return amount_text(value) if isinstance(value, dict) else str(value)


def _bool_index(value: object) -> int:
    return 0 if value is True else 1 if value is False else 2


def _숫자(value: object, 형: type) -> object:
    """숫자 칸의 초깃값. 값이 없으면 None을 줘서 칸을 비워 둔다.

    0을 넣으면 사용자가 0이라고 말한 것처럼 보인다. 소득 0과 소득 모름은 판정이 다르다.
    """
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return 형(value)


def _key(name: str) -> str:
    return f"{KEY_PREFIX}{name}"

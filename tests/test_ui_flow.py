"""화면 흐름의 계산 — 무엇을 서버로 보내고, 멈춘 이유와 기록을 어떻게 말하나.

Streamlit 없이 돈다. 화면 코드에서 판단이 들어가는 조각만 떼어 `ui/flow.py`에 뒀다.
"""

from __future__ import annotations

from housing_finance_agent.ui.flow import (
    USER_STOPPED,
    confirm_updates,
    extracted_from,
    stop_message,
    trace_lines,
)

_항목 = {
    "age": {"label": "나이", "kind": "INT"},
    "net_asset_krw": {"label": "순자산", "kind": "AMOUNT"},
    "household_head_status": {
        "label": "세대주 여부",
        "kind": "CHOICE",
        "choice_labels": {"HEAD": "세대주임"},
    },
}


def test_세션_응답을_확인_화면_모양으로_편다() -> None:
    응답 = {
        "values": {
            "age": {"value": 29, "source": "LLM", "at": "t", "phrase": "만 29세"},
            "region_name": {"value": "서울", "source": "USER", "at": "t", "phrase": None},
        },
        "warnings": ["주민번호"],
        "unreadable": {"housing_area_m2": "25평"},
    }

    편 = extracted_from(응답)

    assert 편["values"] == {"age": 29, "region_name": "서울"}
    assert 편["sources"] == {"age": "만 29세"}, "근거 구절이 없는 값에 빈 근거를 붙이지 않는다"
    assert 편["unreadable"] == {"housing_area_m2": "25평"}
    assert 편["warnings"] == ["주민번호"]


def test_확인_화면은_달라진_것만_보낸다() -> None:
    """그대로 둔 값을 다시 보내면 출처가 "문장에서 읽음"에서 "직접 넣음"으로 바뀐다."""
    읽은 = {"age": 29, "region_name": "서울", "combined_annual_income_krw": {"low": 1, "high": 2}}
    확인 = {"age": 31, "region_name": "서울", "net_asset_krw": 100_000_000}

    assert confirm_updates(읽은, 확인) == {
        "age": 31,
        "net_asset_krw": 100_000_000,
        "combined_annual_income_krw": None,
    }


def test_아무것도_안_고쳤으면_보낼_것이_없다() -> None:
    읽은 = {"age": 29, "housing_area_m2": 40}

    assert confirm_updates(읽은, {"age": 29, "housing_area_m2": 40.0}) == {}


def test_물을_게_없어서_멈춘_것과_모르셔서_멈춘_것을_다르게_말한다() -> None:
    """**D-27·D-31.** 같은 말로 하면 확정되지 않은 결과를 확정된 것으로 읽는다."""
    끝, 끝_문구 = stop_message("COMPLETE", [], _항목)
    모름, 모름_문구 = stop_message("ONLY_DECLINED_LEFT", ["net_asset_krw"], _항목)
    멈춤, _ = stop_message(USER_STOPPED, [], _항목)

    assert 끝 == "success"
    assert 모름 == "warning" and 멈춤 == "warning"
    assert "순자산" in 모름_문구, "무엇을 몰라서 확정 못 했는지 항목 이름으로 말해야 한다"
    assert 끝_문구 != 모름_문구


def test_멈춘_이유에_확정_표현을_쓰지_않는다() -> None:
    for reason in ("COMPLETE", "ALL_NOT_MATCHED", "ONLY_DECLINED_LEFT", USER_STOPPED, "?"):
        _, 문구 = stop_message(reason, ["age"], _항목)
        assert "승인" not in 문구 and "자격 있음" not in 문구


def test_기록을_무엇을_어떤_순서로_확인했나로_읽어_준다() -> None:
    기록 = [
        {"kind": "SESSION_STARTED", "payload": {}},
        {"kind": "EXTRACTED", "payload": {"values": {"age": 29}}},
        {"kind": "FIELD_SET", "payload": {"values": {"household_head_status": "HEAD"}}},
        {"kind": "FIELD_SET", "payload": {"values": {"net_asset_krw": 100_000_000}}},
        {"kind": "FIELD_DECLINED", "payload": {"field": "age"}},
        {"kind": "FIELD_SET", "payload": {"values": {"age": None}}},
        {"kind": "ASSESSED", "payload": {"results": []}},
    ]

    assert trace_lines(기록, _항목) == [
        "문장에서 읽음 — 나이",
        "세대주 여부 — 세대주임",
        "순자산 — 1억원",
        "나이 — 모른다고 함",
        "나이 — 비움",
        "판정함",
    ]

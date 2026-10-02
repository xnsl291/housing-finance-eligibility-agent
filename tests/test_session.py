"""세션 — 기록을 쌓고 그 기록에서 상태를 만든다.

**이 파일이 지키는 것 하나를 먼저 적는다.**

상태를 따로 저장하지 않고 기록에서 계산한다. 그래야 "이 판정을 재현할 수 있다"는
주장을 확인할 수 있다. 상태를 따로 두면 기록과 어긋나도 아무도 모른다.

그래서 아래 `test_기록만으로_상태를_다시_만든다`가 이 계층의 존재 이유다. 저장소를
새로 열어 같은 기록을 다시 읽어도 같은 상태가 나와야 한다.
"""

from __future__ import annotations

import pytest

from housing_finance_agent.session import (
    ASSESSED,
    BY_LLM,
    BY_USER,
    EXTRACTED,
    FIELD_SET,
    SESSION_STARTED,
    SessionStore,
    profile_of,
    replay,
)


@pytest.fixture
def store(tmp_path):
    """파일로 연다. 메모리로 열면 '다시 열어도 남아 있는가'를 확인할 수 없다."""
    return SessionStore(tmp_path / "sessions.db")


def _뽑음(**values) -> dict:
    return {"values": values, "sources": {}, "unreadable": {}}


def test_세션을_열면_시작_기록이_남는다(store) -> None:
    session_id = store.start()

    기록 = store.events(session_id)

    assert [e.kind for e in 기록] == [SESSION_STARTED]
    assert store.exists(session_id)


def test_문장에서_읽은_값은_출처가_LLM이다(store) -> None:
    session_id = store.start()
    store.record_extraction(session_id, {"values": {"age": 29}, "sources": {"age": "만 29세"}})

    상태 = store.state(session_id)

    assert 상태["age"].value == 29
    assert 상태["age"].source == BY_LLM
    # 문장 어디에서 읽었는지도 남는다. 값만 보여 주면 사용자가 검증할 수 없다.
    assert 상태["age"].phrase == "만 29세"


def test_직접_넣은_값은_출처가_사용자다(store) -> None:
    session_id = store.start()
    store.record_fields(session_id, {"age": 31})

    상태 = store.state(session_id)

    assert 상태["age"].source == BY_USER
    assert 상태["age"].phrase is None


def test_나중_기록이_앞선_기록을_덮는다(store) -> None:
    """사용자가 고친 값이 LLM이 읽은 값을 덮는다.

    **사용자가 LLM보다 우선해서가 아니라 나중에 일어났기 때문이다.** 순서로 정하면
    예외를 따로 둘 필요가 없다.
    """
    session_id = store.start()
    store.record_extraction(session_id, _뽑음(marital_status="MARRIED"))
    store.record_fields(session_id, {"marital_status": "NEWLYWED"})

    상태 = store.state(session_id)

    assert 상태["marital_status"].value == "NEWLYWED"
    assert 상태["marital_status"].source == BY_USER


def test_값을_비우면_모른다로_되돌아간다(store) -> None:
    """0이나 빈 문자열로 남기면 판정이 "그 값이다"로 읽는다."""
    session_id = store.start()
    store.record_extraction(session_id, _뽑음(age=29))
    store.record_fields(session_id, {"age": None})

    assert "age" not in store.state(session_id)


def test_기록만으로_상태를_다시_만든다(store, tmp_path) -> None:
    """**이 파일의 이유다.**

    저장소를 새로 열어 같은 기록을 다시 읽어도 같은 상태가 나와야 한다. 상태를 따로
    저장했다면 이 테스트는 그것을 읽을 뿐이라 아무것도 확인하지 못한다.
    """
    session_id = store.start()
    store.record_extraction(session_id, _뽑음(age=29, combined_annual_income_krw=40000000))
    store.record_fields(session_id, {"age": 31, "household_type": "SINGLE"})
    store.record_fields(session_id, {"combined_annual_income_krw": None})
    처음 = store.state(session_id)

    다시_연_저장소 = SessionStore(tmp_path / "sessions.db")
    기록 = 다시_연_저장소.events(session_id)
    다시 = replay(기록)

    assert 다시 == 처음
    assert {name: held.value for name, held in 다시.items()} == {
        "age": 31,
        "household_type": "SINGLE",
    }


def test_판정_엔진에는_출처를_벗겨서_넘긴다(store) -> None:
    """엔진은 세션을 모른다. 판정에 출처는 필요 없다."""
    session_id = store.start()
    store.record_extraction(session_id, _뽑음(age=29))
    store.record_fields(session_id, {"household_type": "SINGLE"})

    assert profile_of(store.state(session_id)) == {"age": 29, "household_type": "SINGLE"}


def test_판정도_기록으로_남는다(store) -> None:
    session_id = store.start()
    store.record_assessment(session_id, [{"program_id": "nhuf-didimdol", "status": "NOT_MATCHED"}])

    종류 = [e.kind for e in store.events(session_id)]

    assert 종류 == [SESSION_STARTED, ASSESSED]


def test_근거_구절에서_민감정보를_가린다(store) -> None:
    """**경고만으로는 부족하다.** 경고는 화면에 뜨고 사라지지만 저장된 값은 남는다.

    사용자가 문장에 주민번호를 적었고 모델이 그걸 어느 항목의 근거로 붙이면
    그대로 저장된다.
    """
    session_id = store.start()
    store.record_extraction(
        session_id,
        {"values": {"age": 30}, "sources": {"age": "주민번호 900101-1234567 기준 만 30세"}},
    )

    남은_구절 = store.state(session_id)["age"].phrase

    assert "900101" not in 남은_구절
    assert "가림" in 남은_구절
    assert "만 30세" in 남은_구절, "가리느라 근거까지 지우면 안 된다"


def test_기록_순서가_어긋나지_않는다(store) -> None:
    """번호가 1부터 빠짐없이 올라가야 순서를 믿고 상태를 만들 수 있다."""
    session_id = store.start()
    for 나이 in (29, 30, 31):
        store.record_fields(session_id, {"age": 나이})

    번호 = [e.seq for e in store.events(session_id)]

    assert 번호 == [1, 2, 3, 4]


def test_세션이_서로_섞이지_않는다(store) -> None:
    첫째 = store.start()
    둘째 = store.start()
    store.record_fields(첫째, {"age": 29})
    store.record_fields(둘째, {"age": 41})

    assert store.state(첫째)["age"].value == 29
    assert store.state(둘째)["age"].value == 41


def test_모르는_기록_종류는_상태를_바꾸지_않는다() -> None:
    """종류를 늘리다 보면 상태 만드는 규칙을 빼먹는다. 그때 조용히 틀리면 안 된다.

    빼먹으면 그 기록은 무시된다 — 잘못된 값을 만드는 것보다 낫다.
    """
    from housing_finance_agent.session import Event

    기록 = [
        Event(1, "2026-09-23T00:00:00+00:00", SESSION_STARTED, {}),
        Event(2, "2026-09-23T00:00:01+00:00", EXTRACTED, {"values": {"age": 29}}),
        Event(3, "2026-09-23T00:00:02+00:00", "아직_없는_종류", {"values": {"age": 99}}),
        Event(4, "2026-09-23T00:00:03+00:00", FIELD_SET, {"values": {"age": 31}}),
    ]

    assert replay(기록)["age"].value == 31


def test_고친_뒤에_새_문장을_넣으면_새_문장이_이긴다(store) -> None:
    """**변형 시험에서 이 자리가 비어 있었다(2026-09-23).**

    "사용자가 LLM보다 우선"으로 바꿔도 죽는 테스트가 없었다. 기존 테스트는 전부
    `추출 → 사용자 수정` 순이라, 그 순서에서는 두 규칙이 같은 답을 낸다.

    갈리는 것은 반대 순서다. 사용자가 값을 고친 뒤 새 문장을 넣으면 **새 문장이
    이겨야 한다** — 새로 쓴 문장은 새로 한 말이지, 앞서 고친 값을 존중해 무시할
    대상이 아니다. 무시하면 사용자가 문장을 다시 써도 값이 안 바뀌어 막힌다.

    바뀐 값은 화면에서 다시 "문장에서 읽음"으로 보이므로 또 고칠 수 있다.
    """
    session_id = store.start()
    store.record_fields(session_id, {"age": 31})
    store.record_extraction(session_id, {"values": {"age": 29}, "sources": {"age": "만 29세"}})

    상태 = store.state(session_id)

    assert 상태["age"].value == 29, "새 문장이 앞서 고친 값을 못 덮었다"
    assert 상태["age"].source == BY_LLM


def test_모른다고_한_항목은_값이_아니라_따로_읽는다(store) -> None:
    """모른다는 것은 값이 아니다. 상태에 넣으면 판정이 그것을 값으로 읽는다."""
    session_id = store.start()
    store.record_declined(session_id, "net_asset_krw")

    assert store.state(session_id) == {}
    assert store.declined(session_id) == {"net_asset_krw"}


def test_모른다고_한_뒤에_값을_넣으면_더는_모르는_항목이_아니다(store) -> None:
    """나중 것이 이긴다. 값을 넣은 행동이 모른다고 한 것보다 뒤에 있다."""
    session_id = store.start()
    store.record_declined(session_id, "net_asset_krw")
    store.record_declined(session_id, "housing_area_m2")
    store.record_extraction(session_id, _뽑음(net_asset_krw=100000000))

    assert store.declined(session_id) == {"housing_area_m2"}


def test_판정_기록에_질문_정책_버전이_남는다(store) -> None:
    """질문은 기록하지 않고 다시 계산한다. 정책이 바뀌면 옛 세션에서 다른 질문이 나오므로
    그 이유를 가릴 수 있어야 한다.
    """
    session_id = store.start()
    store.record_assessment(session_id, [], question_policy_version=1)

    assert store.events(session_id)[-1].payload["question_policy_version"] == 1


def test_값을_지우는_것만으로는_모른다는_기록이_풀리지_않는다(store) -> None:
    session_id = store.start()
    store.record_declined(session_id, "net_asset_krw")
    store.record_fields(session_id, {"net_asset_krw": None})

    assert store.declined(session_id) == {"net_asset_krw"}

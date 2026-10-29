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


def test_읽지_못한_원문에서도_민감정보를_가린다(store) -> None:
    """읽지 못한 값은 원문을 남겨 확인 화면이 "그대로 쓸 수 없습니다"를 보이게 한다.
    근거 구절과 같은 문장 조각인데 이쪽만 가리지 않고 저장하고 있었다."""
    session_id = store.start()
    store.record_extraction(
        session_id,
        {
            "values": {},
            "sources": {},
            "unreadable": {"move_in_date": "주민번호 900101-1234567 다음 달 초 전입"},
        },
    )

    저장된 = store.events(session_id)[-1].payload["unreadable"]["move_in_date"]

    assert "900101" not in 저장된
    assert "가림" in 저장된
    assert "다음 달 초 전입" in 저장된, "가리느라 원문까지 지우면 안 된다"


def test_글로_받는_값에서도_민감정보를_가린다(store) -> None:
    """글 칸(시·군·구 이름)에는 무엇이든 적을 수 있다. 직접 넣든 문장에서 읽든 가린다."""
    session_id = store.start()
    store.record_fields(session_id, {"region_name": "성남시 900101-1234567"})
    store.record_extraction(
        session_id,
        {"values": {"region_name": "분당구 900101-1234567"}, "sources": {}},
    )

    for event in store.events(session_id)[1:]:
        저장된 = event.payload["values"]["region_name"]
        assert "900101" not in 저장된
        assert "가림" in 저장된


def test_정해진_모양의_값은_가리기에_건드리지_않는다(store) -> None:
    """날짜를 계좌번호 모양으로 잘못 가리면 판정이 망가진다."""
    session_id = store.start()
    store.record_fields(session_id, {"move_in_date": "2026-04-20", "age": 31})

    assert store.state(session_id)["move_in_date"].value == "2026-04-20"


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


def test_지우면_세션과_기록이_모두_사라진다(store) -> None:
    session_id = store.start()
    store.record_fields(session_id, {"age": 31})
    남길 = store.start()
    store.record_fields(남길, {"age": 40})

    store.delete(session_id)

    assert not store.exists(session_id)
    assert store.events(session_id) == []
    # 다른 사람의 세션은 건드리지 않는다.
    assert store.state(남길)["age"].value == 40


def test_지운_값은_파일에도_남지_않는다(tmp_path) -> None:
    """SQLite는 지운 행을 빈 자리로 표시만 해서, 설정 없이는 파일을 열면 값이 읽힌다."""
    path = tmp_path / "sessions.db"
    store = SessionStore(path)
    session_id = store.start()
    표식 = "지워져야하는근거구절표식"
    store.record_extraction(
        session_id, {"values": {"age": 31}, "sources": {"age": 표식}, "unreadable": {}}
    )
    assert 표식.encode("utf-8") in path.read_bytes()

    store.delete(session_id)

    assert 표식.encode("utf-8") not in path.read_bytes()


def test_여러_요청이_한꺼번에_읽고_써도_깨지지_않는다(tmp_path) -> None:
    """API는 요청마다 다른 스레드에서 같은 저장소를 쓴다. 화면이 같은 세션을 두 번
    동시에 부르면 연결 하나를 두 스레드가 함께 써서 500이나 있는 세션의 404가 났다."""
    from concurrent.futures import ThreadPoolExecutor

    store = SessionStore(tmp_path / "sessions.db")
    session_id = store.start()

    def 한_번(i: int) -> None:
        store.record_fields(session_id, {"age": i})
        assert store.exists(session_id)
        store.state(session_id)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(한_번, range(200)))

    # 순번이 겹치지 않고 빠짐없이 쌓였다(시작 기록 1 + 값 200).
    assert [e.seq for e in store.events(session_id)] == list(range(1, 202))


# ── 보관 기간 ─────────────────────────────────────────────────────────
#
# 마지막으로 기록이 쌓인 때(값을 넣거나 고치거나 판정한 때)로부터 7일이 지나면 지운다.
# 읽기만 한 것은 기간을 늘리지 않는다. 기다리지 않고 시계를 바꿔 끼워 확인한다.


class _시계:
    def __init__(self) -> None:
        from datetime import UTC, datetime

        self.지금 = datetime(2026, 10, 29, 9, 0, 0, tzinfo=UTC)

    def __call__(self):
        return self.지금

    def 지남(self, **kwargs) -> None:
        from datetime import timedelta

        self.지금 += timedelta(**kwargs)


def _파일의_줄_수(path, table: str, column: str, value: str) -> int:
    """저장소를 거치지 않고 파일을 직접 열어 센다. 저장소가 '없다'고 답하는 것과 파일에서
    실제로 지워진 것은 다르다."""
    import sqlite3

    db = sqlite3.connect(path)
    try:
        sql = f"SELECT COUNT(*) FROM {table} WHERE {column} = ?"
        return db.execute(sql, (value,)).fetchone()[0]
    finally:
        db.close()


def test_보관_기간은_7일이다() -> None:
    from datetime import timedelta

    from housing_finance_agent.session import RETENTION

    assert timedelta(days=7) == RETENTION


def test_마지막으로_쓴_뒤_7일이_지나면_없는_세션이다(tmp_path) -> None:
    시계 = _시계()
    store = SessionStore(tmp_path / "sessions.db", clock=시계)
    session_id = store.start()
    store.record_fields(session_id, {"age": 31})

    시계.지남(days=7)
    assert store.exists(session_id), "딱 7일째는 아직 남아 있다"

    시계.지남(seconds=1)
    assert not store.exists(session_id)
    # 없다고 답한 그 자리에서 파일에서도 지운다 — 지우는 일이 따로 돌지 않아도.
    assert _파일의_줄_수(tmp_path / "sessions.db", "events", "session_id", session_id) == 0


def test_7일_안에_다시_쓰면_그때부터_다시_7일이다(tmp_path) -> None:
    시계 = _시계()
    store = SessionStore(tmp_path / "sessions.db", clock=시계)
    session_id = store.start()

    시계.지남(days=6)
    store.record_fields(session_id, {"age": 31})
    시계.지남(days=6)

    assert store.exists(session_id)
    assert store.state(session_id)["age"].value == 31


def test_읽기만_해서는_기간이_늘지_않는다(tmp_path) -> None:
    시계 = _시계()
    store = SessionStore(tmp_path / "sessions.db", clock=시계)
    session_id = store.start()

    시계.지남(days=6)
    assert store.exists(session_id)
    store.state(session_id)
    store.declined(session_id)
    시계.지남(days=1, seconds=1)

    assert not store.exists(session_id)


def test_새_세션을_열면_기간이_지난_기록이_파일에서_지워진다(tmp_path) -> None:
    path = tmp_path / "sessions.db"
    시계 = _시계()
    store = SessionStore(path, clock=시계)
    오래된 = store.start()
    표식 = "기간이지나지워져야하는표식"
    store.record_extraction(
        오래된, {"values": {"age": 31}, "sources": {"age": 표식}, "unreadable": {}}
    )
    시계.지남(days=3)
    남을 = store.start()
    시계.지남(days=4, seconds=1)

    store.start()

    assert _파일의_줄_수(path, "sessions", "id", 오래된) == 0
    assert _파일의_줄_수(path, "events", "session_id", 오래된) == 0
    assert _파일의_줄_수(path, "events", "session_id", 남을) == 1
    assert 표식.encode("utf-8") not in path.read_bytes()


def test_서버를_다시_켜면_기간이_지난_기록부터_지운다(tmp_path) -> None:
    path = tmp_path / "sessions.db"
    시계 = _시계()
    session_id = SessionStore(path, clock=시계).start()
    시계.지남(days=8)

    SessionStore(path, clock=시계)

    assert _파일의_줄_수(path, "sessions", "id", session_id) == 0
    assert _파일의_줄_수(path, "events", "session_id", session_id) == 0


def test_확인한_뒤_사이에_지워진_세션에는_쓰지_않는다(tmp_path) -> None:
    """있는지 확인한 뒤 LLM을 기다리는 사이 다른 요청이 그 세션을 지울 수 있다. 그때 쓰면
    세션 없는 기록 줄이 남고, 응답은 200인데 다음 요청은 404가 된다(2026-10-29 검토)."""
    from housing_finance_agent.session import SessionGone

    path = tmp_path / "sessions.db"
    시계 = _시계()
    store = SessionStore(path, clock=시계)
    session_id = store.start()
    시계.지남(days=7)
    assert store.exists(session_id)
    시계.지남(seconds=5)  # LLM을 기다리는 사이
    store.start()  # 다른 요청이 지난 세션을 지운다

    with pytest.raises(SessionGone):
        store.record_fields(session_id, {"age": 31})

    assert _파일의_줄_수(path, "events", "session_id", session_id) == 0
    assert _파일의_줄_수(path, "sessions", "id", session_id) == 0


def test_없는_세션에는_어느_쓰기도_기록을_남기지_않는다(tmp_path) -> None:
    from housing_finance_agent.session import SessionGone

    path = tmp_path / "sessions.db"
    store = SessionStore(path)
    session_id = store.start()
    store.delete(session_id)

    for 쓰기 in (
        lambda: store.record_fields(session_id, {"age": 31}),
        lambda: store.record_extraction(session_id, _뽑음(age=31)),
        lambda: store.record_assessment(session_id, []),
        lambda: store.record_declined(session_id, "age"),
    ):
        with pytest.raises(SessionGone):
            쓰기()
    assert _파일의_줄_수(path, "events", "session_id", session_id) == 0


_고아_넣기 = (
    "INSERT INTO events (session_id, seq, at, kind, payload) VALUES ('고아', 1, 't', 'K', '{}')"
)


def test_외래키를_켜서_세션_없는_기록은_파일에_들어가지_않는다(tmp_path) -> None:
    import sqlite3

    store = SessionStore(tmp_path / "sessions.db")
    with pytest.raises(sqlite3.IntegrityError):
        store._db.execute(_고아_넣기)


def test_예전_파일에_남은_세션_없는_기록은_열_때_지운다(tmp_path) -> None:
    import sqlite3

    path = tmp_path / "sessions.db"
    SessionStore(path)
    db = sqlite3.connect(path)  # 외래키를 켜지 않은 연결(예전 코드와 같음)로 넣는다
    db.execute(_고아_넣기)
    db.commit()
    db.close()

    SessionStore(path)

    assert _파일의_줄_수(path, "events", "session_id", "고아") == 0


def test_기간이_지난_세션을_확인하면_두_표에서_모두_지운다(tmp_path) -> None:
    path = tmp_path / "sessions.db"
    시계 = _시계()
    store = SessionStore(path, clock=시계)
    session_id = store.start()
    store.record_fields(session_id, {"age": 31})
    시계.지남(days=7, seconds=1)

    assert not store.exists(session_id)

    assert _파일의_줄_수(path, "sessions", "id", session_id) == 0
    assert _파일의_줄_수(path, "events", "session_id", session_id) == 0


def test_sweep만_불러도_요청_없이_기간이_지난_세션을_지운다(tmp_path) -> None:
    """서버가 켜져 있는 동안 주기적으로 부르는 것이 이 함수다. 번호를 받지 못해 아무도
    다시 부르지 않는 세션도 이것으로 지워진다."""
    path = tmp_path / "sessions.db"
    시계 = _시계()
    store = SessionStore(path, clock=시계)
    지날 = store.start()
    시계.지남(days=1)
    남을 = store.start()
    시계.지남(days=6, seconds=1)

    store.sweep()

    assert _파일의_줄_수(path, "sessions", "id", 지날) == 0
    assert _파일의_줄_수(path, "events", "session_id", 지날) == 0
    assert _파일의_줄_수(path, "sessions", "id", 남을) == 1


def test_주기적으로_지우는_간격은_한_시간이다() -> None:
    from datetime import timedelta

    from housing_finance_agent.session import SWEEP_EVERY

    assert timedelta(hours=1) == SWEEP_EVERY

"""세션 — 무슨 일이 있었는지를 시간 순으로 쌓고, 그 기록에서 지금 상태를 만든다.

지금까지 판정은 **무상태**였다. 화면이 프로필 전량을 매번 보냈고 서버는 아무것도
기억하지 않았다. 그래서 세 가지를 못 했다.

- 브라우저를 새로 고치면 다 사라진다
- "어떤 문장이 이 판정을 만들었나"를 이을 수 없다
- 질문을 하나씩 던지는 구조를 얹을 곳이 없다 — 무엇을 모른다고 했는지가 상태다

여기서 지키는 판단 셋.

**1. 상태를 따로 저장하지 않고 기록에서 계산한다.**

상태를 따로 두면 기록과 어긋날 수 있고, 어긋나면 "이 판정을 재현할 수 있다"는
주장을 확인할 방법이 없다. 기록만 남기면 **"기록으로 상태를 다시 만들 수 있는가"를
테스트로 못 박을 수 있다**(`test_session.py`).

값은 한 세션에 스무 개 남짓이라 매번 다시 계산해도 느리지 않다. 느려지면 그때
중간 결과를 저장하되, 그때도 기록이 정본이다.

**2. 사용자가 쓴 문장은 저장하지 않는다.**

화면이 "입력한 내용은 판정에만 쓰고 저장하지 않습니다"라고 약속하고 있다. 문장을
그대로 넣으면 그 약속이 깨진다. 뽑힌 **항목 값과 근거 구절만** 남기고, 그 구절도
민감정보 정규식으로 한 번 더 거른다.

**3. 파생값은 저장하지 않는다.**

수도권 여부와 병역 반영 나이는 판정 직전에 만든다(D-20). 저장하면 사용자가 원본을
고쳤을 때 옛 파생값이 남아 판정을 뒤집는다. 그래서 **출처는 사용자와 LLM 둘뿐**이다.

**4. 마지막으로 쓴 때로부터 7일이 지나면 지운다(`RETENTION`, 2026-10-29 결정).**

"마지막으로 쓴 때"는 그 세션의 마지막 기록 시각이다. 기록이 쌓이는 것은 값을 넣거나
고치거나, 모른다고 답하거나, 판정할 때다. 읽기(GET)는 기록을 쓰지 않으므로 기간을
늘리지 않는다 — 읽기가 기간을 늘리면 주소만 아는 사람이 열어 보기만 해도 지워질 기록이
계속 남는다.

지우는 일을 따로 돌리지 않아도 약속이 지켜지게 두 겹으로 막는다. 기간이 지난 세션은
`exists`가 없다고 답해 모든 세션 경로가 404를 내고, 그 자리에서 파일에서도 지운다. 그리고
저장소를 열 때(서버를 켤 때)와 새 세션을 열 때, 서버가 켜져 있는 동안에는 한 시간마다
(`SWEEP_EVERY`, api.py 앱 수명) 기간이 지난 세션을 한꺼번에 지운다. 마지막 것이 없으면
번호를 받지 못해 아무도 다시 부르지 않는 세션이 서버가 켜져 있는 내내 남는다.

확인(`exists`)과 쓰기 사이에 세션이 지워질 수 있어 쓰기 직전에 잠금 안에서 다시 보고,
없으면 `SessionGone`을 낸다(API는 404). 외래키 검사도 켜서 세션 없는 기록은 어떤 길로도
파일에 들어가지 못한다.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from housing_finance_agent.extraction import scrub
from housing_finance_agent.fields import kind_of

# 기록의 종류. **늘리기 전에 한 번 더 생각한다** — 종류가 늘면 상태를 만드는 규칙도
# 늘고, 옛 세션을 다시 계산할 때 고려할 경우의 수가 는다.
SESSION_STARTED = "SESSION_STARTED"
EXTRACTED = "EXTRACTED"
FIELD_SET = "FIELD_SET"
ASSESSED = "ASSESSED"
# 사용자가 모른다고 한 항목. 값이 아니므로 상태(`replay`)에 넣지 않고 따로 읽는다.
# 질문 자체는 기록하지 않는다 — 질문 정책이 코드라 기록을 다시 돌리면 같은 질문이
# 나오고, GET 요청이 기록을 쓰면 새로고침만 해도 "물었다"가 쌓인다.
FIELD_DECLINED = "FIELD_DECLINED"

# 마지막으로 기록이 쌓인 때로부터 이만큼 지나면 지운다(위 4번). 화면 S11 문구가 이 줄을
# 읽어 대조한다(web/src/screens/Privacy.test.tsx). 바꾸면 화면 문구도 함께 고친다.
RETENTION = timedelta(days=7)
# 서버가 켜져 있는 동안 기간이 지난 세션을 지우는 간격. 화면 문구("한 시간 안에")가 이
# 줄을 읽어 대조한다.
SWEEP_EVERY = timedelta(hours=1)

# 값이 어디서 왔는가. 파생값은 저장하지 않으므로 둘뿐이다.
BY_USER = "USER"
BY_LLM = "LLM"


class SessionGone(LookupError):
    """쓰려는 세션이 없다(지웠거나 기간이 지남). API는 404로 낸다."""


@dataclass(frozen=True, slots=True)
class Event:
    seq: int
    at: str
    kind: str
    payload: dict


@dataclass(frozen=True, slots=True)
class Held:
    """값 하나와 그 출처."""

    value: object
    source: str
    at: str
    # LLM이 문장 어디에서 읽었는지. 사용자가 직접 넣은 값에는 없다.
    phrase: str | None = None


class SessionStore:
    """세션과 기록을 담는 곳.

    표가 둘뿐이다. 상태·판정·규칙결과를 따로 두지 않는 것은 위 1번 때문이다 —
    기록에서 만들 수 있는 것을 또 저장하면 둘이 어긋날 수 있다.
    """

    def __init__(
        self,
        db_path: str | Path = ":memory:",
        *,
        retention: timedelta = RETENTION,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        # 시계를 바꿔 끼울 수 있게 한 것은 테스트가 7일을 기다리지 않게 하려는 것이다.
        self._retention = retention
        self._clock = clock
        self._db = sqlite3.connect(str(db_path), check_same_thread=False)
        # API는 요청마다 다른 스레드에서 이 연결 하나를 쓴다. 연결을 함께 쓰는 것만
        # 허락하고(check_same_thread=False) 차례를 지키게 하지 않으면, 같은 세션을 동시에
        # 부를 때 500(`bad parameter or other API misuse`)이나 있는 세션의 404가 난다.
        # 순번을 읽고 쓰는 `_append`도 사이에 끼어들면 순번이 겹친다. 그래서 연결을 쓰는
        # 곳은 모두 이 잠금 안에서만 쓴다. `start`가 `_append`를 부르므로 다시 들어갈 수
        # 있는 잠금이다.
        self._lock = threading.RLock()
        self._db.row_factory = sqlite3.Row
        # 지운 기록이 파일의 빈 자리에 남지 않게 덮어쓴다. 이 설정이 없으면 SQLite는
        # 지운 행을 "빈 자리"로 표시만 하고 내용은 그대로 둬서, 파일을 열어 보면 지웠다고
        # 한 값이 읽힌다. 연결마다 켜야 하는 설정이다.
        self._db.execute("PRAGMA secure_delete = ON")
        # 세션 줄이 없는 기록은 파일에 들어가지 못하게 한다. SQLite는 `REFERENCES`를 적어
        # 둬도 이 설정 없이는 검사하지 않는다. 이것도 연결마다 켠다.
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id          TEXT PRIMARY KEY,
                created_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                session_id  TEXT NOT NULL REFERENCES sessions(id),
                seq         INTEGER NOT NULL,
                at          TEXT NOT NULL,
                kind        TEXT NOT NULL,
                payload     TEXT NOT NULL,
                PRIMARY KEY (session_id, seq)
            );
            """
        )
        # 외래키 검사를 켜기 전(2026-10-29 전) 코드가 남겼을 수 있는 세션 없는 기록을 한 번
        # 지운다. 외래키는 새로 넣는 줄만 막고 이미 있는 줄은 보지 않는다.
        self._db.execute("DELETE FROM events WHERE session_id NOT IN (SELECT id FROM sessions)")
        self._db.commit()
        self.sweep()

    # ── 쓰기 ──────────────────────────────────────────────────────────
    def start(self) -> str:
        session_id = uuid.uuid4().hex
        with self._lock:
            # 새 세션을 여는 때가 지우기를 걸기에 싸고 자주 오는 자리다(위 4번).
            self.sweep()
            self._db.execute(
                "INSERT INTO sessions (id, created_at) VALUES (?, ?)", (session_id, self._now())
            )
            self._db.commit()
            self._append(session_id, SESSION_STARTED, {})
        return session_id

    def record_extraction(self, session_id: str, extracted: dict) -> None:
        """LLM이 읽은 것을 남긴다. **문장 자체는 받지도 않는다.**"""
        self._append(
            session_id,
            EXTRACTED,
            {
                "values": _scrub_text_values(extracted.get("values") or {}),
                # 근거 구절에도 민감정보가 섞일 수 있다. 한 번 더 거른다.
                "sources": {
                    name: scrub(str(phrase))
                    for name, phrase in (extracted.get("sources") or {}).items()
                },
                # 읽지 못한 값도 문장 조각(원문)이라 같은 이유로 거른다. 2026-10-22까지
                # 이쪽만 빠져 있어 "가린 뒤 저장합니다"라는 안내가 이 경로에서는 거짓이었다.
                "unreadable": {
                    name: scrub(str(text))
                    for name, text in (extracted.get("unreadable") or {}).items()
                },
            },
        )

    def record_fields(self, session_id: str, values: dict) -> None:
        """사용자가 직접 넣거나 고친 값. `None`은 지우라는 뜻이다."""
        self._append(session_id, FIELD_SET, {"values": _scrub_text_values(values)})

    def record_assessment(
        self, session_id: str, summary: list[dict], question_policy_version: int | None = None
    ) -> None:
        """무엇으로 판정했는지. 결과 전체가 아니라 되짚을 수 있는 만큼만 남긴다.

        질문 정책 버전을 함께 남긴다. 질문은 기록하지 않고 다시 계산하므로, 정책이
        바뀌면 옛 세션에서 다른 질문이 나온다. 버전이 있어야 그 이유를 가린다.
        """
        payload: dict = {"results": summary}
        if question_policy_version is not None:
            payload["question_policy_version"] = question_policy_version
        self._append(session_id, ASSESSED, payload)

    def record_declined(self, session_id: str, field_name: str) -> None:
        """사용자가 이 항목은 모른다고 했다. 다시 묻지 않는다."""
        self._append(session_id, FIELD_DECLINED, {"field": field_name})

    def delete(self, session_id: str) -> None:
        """세션과 그 기록을 모두 지운다. 되돌릴 수 없다.

        기록이 정본이라 기록을 지우면 상태도, 판정의 근거도 함께 사라진다. 일부만
        지우는 방법은 두지 않는다 — 남긴 기록에서 지운 값을 짐작할 수 있다.
        """
        with self._lock:
            self._db.execute("DELETE FROM events WHERE session_id = ?", (session_id,))
            self._db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            self._db.commit()

    def sweep(self) -> None:
        """보관 기간이 지난 세션과 그 기록을 파일에서 지운다.

        저장소를 열 때, 새 세션을 열 때, 그리고 서버가 켜져 있는 동안 `SWEEP_EVERY`마다
        (api.py 앱 수명) 부른다. 마지막이 있어야 번호를 받지 못해 아무도 다시 부르지 않는
        세션도 서버를 끄지 않고 지울 수 있다.
        """
        with self._lock:
            ids = [
                (row["id"],)
                for row in self._db.execute(
                    f"SELECT id FROM sessions s WHERE {_LAST_USED} < ?", (self._cutoff(),)
                ).fetchall()
            ]
            self._db.executemany("DELETE FROM events WHERE session_id = ?", ids)
            self._db.executemany("DELETE FROM sessions WHERE id = ?", ids)
            self._db.commit()

    # ── 읽기 ──────────────────────────────────────────────────────────
    def exists(self, session_id: str) -> bool:
        """있고 보관 기간 안이면 참. **기간이 지났으면 그 자리에서 지우고 거짓을 낸다.**

        API의 모든 세션 경로가 이 함수로 먼저 확인하므로, `sweep`이 돌기 전이라도 기간이
        지난 세션은 어느 경로에서나 404다.
        """
        with self._lock:
            row = self._db.execute(
                f"SELECT {_LAST_USED} AS last_used FROM sessions s WHERE id = ?", (session_id,)
            ).fetchone()
            if row is None:
                return False
            if row["last_used"] < self._cutoff():
                self.delete(session_id)
                return False
        return True

    def events(self, session_id: str) -> list[Event]:
        with self._lock:
            rows = self._db.execute(
                "SELECT seq, at, kind, payload FROM events WHERE session_id = ? ORDER BY seq",
                (session_id,),
            ).fetchall()
        return [
            Event(seq=r["seq"], at=r["at"], kind=r["kind"], payload=json.loads(r["payload"]))
            for r in rows
        ]

    def state(self, session_id: str) -> dict[str, Held]:
        """**기록에서 만든다. 따로 저장한 것을 읽지 않는다.**"""
        return replay(self.events(session_id))

    def declined(self, session_id: str) -> set[str]:
        return declined_of(self.events(session_id))

    # ── 내부 ──────────────────────────────────────────────────────────
    def _now(self) -> str:
        return _stamp(self._clock())

    def _cutoff(self) -> str:
        """이 시각보다 앞서 마지막으로 쓴 세션은 기간이 지났다. 딱 7일째는 아직 남는다."""
        return _stamp(self._clock() - self._retention)

    def _append(self, session_id: str, kind: str, payload: dict) -> None:
        with self._lock:
            # API는 `exists`로 확인한 뒤 잠금을 놓고 LLM을 기다린다. 그 사이 다른 요청이
            # 세션을 지우거나(내 기록 지우기) 기간이 지나 지울 수 있으므로 쓰기 직전에
            # 같은 잠금 안에서 다시 본다. 확인 없이 쓰면 외래키에 막히지만, 그 오류보다 이
            # 예외가 뜻이 분명하다.
            if not self.exists(session_id):
                raise SessionGone(session_id)
            row = self._db.execute(
                "SELECT COALESCE(MAX(seq), 0) AS last FROM events WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            self._db.execute(
                "INSERT INTO events (session_id, seq, at, kind, payload) VALUES (?, ?, ?, ?, ?)",
                (
                    session_id,
                    row["last"] + 1,
                    self._now(),
                    kind,
                    json.dumps(payload, ensure_ascii=False),
                ),
            )
            self._db.commit()


def _scrub_text_values(values: dict) -> dict:
    """글로 받는 항목(예: 시·군·구 이름)의 값에서 민감정보를 가린다.

    숫자·선택지·날짜는 정해진 모양만 받아 주민등록번호나 계좌번호가 들어갈 수 없지만, 글
    칸에는 무엇이든 적을 수 있다. 화면 안내는 "가린 뒤 저장합니다"라고 하므로 근거 구절·
    읽지 못한 원문과 같이 글 값도 거른다(2026-10-26까지 빠져 있었음).
    """
    return {
        name: scrub(value) if isinstance(value, str) and kind_of(name) == "TEXT" else value
        for name, value in values.items()
    }


def replay(events: list[Event]) -> dict[str, Held]:
    """기록을 처음부터 훑어 지금 상태를 만든다.

    **나중 것이 앞선 것을 덮는다.** 사용자가 고친 값이 LLM이 읽은 값을 덮는 것도
    이 규칙 하나로 처리된다 — 고친 행동이 나중에 일어났기 때문이지, 사용자가
    LLM보다 우선해서가 아니다. 순서로 정하면 예외를 따로 둘 필요가 없다.
    """
    state: dict[str, Held] = {}
    for event in events:
        if event.kind == EXTRACTED:
            구절 = event.payload.get("sources") or {}
            for name, value in (event.payload.get("values") or {}).items():
                state[name] = Held(value, BY_LLM, event.at, 구절.get(name))
        elif event.kind == FIELD_SET:
            for name, value in (event.payload.get("values") or {}).items():
                # 화면에서 값을 비우면 "모른다"로 되돌린다. 0이나 빈 문자열로
                # 남기면 판정이 "그 값이다"로 읽는다.
                if value is None:
                    state.pop(name, None)
                else:
                    state[name] = Held(value, BY_USER, event.at)
    return state


def declined_of(events: list[Event]) -> set[str]:
    """모른다고 한 항목. `replay`와 같이 **나중 것이 이긴다.**

    모른다고 한 뒤에 값을 넣으면(직접 넣든 문장에서 읽든) 더는 모르는 항목이 아니다.
    그 값을 나중에 지워도 모른다고 했던 기록은 되살리지 않는다 — 값을 넣은 순간
    이미 풀렸고, 지운 것은 새로 한 행동이라 다시 물어도 된다.

    **값을 지우는 것(`None`)만으로는 풀리지 않는다.** 화면이 빈 칸을 한꺼번에 `None`으로
    보내면, 모른다고 한 항목이 저장할 때마다 전부 풀려 다시 묻게 된다(2026-09-24 검토).
    """
    declined: set[str] = set()
    for event in events:
        if event.kind == FIELD_DECLINED:
            declined.add(event.payload["field"])
        elif event.kind in (EXTRACTED, FIELD_SET):
            values = event.payload.get("values") or {}
            declined -= {name for name, value in values.items() if value is not None}
    return declined


def profile_of(state: dict[str, Held]) -> dict:
    """판정 엔진이 받는 모양으로 편다.

    **엔진은 세션을 모른다.** 출처가 붙은 값을 그대로 넘기면 엔진이 그것까지 알아야
    하는데, 판정에 출처는 필요 없다. 여기서 벗겨서 넘긴다.
    """
    return {name: held.value for name, held in state.items()}


# 세션을 마지막으로 쓴 때 — 마지막 기록 시각, 기록이 없으면 연 시각. 시각은 모두 UTC로
# 같은 모양(`_stamp`)이라 글자 비교가 곧 시간 비교다.
_LAST_USED = "COALESCE((SELECT MAX(at) FROM events e WHERE e.session_id = s.id), s.created_at)"


def _stamp(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat(timespec="seconds")

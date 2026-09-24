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
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from housing_finance_agent.extraction import scrub

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

# 값이 어디서 왔는가. 파생값은 저장하지 않으므로 둘뿐이다.
BY_USER = "USER"
BY_LLM = "LLM"


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

    def __init__(self, db_path: str | Path = ":memory:") -> None:
        self._db = sqlite3.connect(str(db_path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
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
        self._db.commit()

    # ── 쓰기 ──────────────────────────────────────────────────────────
    def start(self) -> str:
        session_id = uuid.uuid4().hex
        self._db.execute(
            "INSERT INTO sessions (id, created_at) VALUES (?, ?)", (session_id, _now())
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
                "values": extracted.get("values") or {},
                # 근거 구절에도 민감정보가 섞일 수 있다. 한 번 더 거른다.
                "sources": {
                    name: scrub(str(phrase))
                    for name, phrase in (extracted.get("sources") or {}).items()
                },
                "unreadable": extracted.get("unreadable") or {},
            },
        )

    def record_fields(self, session_id: str, values: dict) -> None:
        """사용자가 직접 넣거나 고친 값. `None`은 지우라는 뜻이다."""
        self._append(session_id, FIELD_SET, {"values": values})

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

    # ── 읽기 ──────────────────────────────────────────────────────────
    def exists(self, session_id: str) -> bool:
        row = self._db.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return row is not None

    def events(self, session_id: str) -> list[Event]:
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
    def _append(self, session_id: str, kind: str, payload: dict) -> None:
        row = self._db.execute(
            "SELECT COALESCE(MAX(seq), 0) AS last FROM events WHERE session_id = ?", (session_id,)
        ).fetchone()
        self._db.execute(
            "INSERT INTO events (session_id, seq, at, kind, payload) VALUES (?, ?, ?, ?, ?)",
            (session_id, row["last"] + 1, _now(), kind, json.dumps(payload, ensure_ascii=False)),
        )
        self._db.commit()


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


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")

"""HTTP 경계.

화면은 파이프라인 코드를 직접 부르지 않고 이 API만 안다. 경계를 우회하면 길이
상한과 오류 매핑이 전부 무의미해진다.

**여기서 나가는 것은 판정 결과이거나 명확한 오류여야 한다.** 파이썬 예외가 그대로
500으로 나가면 화면이 보여 줄 말이 없다. 특히 "서버가 죽었다"(503)와 "조건이 안
맞는다"(200 + NOT_MATCHED)를 구분해서 낸다 — 둘을 같게 다루면 사용자가 자기
조건에 문제가 있다고 오해한다.

인증이 없으므로 `127.0.0.1` 바인딩을 전제로 한다.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from housing_finance_agent.amount import Range
from housing_finance_agent.assessment import assess
from housing_finance_agent.extraction import ExtractionError, LlmClient, extract_profile
from housing_finance_agent.rules import available_programs, field_catalog, load_program
from housing_finance_agent.session import SessionStore, profile_of

_DEFAULT_MAX_MESSAGE_CHARS = 1000


class ExtractRequest(BaseModel):
    message: str = Field(min_length=1)


class MessageRequest(BaseModel):
    message: str = Field(min_length=1)


class FieldsRequest(BaseModel):
    # `None`은 "이 값을 지운다"는 뜻이다. 화면에서 칸을 비운 경우다.
    values: dict


class CheckRequest(BaseModel):
    profile: dict
    # 생략하면 모든 상품을 본다. 사용자는 보통 어느 상품이 자기에게 맞는지 모른다.
    program_ids: list[str] | None = None


def create_app(
    llm: LlmClient,
    max_message_chars: int = _DEFAULT_MAX_MESSAGE_CHARS,
    sessions: SessionStore | None = None,
) -> FastAPI:
    app = FastAPI(title="주거금융 지원가능성 판정")
    store = sessions if sessions is not None else SessionStore(_db_path())

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "programs": available_programs()}

    @app.get("/v1/fields")
    def fields() -> dict:
        """화면이 쓸 항목 목록.

        화면이 항목 이름과 허용값을 따로 적으면 정본이 둘로 갈라진다. 항목이 하나
        늘 때 두 곳을 고쳐야 하고, 한쪽만 고치면 화면에 없는 항목을 LLM이 뽑는다.
        """
        return {"fields": field_catalog()}

    @app.post("/v1/profiles/extract")
    def extract(request: ExtractRequest) -> dict:
        if len(request.message) > max_message_chars:
            raise HTTPException(
                422, f"문장이 너무 깁니다: {len(request.message)}자 (상한 {max_message_chars}자)"
            )
        try:
            result = extract_profile(llm, request.message)
        except ExtractionError as error:
            raise HTTPException(503, f"조건을 읽지 못했습니다: {error}") from error
        except Exception as error:
            # LLM 어댑터가 무엇을 던지든 화면은 문구를 받아야 한다.
            raise HTTPException(503, f"LLM 호출에 실패했습니다: {error}") from error

        return {
            "values": {name: _as_json(value) for name, value in result.values.items()},
            "sources": result.sources,
            "unreadable": result.unreadable,
            "warnings": result.warnings,
        }

    @app.post("/v1/eligibility/check")
    def check(request: CheckRequest) -> dict:
        profile = {name: _as_value(value) for name, value in request.profile.items()}
        return {"results": _판정들(profile, request.program_ids or available_programs())}

    def _판정들(profile: dict, program_ids: list[str]) -> list[dict]:
        """무상태 경로와 세션 경로가 **같은 판정을 쓰게** 한다.

        둘이 각자 조립하면 응답이 조금씩 달라지고, 화면이 어느 경로로 왔는지에 따라
        다르게 보인다.
        """
        results = []
        for program_id in program_ids:
            try:
                program = load_program(program_id)
            except FileNotFoundError as error:
                raise HTTPException(404, f"없는 상품입니다: {program_id}") from error

            assessment = assess(program, profile)
            results.append(
                {
                    "program_id": program_id,
                    "program_name": program["program"]["program_name"],
                    "status": assessment.decision.status,
                    "passed_rules": assessment.decision.passed_rules,
                    "failed_rules": assessment.decision.failed_rules,
                    "missing_fields": assessment.decision.missing_fields,
                    "imprecise_fields": assessment.decision.imprecise_fields,
                    "next_actions": assessment.next_actions,
                    "loan_limit": _limit_as_json(assessment.loan_limit),
                    # 통과·불충족만 주면 "왜 이 조건은 안 보이나"에 답을 못 한다.
                    "rule_outcomes": [
                        {
                            "rule_id": item.rule_id,
                            "outcome": item.outcome,
                            "field": item.field,
                            "citation": item.citation,
                            "failure_message": item.failure_message,
                        }
                        for item in assessment.decision.rule_outcomes
                    ],
                    # 아직 다루지 않는 조건을 숨기지 않는다.
                    "unresolved": program.get("unresolved") or [],
                    "rule_version": program["program"].get("version"),
                    "source_url": program["program"]["source_url"],
                    "source_checked_at": program["program"]["fetched_at"],
                }
            )
        return results

    # ── 세션 ──────────────────────────────────────────────────────────
    #
    # 위의 두 경로(`/v1/profiles/extract`, `/v1/eligibility/check`)는 무상태로 남긴다.
    # 순수한 함수 경계라 테스트하기 쉽고, 세션 없이 판정만 부르고 싶은 경우가 있다.
    # 아래는 그 위에 "기억하는 층"을 얹은 것이고 같은 `assess()`를 부른다.

    def _세션_확인(session_id: str) -> None:
        if not store.exists(session_id):
            raise HTTPException(404, "없는 세션입니다")

    def _상태_응답(session_id: str) -> dict:
        state = store.state(session_id)
        return {
            "session_id": session_id,
            # 값마다 어디서 왔는지 함께 낸다. 화면이 "직접 넣은 값"과 "문장에서 읽은
            # 값"을 구분해 보여 줄 수 있어야 한다.
            "values": {
                name: {
                    "value": _as_json(held.value),
                    "source": held.source,
                    "at": held.at,
                    "phrase": held.phrase,
                }
                for name, held in state.items()
            },
        }

    @app.post("/v1/sessions")
    def start_session() -> dict:
        return {"session_id": store.start()}

    @app.post("/v1/sessions/{session_id}/messages")
    def add_message(session_id: str, request: MessageRequest) -> dict:
        """문장을 읽어 값으로 바꾼다. **문장 자체는 저장하지 않는다.**"""
        _세션_확인(session_id)
        if len(request.message) > max_message_chars:
            raise HTTPException(
                422, f"문장이 너무 깁니다: {len(request.message)}자 (상한 {max_message_chars}자)"
            )
        try:
            result = extract_profile(llm, request.message)
        except ExtractionError as error:
            raise HTTPException(503, f"조건을 읽지 못했습니다: {error}") from error
        except Exception as error:
            raise HTTPException(503, f"LLM 호출에 실패했습니다: {error}") from error

        store.record_extraction(
            session_id,
            {
                "values": {name: _as_json(value) for name, value in result.values.items()},
                "sources": result.sources,
                "unreadable": result.unreadable,
            },
        )
        응답 = _상태_응답(session_id)
        # 경고와 못 읽은 값은 이번 문장에 대한 것이라 상태가 아니다. 저장하지 않고
        # 이 응답에만 실어 보낸다.
        응답["warnings"] = result.warnings
        응답["unreadable"] = result.unreadable
        return 응답

    @app.put("/v1/sessions/{session_id}/fields")
    def set_fields(session_id: str, request: FieldsRequest) -> dict:
        """사용자가 직접 넣거나 고친 값."""
        _세션_확인(session_id)
        낯선 = sorted(name for name in request.values if name not in field_catalog())
        if 낯선:
            raise HTTPException(422, f"없는 항목입니다: {', '.join(낯선)}")
        store.record_fields(session_id, request.values)
        return _상태_응답(session_id)

    @app.get("/v1/sessions/{session_id}")
    def get_session(session_id: str) -> dict:
        _세션_확인(session_id)
        return _상태_응답(session_id)

    @app.post("/v1/sessions/{session_id}/assessment")
    def assess_session(session_id: str, program_ids: list[str] | None = None) -> dict:
        """지금까지 모인 값으로 판정한다."""
        _세션_확인(session_id)
        profile = {
            name: _as_value(value) for name, value in profile_of(store.state(session_id)).items()
        }
        results = _판정들(profile, program_ids or available_programs())
        store.record_assessment(
            session_id,
            [
                {
                    "program_id": r["program_id"],
                    "status": r["status"],
                    "rule_version": r["rule_version"],
                }
                for r in results
            ],
        )
        return {"session_id": session_id, "results": results}

    @app.get("/v1/sessions/{session_id}/trace")
    def get_trace(session_id: str) -> dict:
        """무슨 일이 있었는지 시간 순으로. **상태는 이것으로 다시 만들어진다.**"""
        _세션_확인(session_id)
        return {
            "session_id": session_id,
            "events": [
                {"seq": e.seq, "at": e.at, "kind": e.kind, "payload": e.payload}
                for e in store.events(session_id)
            ],
        }

    return app


def _as_value(given: object) -> object:
    """화면이 범위를 `{"low": .., "high": ..}`로 보낸다. 판정이 쓰는 모양으로 되돌린다."""
    if isinstance(given, dict) and {"low", "high"} <= given.keys():
        return Range(int(given["low"]), int(given["high"]))
    return given


def _as_json(value: object) -> object:
    return {"low": value.low, "high": value.high} if isinstance(value, Range) else value


def _limit_as_json(limit: object) -> dict | None:
    if limit is None:
        return None
    return {
        "amount_krw": limit.amount_krw,
        "tier": limit.tier,
        # 어느 쪽에 걸려 이 금액이 됐는지 보여 주려면 둘 다 있어야 한다.
        "ratio_amount_krw": limit.ratio_amount_krw,
        "cap_amount_krw": limit.cap_amount_krw,
        "citation": limit.citation,
        "rule_id": limit.rule_id,
        # 못 낸 이유. 사유마다 사용자가 할 일이 다르다.
        "reason": limit.reason,
    }


def _db_path() -> str:
    """세션을 어디에 담을지.

    기본값을 메모리로 두지 않는다. 서버를 껐다 켜면 세션이 사라지는데, 그건
    "새로고침해도 남는다"는 이 계층의 존재 이유와 정면으로 부딪힌다. 대신 경로를
    환경변수로 바꿀 수 있게 해서 테스트가 임시 파일을 쓴다.
    """
    return os.environ.get("HFA_DB", "sessions.db")

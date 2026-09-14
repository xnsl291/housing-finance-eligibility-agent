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

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from housing_finance_agent.amount import Range
from housing_finance_agent.assessment import assess
from housing_finance_agent.extraction import ExtractionError, LlmClient, extract_profile
from housing_finance_agent.rules import available_programs, load_program

_DEFAULT_MAX_MESSAGE_CHARS = 1000


class ExtractRequest(BaseModel):
    message: str = Field(min_length=1)


class CheckRequest(BaseModel):
    profile: dict
    # 생략하면 모든 상품을 본다. 사용자는 보통 어느 상품이 자기에게 맞는지 모른다.
    program_ids: list[str] | None = None


def create_app(llm: LlmClient, max_message_chars: int = _DEFAULT_MAX_MESSAGE_CHARS) -> FastAPI:
    app = FastAPI(title="주거금융 지원가능성 판정 Agent")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "programs": available_programs()}

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
        program_ids = request.program_ids or available_programs()
        profile = {name: _as_value(value) for name, value in request.profile.items()}

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
                    "source_url": program["program"]["source_url"],
                    "source_checked_at": program["program"]["fetched_at"],
                }
            )
        return {"results": results}

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
    }

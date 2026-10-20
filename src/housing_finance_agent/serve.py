"""API 서버 실행 진입점.

    python -m housing_finance_agent.serve

환경변수

    HFA_PORT            API 포트 (기본 8000)
    HFA_OLLAMA_URL      Ollama 주소
    HFA_OLLAMA_MODEL    모델 이름
    HFA_OLLAMA_TIMEOUT  LLM 한 번 부를 때 기다리는 초 (기본 120)

**GPU가 없는 컴퓨터는 제한 시간을 늘려야 한다.** CPU로만 돌리면 문장 하나에 1분이
넘게 걸린다(2026-09-24 측정 76초). 기본값 120초로는 조금만 부하가 걸려도 넘어간다.

**화면도 같은 주소로 낸다.** `web/`을 빌드해 `web/dist`가 있으면 이 서버가 화면 파일을
함께 내보낸다. 화면과 API의 주소가 같아야 CORS를 열지 않아도 된다(D-37). 빌드하지 않았으면
API만 뜬다.

**127.0.0.1에만 바인딩한다.** 이 API에는 인증이 없다. 0.0.0.0으로 열면 같은 망의
누구나 신청자 조건을 넣어 볼 수 있다.
"""

from __future__ import annotations

import os
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from housing_finance_agent.api import create_app
from housing_finance_agent.ollama import OllamaLlmClient

_WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"


def build_app():
    app = create_app(
        OllamaLlmClient(
            endpoint=os.environ.get("HFA_OLLAMA_URL", "http://127.0.0.1:11434"),
            model=os.environ.get("HFA_OLLAMA_MODEL", "qwen3.5:4b-q4_K_M"),
            timeout_seconds=float(os.environ.get("HFA_OLLAMA_TIMEOUT", "120")),
        )
    )
    attach_web(app, _WEB_DIST)
    return app


def attach_web(app: FastAPI, dist: Path) -> None:
    """빌드된 화면을 붙인다. API 경로를 모두 등록한 뒤에 불러야 API가 먼저 걸린다.

    화면은 주소마다 다른 화면을 그리지만(`/s/<세션>/questions` 등) 파일은 `index.html`
    하나다. 그래서 파일이 없는 주소는 모두 `index.html`로 돌려 화면이 주소를 읽게 한다.
    `/v1/`로 시작하는 없는 경로는 화면이 아니라 404로 둔다 — 잘못 부른 API가 HTML을
    받으면 화면이 원인을 알 수 없다.
    """
    index = dist / "index.html"
    if not index.is_file():
        return
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def page(path: str) -> FileResponse:
        if path.startswith("v1/"):
            raise HTTPException(404, "없는 경로입니다")
        return FileResponse(index)


if __name__ == "__main__":
    uvicorn.run(build_app(), host="127.0.0.1", port=int(os.environ.get("HFA_PORT", 8000)))

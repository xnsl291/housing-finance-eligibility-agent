"""API 호출.

**여기서 나가는 예외는 `ApiError` 하나뿐이다.** urllib은 연결 실패, 타임아웃,
JSON 깨짐을 서로 다른 예외로 던지는데, 그것이 화면까지 올라가면 Streamlit이
스택트레이스를 그대로 그린다. 사용자는 무슨 일이 났는지 모르고, 스택트레이스에는
서버 코드 경로가 같이 찍힌다.

**오류 문구에 로컬 경로를 넣지 않는다.** 이 화면은 데모로 녹화된다. 서버가 낸
문구에 파일 경로가 섞여 있으면 지우고 보여 준다. API 주소(`http://127.0.0.1:8000`)는
사용자가 서버를 직접 띄우는 구조라 알려 줘야 하므로 지우지 않는다.

표준 라이브러리만 쓴다. 화면이 requests를 끌고 오면 판정 엔진과 상관없는 의존성이
배포에 붙는다.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

_DEFAULT_URL = "http://127.0.0.1:8000"

# 추출과 판정은 로컬 LLM을 거쳐 수십 초가 걸린다. 목록 조회는 그럴 일이 없으므로
# 짧게 끊어서, 서버가 죽었을 때 화면이 3분을 기다리지 않게 한다.
_LLM_TIMEOUT = 180
_QUICK_TIMEOUT = 10

# 윈도우 경로(C:\...)와 유닉스 경로(/home/...). 서버 문구에 섞여 들어올 수 있다.
_PATH_PATTERN = re.compile(
    r"[A-Za-z]:\\[^\s'\"]+"
    r"|(?<![\w:/])/(?:home|Users|mnt|opt|usr)/[^\s'\"]+"
)


class ApiError(Exception):
    """화면이 문구로 바꿔 보여 줄 수 있는 실패.

    `status`는 서버가 답을 주긴 했을 때의 HTTP 코드다. 연결 자체가 안 되면 None이다.
    화면이 "서버가 죽었다"와 "조건을 읽지 못했다"를 다른 문구로 보여 줘야 해서
    둘을 구분해 들고 있는다.
    """

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def base_url() -> str:
    """API 주소. 서버를 다른 포트에 띄우는 경우가 있어 환경변수로 연다."""
    return os.environ.get("HFA_API_URL", _DEFAULT_URL).rstrip("/")


def health() -> dict:
    return _call("GET", "/health", None, _QUICK_TIMEOUT)


def fields() -> dict:
    return _call("GET", "/v1/fields", None, _QUICK_TIMEOUT)


def extract(message: str) -> dict:
    return _call("POST", "/v1/profiles/extract", {"message": message}, _LLM_TIMEOUT)


def check(profile: dict, program_ids: list[str] | None = None) -> dict:
    payload: dict = {"profile": profile}
    if program_ids is not None:
        payload["program_ids"] = program_ids
    return _call("POST", "/v1/eligibility/check", payload, _LLM_TIMEOUT)


def _call(method: str, path: str, payload: dict | None, timeout: int) -> dict:
    url = f"{base_url()}{path}"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise ApiError(_detail(error), error.code) from error
    except Exception as error:
        # 연결 거부, 타임아웃, 깨진 JSON이 전부 여기로 온다. 사용자가 할 일은
        # 셋 다 같다 — 서버가 떠 있는지 본다. 예외 원문은 붙이지 않는다.
        # OSError의 문구에는 소켓 주소나 경로가 섞여 나올 때가 있다.
        raise ApiError(f"서버에 연결할 수 없습니다 ({base_url()})", None) from error


def _detail(error: urllib.error.HTTPError) -> str:
    """서버가 준 사유. 읽을 수 없으면 코드만 알려 준다."""
    try:
        detail = json.loads(error.read() or b"{}").get("detail")
    except (ValueError, OSError):
        detail = None
    return strip_paths(str(detail)) if detail else f"요청이 거부됐습니다 (HTTP {error.code})"


def strip_paths(text: str) -> str:
    """문구에서 파일 경로를 지운다. 데모 녹화에 서버 코드 위치가 찍히지 않게 한다."""
    return _PATH_PATTERN.sub("(경로 생략)", text)

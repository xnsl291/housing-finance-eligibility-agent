"""로컬 Ollama에 붙는 LLM 어댑터.

로컬로 돌리는 이유는 금융 정보가 밖으로 나가지 않게 하기 위해서다. 신청자의 나이·
소득·자산을 외부 API로 보내면 "왜 그 정보를 밖으로 보냈나"라는 질문에 답해야 한다.

`temperature`를 0으로 둔다. 같은 문장에서 매번 다른 값을 뽑으면 판정이 흔들린다.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request


class LlmError(Exception):
    """화면에 그대로 보여 줄 수 있는 문구를 담는다."""


class OllamaLlmClient:
    def __init__(
        self,
        endpoint: str = "http://127.0.0.1:11434",
        model: str = "qwen3.5:4b-q4_K_M",
        timeout_seconds: float = 120.0,
    ) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._model = model
        self._timeout = timeout_seconds

    def generate(self, prompt: str) -> str:
        try:
            # 본문 조립과 Request 생성도 try 안에 둔다. 주소에 scheme이 없으면
            # Request를 만들 때 ValueError가 나는데, 밖에 두면 그것만 예외 변환을
            # 비껴가 화면이 아니라 서버가 스택트레이스를 뱉는다.
            payload = json.dumps(
                {
                    "model": self._model,
                    "prompt": prompt,
                    "stream": False,
                    # 같은 입력에 같은 답이 나와야 판정이 재현된다.
                    "options": {"temperature": 0},
                    # Qwen 계열은 thinking이 기본으로 켜져 있고 지연을 배 단위로 늘린다.
                    "think": False,
                },
                ensure_ascii=False,
            ).encode("utf-8")
            request = urllib.request.Request(
                f"{self._endpoint}/api/generate",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                body = json.loads(response.read())
        except urllib.error.HTTPError as error:
            raise LlmError(f"LLM 서버 오류 (HTTP {error.code})") from error
        except (OSError, ValueError) as error:
            # URLError·TimeoutError는 OSError 하위다. ValueError는 주소 오설정에서 온다.
            raise LlmError(
                f"LLM 서버에 연결할 수 없습니다. Ollama가 떠 있는지 확인하세요 ({self._endpoint})"
            ) from error

        reply = body.get("response")
        if not isinstance(reply, str):
            raise LlmError("LLM 응답 형식이 예상과 다릅니다")
        return reply

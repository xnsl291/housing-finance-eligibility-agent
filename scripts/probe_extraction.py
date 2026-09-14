"""실물 LLM으로 조건 뽑기를 돌려 보고 결과와 걸린 시간을 남긴다.

단위 테스트는 가짜 LLM으로 한다. 빠르고 CI에서 돌기 때문이다. 대신 실물이 실제로
어떻게 답하는지는 이 스크립트로 확인한다. **재 보지 않은 응답 시간을 문서에 적지
않기 위한 장치이기도 하다.**

    python scripts/probe_extraction.py

API 서버가 떠 있어야 한다. HFA_API_URL로 주소를 바꿀 수 있다.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("HFA_API_URL", "http://127.0.0.1:8000")

문장들 = [
    "만 29세 직장인이고 무주택 세대주입니다. "
    "연봉은 4천만원이고 서울에서 보증금 1억8천짜리 전셋집을 구하고 있습니다.",
    "저는 33살이고 경기도에 살아요. 결혼한 지 1년 됐고 "
    "부부 합쳐서 연 7천 정도 법니다. 전세 2억5천 생각 중이에요.",
    "24살 혼자 살고 있고 부산에서 전세 1억짜리 원룸 알아보는 중입니다. 소득은 4천 후반대예요.",
    "무주택이고 연봉은 잘 모르겠어요.",
    "제 주민번호는 900101-1234567입니다. 만 35세이고 서울 전세 3억 알아봐요.",
]


def 부르기(message: str) -> tuple[dict | None, float]:
    payload = json.dumps({"message": message}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{API}/v1/profiles/extract",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.loads(response.read()), time.monotonic() - started
    except urllib.error.HTTPError as error:
        print(f"  HTTP {error.code}: {error.read().decode('utf-8', 'replace')[:200]}")
    except OSError as error:
        print(f"  연결 실패: {error}")
    return None, time.monotonic() - started


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    걸린_시간 = []

    for index, 문장 in enumerate(문장들, start=1):
        print(f"\n[{index}] {문장}")
        result, seconds = 부르기(문장)
        걸린_시간.append(seconds)
        if result is None:
            continue

        print(f"  ({seconds:.1f}초)")
        for name, value in result["values"].items():
            읽은_곳 = result["sources"].get(name)
            출처 = f"  ← “{읽은_곳}”" if 읽은_곳 else ""
            print(f"    {name} = {value}{출처}")
        for name, 원문 in result["unreadable"].items():
            print(f"    [못 읽음] {name}: “{원문}”")
        for warning in result["warnings"]:
            print(f"    [경고] {warning}")

    if 걸린_시간:
        print(
            f"\n응답 시간 {len(걸린_시간)}건 — "
            f"평균 {sum(걸린_시간) / len(걸린_시간):.1f}초, "
            f"최소 {min(걸린_시간):.1f}초, 최대 {max(걸린_시간):.1f}초"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

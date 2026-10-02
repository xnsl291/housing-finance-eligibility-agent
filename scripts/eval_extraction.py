"""문장에서 조건을 뽑는 정확도를 잰다.

**이 저장소에서 유일하게 측정되지 않던 자리다.** 규칙 엔진은 `golden/`이 31건으로
지키는데, LLM이 문장을 얼마나 맞게 읽는지는 수치가 없었다. README에 있던 것은
응답 시간뿐이다.

재는 것 네 가지.

1. **재현율(recall)** — 문장에 있는 항목을 놓치지 않고 뽑는가
2. **정밀도(precision)** — 뽑은 값이 맞는가
3. **환각률** — **말하지 않은 항목을 채우는가.** 이쪽이 더 위험하다. 놓친 항목은
   화면 2에서 사람이 채우지만, 잘못 채워진 값은 그럴듯해서 그냥 넘어간다
4. **일관성** — 같은 문장을 여러 번 넣으면 같은 값이 나오는가

`temperature`를 0으로 둔 것은 설정일 뿐이고 실제로 같은 답이 나오는지는 재 봐야 안다.

    $env:HFA_API_URL="http://127.0.0.1:8100"
    ./.venv/Scripts/python.exe scripts/eval_extraction.py
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

import yaml

_API = os.environ.get("HFA_API_URL", "http://127.0.0.1:8000").rstrip("/")
_CASES = Path(__file__).resolve().parents[1] / "evaluation/extraction/cases.yaml"
_REPORT_DIR = _CASES.parent


def _extract(text: str) -> tuple[dict, float]:
    request = urllib.request.Request(
        f"{_API}/v1/profiles/extract",
        data=json.dumps({"message": text}).encode(),
        headers={"Content-Type": "application/json"},
    )
    시작 = time.perf_counter()
    with urllib.request.urlopen(request, timeout=180) as response:
        받음 = json.loads(response.read())
    return 받음, time.perf_counter() - 시작


def _같은_값(기대: object, 받음: object) -> bool:
    """범위는 모양이 다르고, 면적·비율은 정수와 실수가 섞여 온다."""
    if isinstance(기대, dict) and isinstance(받음, dict):
        return int(기대["low"]) == int(받음["low"]) and int(기대["high"]) == int(받음["high"])
    if isinstance(기대, dict) != isinstance(받음, dict):
        return False
    if isinstance(기대, bool) or isinstance(받음, bool):
        return 기대 is 받음
    if isinstance(기대, int | float) and isinstance(받음, int | float):
        return float(기대) == float(받음)
    return 기대 == 받음


def _채점(기대: dict, 받음: dict) -> dict:
    """항목 하나하나를 네 갈래로 나눈다."""
    맞음, 틀림, 놓침, 환각 = [], [], [], []
    for 이름, 값 in 기대.items():
        if 이름 not in 받음:
            놓침.append(이름)
        elif _같은_값(값, 받음[이름]):
            맞음.append(이름)
        else:
            틀림.append((이름, 값, 받음[이름]))
    for 이름, 값 in 받음.items():
        if 이름 not in 기대:
            환각.append((이름, 값))
    return {"맞음": 맞음, "틀림": 틀림, "놓침": 놓침, "환각": 환각}


def main() -> int:
    문서 = yaml.safe_load(_CASES.read_text(encoding="utf-8"))
    사례들 = 문서["cases"]

    결과 = []
    걸린_시간 = []
    print(f"API {_API} / 사례 {len(사례들)}건\n")

    for 사례 in 사례들:
        try:
            받음, 초 = _extract(사례["text"])
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
            print(f"  {사례['id']}  호출 실패: {error}")
            결과.append({"id": 사례["id"], "실패": str(error)})
            continue

        걸린_시간.append(초)
        점수 = _채점(사례.get("expect") or {}, 받음["values"])
        점수["id"] = 사례["id"]
        점수["초"] = 초
        점수["경고"] = 받음.get("warnings") or []
        점수["읽지_못함"] = 받음.get("unreadable") or {}

        기대_경고 = 사례.get("expect_warning")
        if 기대_경고:
            점수["경고_맞음"] = any(기대_경고 in 문구 for 문구 in 점수["경고"])

        결과.append(점수)
        표시 = "OK " if not (점수["틀림"] or 점수["놓침"] or 점수["환각"]) else "-- "
        print(
            f"  {표시}{사례['id']}  {초:5.1f}초  "
            f"맞음 {len(점수['맞음'])} 틀림 {len(점수['틀림'])} "
            f"놓침 {len(점수['놓침'])} 환각 {len(점수['환각'])}"
        )

    # ── 일관성 ────────────────────────────────────────────────────────
    설정 = 문서.get("consistency") or {}
    반복 = int(설정.get("repeat") or 0)
    대상 = 설정.get("case_ids") or []
    일관성 = []
    if 반복 > 1 and 대상:
        print(f"\n같은 문장 {반복}회 반복 ({len(대상)}건)")
        본문 = {사례["id"]: 사례["text"] for 사례 in 사례들}
        for 아이디 in 대상:
            뽑힌 = []
            for _ in range(반복):
                try:
                    받음, _초 = _extract(본문[아이디])
                except Exception as error:  # noqa: BLE001
                    뽑힌.append(f"실패:{error}")
                    continue
                뽑힌.append(json.dumps(받음["values"], sort_keys=True, ensure_ascii=False))
            같은가 = len(set(뽑힌)) == 1
            일관성.append({"id": 아이디, "같은가": 같은가, "서로_다른_답": len(set(뽑힌))})
            print(f"  {'OK ' if 같은가 else '-- '}{아이디}  서로 다른 답 {len(set(뽑힌))}개")

    _보고서(결과, 일관성, 걸린_시간, 반복)
    return 0


def _보고서(결과: list[dict], 일관성: list[dict], 걸린_시간: list[float], 반복: int) -> None:
    돈_것 = [r for r in 결과 if "실패" not in r]
    맞음 = sum(len(r["맞음"]) for r in 돈_것)
    틀림 = sum(len(r["틀림"]) for r in 돈_것)
    놓침 = sum(len(r["놓침"]) for r in 돈_것)
    환각 = sum(len(r["환각"]) for r in 돈_것)

    기대_전체 = 맞음 + 틀림 + 놓침
    뽑은_전체 = 맞음 + 틀림 + 환각
    재현율 = 맞음 / 기대_전체 if 기대_전체 else 0.0
    정밀도 = 맞음 / 뽑은_전체 if 뽑은_전체 else 0.0
    환각률 = 환각 / 뽑은_전체 if 뽑은_전체 else 0.0
    완벽 = sum(1 for r in 돈_것 if not (r["틀림"] or r["놓침"] or r["환각"]))

    환각_항목 = Counter(이름 for r in 돈_것 for 이름, _ in r["환각"])
    틀린_항목 = Counter(이름 for r in 돈_것 for 이름, _, _ in r["틀림"])
    놓친_항목 = Counter(이름 for r in 돈_것 for 이름 in r["놓침"])

    줄 = [
        f"# 조건 추출 정확도 — {date.today().isoformat()}",
        "",
        "`scripts/eval_extraction.py`가 만든 파일임. 손으로 고치지 말 것.",
        "",
        "- 모델 `qwen3.5:4b-q4_K_M` (로컬 Ollama, temperature 0)",
        f"- 사례 {len(결과)}건 (호출 실패 {len(결과) - len(돈_것)}건)",
        f"- 응답 시간 평균 {statistics.mean(걸린_시간):.1f}초 / "
        f"최소 {min(걸린_시간):.1f}초 / 최대 {max(걸린_시간):.1f}초"
        if 걸린_시간
        else "- 응답 시간: 측정 못 함",
        "",
        "## 수치",
        "",
        "| 항목 | 값 | 뜻 |",
        "|---|---|---|",
        f"| 재현율 | **{재현율:.1%}** | 문장에 있는 항목 {기대_전체}개 중 {맞음}개를 맞게 뽑음 |",
        f"| 정밀도 | **{정밀도:.1%}** | 뽑은 값 {뽑은_전체}개 중 {맞음}개가 맞음 |",
        f"| 환각률 | **{환각률:.1%}** | 뽑은 값 중 {환각}개는 문장에 근거가 없음 |",
        f"| 문장 단위 완전 일치 | **{완벽}/{len(돈_것)}** | 한 항목도 틀리지 않은 문장 수 |",
        "",
        "**환각률이 재현율보다 위험하다.** 놓친 항목은 확인 화면에서 사람이 채우지만,",
        "잘못 채워진 값은 그럴듯해서 그냥 넘어간다.",
        "",
    ]

    if 환각_항목 or 틀린_항목 or 놓친_항목:
        줄 += ["## 어느 항목이 문제인가", "", "| 항목 | 환각 | 틀림 | 놓침 |", "|---|---|---|---|"]
        이름들 = sorted(set(환각_항목) | set(틀린_항목) | set(놓친_항목))
        for 이름 in 이름들:
            줄.append(
                f"| `{이름}` | {환각_항목.get(이름, 0)} | "
                f"{틀린_항목.get(이름, 0)} | {놓친_항목.get(이름, 0)} |"
            )
        줄.append("")

    if 일관성:
        흔들린 = [r for r in 일관성 if not r["같은가"]]
        줄 += [
            f"## 일관성 (같은 문장 {반복}회)",
            "",
            f"{len(일관성) - len(흔들린)}/{len(일관성)}건이 매번 같은 값을 냈음.",
            "",
        ]
        if 흔들린:
            줄 += ["| 사례 | 서로 다른 답 |", "|---|---|"]
            줄 += [f"| {r['id']} | {r['서로_다른_답']}개 |" for r in 흔들린]
            줄.append("")

    줄 += [
        "## 사례별",
        "",
        "| 사례 | 초 | 맞음 | 틀림 | 놓침 | 환각 |",
        "|---|---|---|---|---|---|",
    ]
    for r in 결과:
        if "실패" in r:
            줄.append(f"| {r['id']} | — | 호출 실패 | | | |")
            continue
        줄.append(
            f"| {r['id']} | {r['초']:.1f} | {len(r['맞음'])} | "
            f"{len(r['틀림'])} | {len(r['놓침'])} | {len(r['환각'])} |"
        )
    줄.append("")

    상세 = [r for r in 돈_것 if r["틀림"] or r["환각"]]
    if 상세:
        줄 += ["## 무엇을 어떻게 틀렸나", ""]
        for r in 상세:
            줄.append(f"**{r['id']}**")
            for 이름, 기대, 받음 in r["틀림"]:
                줄.append(f"- `{이름}` 기대 `{기대}` / 받음 `{받음}`")
            for 이름, 값 in r["환각"]:
                줄.append(f"- `{이름}` — 문장에 근거 없는데 `{값}`을 채움")
            줄.append("")

    경로 = _REPORT_DIR / f"report-{date.today().isoformat()}.md"
    경로.write_text("\n".join(줄), encoding="utf-8")
    print(f"\n보고서 → {경로}")
    print(
        f"재현율 {재현율:.1%} / 정밀도 {정밀도:.1%} / "
        f"환각률 {환각률:.1%} / 완전일치 {완벽}/{len(돈_것)}"
    )


if __name__ == "__main__":
    sys.exit(main())

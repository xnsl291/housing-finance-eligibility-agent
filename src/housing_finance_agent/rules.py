"""규칙 파일 읽기.

규칙은 코드가 아니라 데이터다. 조건이 바뀌면 이 파일이 아니라 rules/*.yaml을 고친다.
읽기만 하고 해석하지 않는다 — 판정은 eligibility.py가 한다.
"""

from __future__ import annotations

from pathlib import Path

import yaml

_RULES_DIR = Path(__file__).resolve().parents[2] / "rules"


def load_program(program_id: str) -> dict:
    """program_id로 규칙 파일을 읽는다.

    파일이 없으면 FileNotFoundError를 낸다. 빈 dict를 돌려주면 규칙이 하나도 없는
    프로그램으로 보여 판정이 "정보 부족"으로 조용히 나가고, 파일 이름을 틀렸다는
    사실이 묻힌다.
    """
    path = _RULES_DIR / f"{program_id}.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"규칙 파일이 없음: {path}")
    return yaml.safe_load(path.read_text(encoding="utf-8"))

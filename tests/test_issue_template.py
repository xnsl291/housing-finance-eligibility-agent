"""판정 의견 이슈 양식(.github/ISSUE_TEMPLATE/judgment-feedback.yml)과 화면이 채우는 값의 글자 대조.

화면(web/src/screens/ReportLink.tsx)은 주소로 product·verdict를 채운다.
GitHub는 선택지 글자가 같아야 채우므로 상품 이름(rules/*.yaml)이나
판정 이름(VerdictBadge.tsx)이 바뀌면 양식도 바꿔야 한다. 그걸 잊지 않게 한다.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
FORM = ROOT / ".github" / "ISSUE_TEMPLATE" / "judgment-feedback.yml"


def _선택지(form: dict, field_id: str) -> list[str]:
    field = next(f for f in form["body"] if f.get("id") == field_id)
    return field["attributes"]["options"]


def test_상품_선택지는_규칙_파일의_상품_이름을_모두_담는다() -> None:
    form = yaml.safe_load(FORM.read_text(encoding="utf-8"))
    names = set()
    for path in (ROOT / "rules").glob("nhuf-*.yaml"):
        names.add(yaml.safe_load(path.read_text(encoding="utf-8"))["program"]["program_name"])
    assert len(names) == 3
    assert names <= set(_선택지(form, "product"))


def test_판정_선택지는_화면의_판정_이름_넷을_모두_담는다() -> None:
    form = yaml.safe_load(FORM.read_text(encoding="utf-8"))
    badge = (ROOT / "web" / "src" / "components" / "VerdictBadge.tsx").read_text(encoding="utf-8")
    table = badge.split("VERDICT_LABEL")[1].split("};")[0]
    labels = set(re.findall(r'^\s+[A-Z_]+: "([^"]+)",$', table, re.M))
    assert len(labels) == 4
    assert labels <= set(_선택지(form, "verdict"))


def test_개인정보를_적지_않았다는_확인이_필수다() -> None:
    form = yaml.safe_load(FORM.read_text(encoding="utf-8"))
    field = next(f for f in form["body"] if f.get("id") == "privacy")
    assert field["type"] == "checkboxes"
    assert field["attributes"]["options"] == [
        {"label": "주민등록번호·소득·자산 같은 개인정보를 적지 않았습니다", "required": True}
    ]

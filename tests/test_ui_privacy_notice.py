"""입력 화면의 개인정보 안내가 실제로 하는 것만 약속하는지 본다.

2026-10-16까지 안내는 `집 주소는 ... 저장하지도 않습니다`라고 했는데, 저장 전에 가리는
것은 주민번호·계좌번호 둘뿐이었다. 개인정보를 다루는 화면에서 약속이 실제와 다르면
가장 나쁜 종류의 오류다. **가리는 목록(`_SENSITIVE`)이 바뀌면 안내도 같이 바뀌어야 한다.**
"""

from __future__ import annotations

from housing_finance_agent.extraction import _SENSITIVE
from housing_finance_agent.ui.screens.input import PRIVACY_NOTICE


def test_가리는_것은_가린다고_알린다() -> None:
    빠진 = [label for _, label in _SENSITIVE if label not in PRIVACY_NOTICE]

    assert not 빠진, f"가리는데 안내에 없는 것: {빠진}"


def test_주소는_가리지_못한다고_알린다() -> None:
    """주소를 가리는 처리가 없다. 있는 것처럼 말하면 안 된다."""
    assert "주소" not in " ".join(label for _, label in _SENSITIVE), (
        "주소를 가리게 됐다면 이 테스트와 안내 문구를 같이 고칠 것"
    )
    assert "주소는 가리지 못합니다" in PRIVACY_NOTICE
    assert "저장하지도 않습니다" not in PRIVACY_NOTICE


def _삭제_경로가_있다() -> bool:
    from pathlib import Path

    api = Path(__file__).resolve().parents[1] / "src/housing_finance_agent/api.py"
    return "@app.delete" in api.read_text(encoding="utf-8")


def test_사이드바_안내가_저장되는_것을_다_말한다() -> None:
    """2026-10-16까지 "서버 세션에 남는다"고만 했다. 파일이고, 다시 켜도 남고, 근거도 남는다."""
    from housing_finance_agent.ui.screens.sidebar import PRIVACY_NOTE

    for 말해야_할_것 in ("세션 파일", "다시 켜도", "근거", "답한 값", "모른다고 한"):
        assert 말해야_할_것 in PRIVACY_NOTE, f"안내가 '{말해야_할_것}'을 말하지 않는다"


def test_지우는_경로가_있으면_지울_수_있다고_말한다() -> None:
    """2026-10-20까지는 지우는 경로가 없어 "지울 수 없습니다"라고 했다.

    경로가 생기면서 안내를 바꿨다. 경로가 다시 없어지면 이 테스트가 실패한다 — 그때
    안내도 되돌릴 것. `전체 초기화`는 여전히 화면만 비우므로 그 설명은 그대로다.
    """
    from housing_finance_agent.ui.screens.sidebar import DELETE_NOTE, PRIVACY_NOTE, RESET_NOTE

    assert _삭제_경로가_있다(), "서버에 삭제 경로가 없다. 안내를 '지울 수 없습니다'로 되돌릴 것"
    assert "지울 수 없습니다" not in PRIVACY_NOTE
    assert "내 기록 지우기" in PRIVACY_NOTE
    assert "되돌릴 수 없습니다" in DELETE_NOTE
    assert "서버에 남은 기록은 지워지지 않습니다" in RESET_NOTE
    assert "모두 지웁니다" not in RESET_NOTE


def test_확인_과정_아래_문구가_남는_것을_줄여_말하지_않는다() -> None:
    from housing_finance_agent.ui.app import TRACE_NOTE

    assert "만 남" not in TRACE_NOTE, "남는 것을 일부만 말하면서 '만'이라고 하면 안 된다"
    assert "서버에 남습니다" in TRACE_NOTE

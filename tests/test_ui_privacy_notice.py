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

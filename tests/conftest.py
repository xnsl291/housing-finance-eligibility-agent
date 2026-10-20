"""모든 테스트에 걸리는 설정."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _세션_파일을_임시_폴더에(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """저장 위치를 지정하지 않고 서버를 만드는 테스트가 작업 폴더에 `sessions.db`를 만들었다(#31).

    그 파일을 테스트끼리 공유했고, 같은 폴더에서 실제 서버를 돌린 적이 있으면 실제 세션
    파일(나이·소득·자산이 든)에 테스트 기록이 쌓였다. 테스트마다 따로 고치면 새 테스트에서
    다시 빠뜨리므로 여기서 한 번에 돌린다.
    """
    monkeypatch.setenv("HFA_DB", str(tmp_path / "sessions.db"))

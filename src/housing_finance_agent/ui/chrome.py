"""화면의 겉모습. 설정으로 안 되는 것만 담는다.

색·모서리·굵기·서체는 `.streamlit/config.toml`이 맡는다. 여기에는 설정에 자리가
없는 두 가지만 둔다.

1. **제목 자간 -2%** — 디자인 문서가 "대체 서체를 쓰더라도 이것만은 지키라"고 적어
   둔 두 가지 중 하나다. 나머지 하나인 본문 450 굵기는 설정으로 됐다. 글자들이
   서로 붙어야 제목이 편집물처럼 단단해 보인다
2. **눈썹 라벨** — 작은 점 + 굵은 글씨 + 넓은 자간. 문서가 "이 점을 빼면 정체성이
   사라진다"고 적은 요소다

**이 모듈이 따로 있는 이유는 순환 참조 때문이다.** `app`이 화면들을 부르는데,
화면들이 눈썹 라벨을 쓰려고 다시 `app`을 부르면 서로를 기다리게 된다. 겉모습은
누구에게도 기대지 않으므로(streamlit만 부른다) 아래쪽에 따로 둔다.

**`data-testid`에 기댄다.** Streamlit이 자기 테스트용으로 붙이는 이름이라 버전이
오르면 바뀔 수 있다. 바뀌면 자간만 사라지고 화면은 그대로 돈다 — 조용히 사라지는
것을 막으려고 `tests/test_ui_step.py`가 이 이름이 아직 있는지 확인한다.
"""

from __future__ import annotations

import streamlit as st

# 눈썹 라벨의 점에만 쓰는 주황. 디자인 문서는 이 주황을 법적 동의·안내 같은
# 자리에만 쓰라고 못 박았다. 판정 결과에는 쓰지 않는다.
_신호_주황 = "#CF4500"
_흐린_회색 = "#696969"

_CSS = f"""
<style>
/* 제목은 붙여서 단단하게. 디자인 문서가 지키라고 한 -2%다. */
[data-testid="stMarkdownContainer"] h1 {{ letter-spacing: -0.02em; font-weight: 550; }}
[data-testid="stMarkdownContainer"] h2,
[data-testid="stMarkdownContainer"] h3,
[data-testid="stMarkdownContainer"] h4 {{ letter-spacing: -0.02em; }}

/* 눈썹 라벨 — 점 하나와 넓은 자간. 이 섹션이 무엇에 대한 것인지 알리는 표지다. */
.hfa-eyebrow {{
  display: inline-block;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: {_흐린_회색};
  margin-bottom: 0.1rem;
}}
.hfa-eyebrow::before {{
  content: "\\25CF";
  color: {_신호_주황};
  font-size: 0.62em;
  vertical-align: 0.22em;
  margin-right: 0.45em;
}}
</style>
"""


def 스타일() -> None:
    """**매 실행마다 부른다.**

    전환 효과와 달리 이것은 화면에 항상 있어야 한다. 한 번만 넣으면 다음 실행에서
    Streamlit이 그 요소를 지워 자간이 원래대로 돌아간다.
    """
    st.markdown(_CSS, unsafe_allow_html=True)


def eyebrow(text: str) -> None:
    """섹션 표지. 화면마다 제목 위에 한 줄 놓는다."""
    st.markdown(f'<span class="hfa-eyebrow">{text}</span>', unsafe_allow_html=True)

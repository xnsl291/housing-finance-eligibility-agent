"""화면의 겉모습. 설정으로 안 되는 것만 담는다.

색·모서리·굵기·서체는 `.streamlit/config.toml`이 맡는다. 여기에는 설정에 자리가
없는 것만 둔다 — 본문 폭, 제목 자간, 눈썹 라벨, 주의문, 움직임.

**이 모듈이 따로 있는 이유는 순환 참조 때문이다.** `app`이 화면들을 부르는데,
화면들이 눈썹 라벨을 쓰려고 다시 `app`을 부르면 서로를 기다리게 된다. 겉모습은
누구에게도 기대지 않으므로(streamlit만 부른다) 아래쪽에 따로 둔다.

**`data-testid`에 기댄다.** Streamlit이 자기 테스트용으로 붙이는 이름이라 버전이
오르면 바뀔 수 있다. 바뀌면 겉모습만 원래대로 돌아가고 화면은 그대로 돈다 —
조용히 사라지는 것을 막으려고 `tests/test_ui_step.py`가 이 이름들을 확인한다.
"""

from __future__ import annotations

import streamlit as st

# 주황은 법적·안내 성격의 자리에만 쓴다. 판정 색(초록·주황·빨강·파랑)과 뜻이
# 겹치지 않게, 판정 결과에는 절대 쓰지 않는다.
_신호_주황 = "#CF4500"
_흐린_회색 = "#696969"
_먹색 = "#141413"
_테두리 = "#D9D4CE"

# 본문 폭.
#
# 처음에 `layout="centered"`(약 730px)로 뒀다가 "화면이 넓은데 가운데만 조금 쓴다"는
# 지적을 받았다. 규칙 20개와 공식 문서 원문 인용을 보여 주는 화면이라 좁은 단이
# 특히 불리하다 — 인용 한 줄이 서너 줄로 접힌다.
#
# 그렇다고 화면 끝까지 늘리지는 않는다. 디자인 문서가 정한 상한이 1200~1280px이고,
# 그보다 넓어지면 한 줄이 길어져서 눈이 다음 줄 첫 글자를 못 찾는다.
_본문_최대폭 = "1280px"

_CSS = f"""
<style>
/* 본문 폭. layout="wide"로 열고 여기서 상한을 준다. */
[data-testid="stMainBlockContainer"] {{
  max-width: {_본문_최대폭};
  padding-left: 3rem;
  padding-right: 3rem;
}}

/* 제목은 붙여서 단단하게. 디자인 문서가 "대체 서체를 써도 지키라"고 한 -2%다. */
[data-testid="stMarkdownContainer"] h1 {{ letter-spacing: -0.02em; font-weight: 550; }}
[data-testid="stMarkdownContainer"] h2,
[data-testid="stMarkdownContainer"] h3,
[data-testid="stMarkdownContainer"] h4 {{ letter-spacing: -0.02em; }}

/* 눈썹 라벨 — 점 하나와 넓은 자간. 이 섹션이 무엇에 대한 것인지 알리는 표지다. */
.hfa-eyebrow {{
  display: inline-block;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: {_흐린_회색};
  margin-bottom: 0.1rem;
}}
.hfa-eyebrow::before {{
  content: "\\25CF";
  color: {_신호_주황};
  font-size: 0.6em;
  vertical-align: 0.24em;
  margin-right: 0.45em;
}}

/* 주의문 — 파란 상자 대신 왼쪽에 선 하나. 배경색을 쓰지 않아 크림 바탕을 안 깬다. */
.hfa-note {{
  border-left: 2px solid {_신호_주황};
  padding: 0.1rem 0 0.1rem 0.85rem;
  margin: 0.35rem 0 0.9rem;
  color: {_흐린_회색};
  font-size: 0.88rem;
  line-height: 1.5;
}}

/* 단계 표시 — 화살표와 체크표 대신 번호와 색으로만 구분한다. */
.hfa-steps {{
  display: flex;
  gap: 2.25rem;
  align-items: baseline;
  margin: 0.25rem 0 0.4rem;
  flex-wrap: wrap;
}}
.hfa-step {{ font-size: 0.9rem; color: {_흐린_회색}; letter-spacing: -0.01em; }}
.hfa-step .n {{
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  margin-right: 0.45rem;
  color: {_테두리};
}}
.hfa-step.done {{ color: {_흐린_회색}; }}
.hfa-step.done .n {{ color: {_신호_주황}; }}
.hfa-step.now {{ color: {_먹색}; font-weight: 600; }}
.hfa-step.now .n {{ color: {_먹색}; }}

/* 손이 닿는 것에만 반응을 준다. 되돌아오는 움직임이라 다시 그려도 튀지 않는다. */
.stButton button {{ transition: transform 120ms ease, box-shadow 160ms ease; }}
.stButton button:hover {{ transform: translateY(-1px); }}
.stButton button:active {{ transform: translateY(0); }}

[data-testid="stExpander"] {{ transition: border-color 160ms ease; }}
</style>
"""

# 단계가 바뀔 때만 넣는 움직임.
#
# 본문 전체가 위에서 내려온다.
#
# 카드가 하나씩 차례로 올라오게도 해 봤는데, 테두리 있는 컨테이너의 DOM 이름을
# 확신할 수 없어서 뺐다(`stVerticalBlockBorderWrapper`는 1.63에 없다). 브라우저로
# 실제 이름을 확인한 뒤에 넣는다. 지금 넣으면 "적용됐다"고 말할 근거가 없다.
#
# **매번 넣으면 안 된다.** Streamlit은 값을 하나 칠 때마다 화면 전체를 다시 그린다.
# 조건 없이 넣으면 확인 화면에서 숫자 한 자마다 화면이 미끄러진다.
_움직임_CSS = """
<style>
@keyframes hfaStep{단계} {{
  from {{ opacity: 0; transform: translateY(-2.5rem); }}
  to   {{ opacity: 1; transform: translateY(0); }}
}}
/* 움직임을 줄이도록 설정한 사용자에게는 넣지 않는다. */
@media (prefers-reduced-motion: reduce) {{
  [data-testid="stMainBlockContainer"] {{ animation: none; }}
}}
</style>
"""

_마지막_단계_키 = "_움직임을_준_단계"


def 스타일() -> None:
    """**매 실행마다 부른다.**

    움직임과 반대다. 겉모습은 항상 있어야 한다 — 한 번만 넣으면 다음 실행에서
    Streamlit이 그 요소를 지워 폭과 자간이 원래대로 돌아간다.
    """
    st.markdown(_CSS, unsafe_allow_html=True)


def 움직임(단계: int) -> None:
    """단계가 바뀐 순간에만 넣는다.

    애니메이션 이름에 단계 번호를 붙이는 것은 되돌아갈 때(결과 → 확인)도 브라우저가
    효과를 새로 시작하게 하려는 것이다. 이름이 같으면 이어서 도는 것으로 본다.
    """
    if st.session_state.get(_마지막_단계_키) == 단계:
        return
    st.session_state[_마지막_단계_키] = 단계
    st.markdown(_움직임_CSS.format(단계=단계), unsafe_allow_html=True)


def eyebrow(text: str) -> None:
    """섹션 표지. 화면마다 제목 위에 한 줄 놓는다."""
    st.markdown(f'<span class="hfa-eyebrow">{text}</span>', unsafe_allow_html=True)


def note(text: str) -> None:
    """법적·안내 성격의 한 줄. 색 상자 대신 왼쪽 선으로 표시한다."""
    st.markdown(f'<div class="hfa-note">{text}</div>', unsafe_allow_html=True)


def steps(이름들: tuple[str, ...], 지금: int) -> None:
    """어느 단계인지. 화면이 통째로 바뀌므로 어디쯤인지 알려 줘야 한다."""
    조각 = []
    for 번호, 이름 in enumerate(이름들):
        상태 = "now" if 번호 == 지금 else "done" if 번호 < 지금 else ""
        조각.append(
            f'<span class="hfa-step {상태}"><span class="n">{번호 + 1:02d}</span>{이름}</span>'
        )
    st.markdown(f'<div class="hfa-steps">{"".join(조각)}</div>', unsafe_allow_html=True)

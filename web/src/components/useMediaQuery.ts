/*
 * 화면 폭 구간. 설계서 11.4(화면 크기) — 1,024px 이상 / 600~1,023px / 600px 미만.
 *
 * CSS의 @media와 같은 값을 쓴다. 숫자를 바꾸면 *.module.css의 `screen and (max-width: 1023px)`도 같이 바꿀 것.
 * `screen and`를 붙여 인쇄(S12)에는 걸리지 않게 한다 — 종이 폭이 좁다고 사이드바 자리가 메뉴로 바뀌면 안 된다.
 * 인쇄할 때는 넓은 화면 모양 그대로 찍힌다.
 *
 * 화면이 구조를 바꿔야 하는 곳(사이드바 ↔ 머리 메뉴)과 글이 바뀌는 곳(개인정보 안내 자리 말)만 이 훅을 쓴다. 모양만 바뀌는
 * 곳은 CSS로 한다. 사이드바를 두 벌 그리고 CSS로 숨기면 같은 버튼이 두 벌 생겨 상태(확인 창 등)가 갈라진다.
 * 비교표 ↔ 한 줄 카드(600px 미만)는 둘 다 그리고 CSS로 고른다 — 인쇄할 때 JS가 다시 그리기를 기다릴 수 없어서(CompareTable.tsx).
 *
 * matchMedia가 없는 곳(테스트의 jsdom)은 넓은 화면으로 본다. 좁은 화면 테스트는 matchMedia를 흉내 낸다(testing.tsx screenWidth).
 */
import { useCallback, useSyncExternalStore } from "react";

/** 사이드바 대신 머리 메뉴, 본문 한 단 */
export const NARROW = "screen and (max-width: 1023px)";

export function useMediaQuery(query: string): boolean {
  // 구독 함수가 그릴 때마다 새로 생기면 useSyncExternalStore가 그때마다 듣기를 뗐다 다시 건다. 질의가 같으면 같은 함수로
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false);
}

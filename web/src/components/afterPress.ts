/*
 * 칸을 떠날 때 생기는 화면 변화를 마우스를 뗀 뒤로 미룬다.
 *
 * 왜: 마우스로 아래 버튼을 누르면 누르는 순간(pointerdown·mousedown) 칸에서 초점이 빠진다(blur). 그때 칸
 * 아래 오류 줄이나 버튼 위 오류 목록이 새로 생기면 버튼이 아래로 밀린다. 손을 뗄 때(mouseup) 버튼이 이미
 * 다른 자리에 있으면 누른 곳과 뗀 곳이 달라 클릭이 버튼에 가지 않는다(S2 범위 칸에서 브라우저로 관찰함).
 *
 * 다른 길과 비교:
 * - 오류 줄 자리를 늘 비워 두기: 칸 아래 한 줄은 막지만, 버튼 위 오류 목록은 줄 수가 정해지지 않아 막지 못한다.
 *   빈자리 때문에 칸 사이도 늘 벌어진다
 * - 오류를 칸을 떠날 때 보이지 않기: 칸을 떠난 뒤에 알리는 약속(Field.tsx 머리말)을 깬다
 * 그래서 보이는 시점만 '손을 뗀 뒤'로 늦춘다. 키보드로 떠나면(탭) 누르는 중이 아니므로 바로 그린다.
 *
 * 뗀 뒤 바로가 아니라 다음 작업(setTimeout 0)으로 미룬다. click은 pointerup 다음에 오므로, 그 click이
 * 끝난 뒤에 화면이 바뀌어야 한다.
 */

let pressing = false;
let waiting: Array<() => void> = [];

function flush() {
  const run = waiting;
  waiting = [];
  run.forEach((fn) => fn());
}

function release() {
  if (!pressing) return;
  pressing = false;
  setTimeout(flush, 0);
}

if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    () => {
      // 앞선 누름의 뗌을 놓쳤으면(창 밖에서 뗌 등) 밀린 일을 먼저 끝낸다. 오류가 영영 안 보이는 일이 없게
      flush();
      pressing = true;
    },
    true,
  );
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
}

/** 마우스·손가락을 누르고 있으면 뗀 뒤에, 아니면 바로 fn을 부른다 */
export function afterPress(fn: () => void): void {
  if (pressing) waiting.push(fn);
  else fn();
}

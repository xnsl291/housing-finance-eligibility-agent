/*
 * 열린 창(확인 창 ConfirmDialog, 좁은 화면 머리 메뉴 HeaderMenu)의 초점 규칙. 두 부품이 같은 규칙을 따로 갖고 있던 것을 모았다.
 *
 * - 열린 동안 창 밖(body의 다른 자식, 곧 앱 루트)에 inert를 건다. 창은 portal로 body 바로 아래에 붙어 inert 대상 밖이다
 * - 키(Esc, 탭 가두기)는 창이 아니라 문서에서 받는다. 배경을 눌러 초점이 창 밖(body)으로 나가도 Esc와 탭이 먹어야 한다
 * - 닫힐 때 초점을 돌려보낸다. 어디로 보낼지는 부품마다 달라 부품이 정한다(returnFocus)
 *
 * 창이 겹칠 수 있다(머리 메뉴 위에 확인 창). 열린 창을 쌓아 두고 맨 위 창만 inert 밖에 두고 맨 위 창만 키를 받는다.
 * 아래 창이 먼저 닫혀도(메뉴를 연 채 화면이 넓어져 메뉴가 사라짐) 맨 위 창이 남아 있으면 앱 루트의 inert를 풀지 않는다 —
 * 창마다 자기가 건 inert를 따로 풀던 때는 이 경우 확인 창이 떠 있는데 뒤 화면이 눌렸다.
 * 원래 inert였던 것은 건드리지 않고, 여기서 건 것만 푼다.
 */
import { useEffect, useRef, type RefObject } from "react";

/** 열린 창의 배경(portal 맨 바깥) — 나중에 열린 것이 뒤 */
const stack: HTMLElement[] = [];
/** 여기서 inert를 건 요소. 원래 inert였던 것은 들어오지 않는다 */
const ours = new Set<Element>();

/** 맨 위 창 말고는 모두 inert. 창이 다 닫혔으면 건 것을 모두 푼다 */
function applyInert() {
  const top = stack[stack.length - 1];
  for (const el of [...document.body.children]) {
    if (top && el !== top) {
      if (!el.hasAttribute("inert")) {
        el.setAttribute("inert", "");
        ours.add(el);
      }
    } else if (ours.has(el)) {
      el.removeAttribute("inert");
      ours.delete(el);
    }
  }
  // 문서에서 떨어져 나간 것(닫힌 아래 창의 배경 등)은 다시 붙을 일이 없다. 표시만 지운다
  for (const el of ours) {
    if (!el.isConnected) {
      el.removeAttribute("inert");
      ours.delete(el);
    }
  }
}

interface ModalFocusOptions {
  backdropRef: RefObject<HTMLElement | null>;
  boxRef: RefObject<HTMLElement | null>;
  /** 탭을 가둘 때 처음·끝을 정하는 선택자 */
  tabbable: string;
  /** 열릴 때 초점을 둘 곳 */
  firstFocus: (box: HTMLElement) => HTMLElement | null;
  onEscape: () => void;
  /** 닫힐 때 초점을 보낼 곳. opener는 열기 직전 초점이 있던 요소. null이면 초점을 옮기지 않는다 */
  returnFocus: (opener: HTMLElement | null, box: HTMLElement) => HTMLElement | null;
}

export function useModalFocus(open: boolean, options: ModalFocusOptions) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!open) return;
    const backdrop = latest.current.backdropRef.current;
    const box = latest.current.boxRef.current;
    if (!backdrop || !box) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    stack.push(backdrop);
    applyInert();
    latest.current.firstFocus(box)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      // 위에 다른 창이 떠 있으면 키는 그 창 몫이다. 안 그러면 Esc 한 번에 두 창이 같이 닫힌다
      if (!box || stack[stack.length - 1] !== backdrop) return;
      if (e.key === "Escape") {
        e.preventDefault();
        latest.current.onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...box.querySelectorAll<HTMLElement>(latest.current.tabbable)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!box.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      stack.splice(stack.indexOf(backdrop), 1);
      // inert를 먼저 풀어야 그 안의 버튼에 초점을 줄 수 있다
      applyInert();
      latest.current.returnFocus(opener, box)?.focus();
    };
  }, [open]);
}

/**
 * 창을 연 버튼이 사라졌을 때 초점을 보낼 곳. 본문 제목(main h1)이 있으면 거기, 없으면 main.
 * 둘 다 원래 초점을 받지 않는 요소라 tabindex=-1을 붙여 스크립트로만 초점을 받게 한다.
 */
export function fallbackFocusTarget(): HTMLElement | null {
  const target = document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>("main");
  if (target && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  return target;
}

/*
 * 좁은 화면 머리 메뉴(C-MENU). 설계서 11.4 — 1,023px 이하에서 사이드바 내용을 머리 영역 메뉴로. 시안 폭 900(j9CQS)의
 * '메뉴를 연 모양'과 폭 390(Qc1aZ)의 메뉴 버튼.
 *
 * 메뉴 안에는 사이드바 부품(Sidebar)을 통째로 넣는다(children). 문구와 버튼이 사이드바와 갈라지지 않게 — 시안 C-MENU 메모
 * "부품 하나를 그대로 넣었으므로 문구가 갈라지지 않습니다". 상품 목록·연결 상태·전체 초기화·개인정보 안내·자세히 링크·
 * 내 기록 지우기가 모두 사이드바와 같은 코드로 돈다.
 *
 * 초점(시안 C0 '좁은 화면 메뉴', 설계서 11.3 확인 창 규칙과 같은 방식)
 * - 열리면 초점을 메뉴 안 닫기 버튼에 둔다. 탭이 메뉴 밖으로 새지 않는다. 메뉴 밖(앱 루트)에는 inert를 건다
 * - Esc·닫기·바깥(어두운 배경) 누름으로 닫히고, 닫히면 메뉴 버튼으로 초점을 돌려보낸다. 메뉴를 연 채 화면이 넓어져 메뉴 버튼까지
 *   사라졌으면 확인 창과 같이 본문 제목(main h1)으로 보낸다(fallbackFocusTarget). body에 버리지 않는다
 * - 메뉴 안 링크(개인정보·이용 안내 자세히)를 누르면 닫고 그 화면으로 간다. 초점은 Layout이 새 화면 제목으로 옮긴다
 * - 메뉴 안에서 확인 창(전체 초기화·내 기록 지우기)이 뜨면 확인 창이 메뉴에도 inert를 건다. 그동안 Esc·탭은 확인 창 몫이라
 *   메뉴는 키를 받지 않는다 — 안 그러면 Esc 한 번에 확인 창과 메뉴가 같이 닫힌다. inert·키·탭 가두기는 확인 창과 같은 규칙이라
 *   useModalFocus.ts에 모았다
 * - 열린 동안 뒤 화면(문서)은 굴러가지 않는다. 메뉴 안을 끝까지 굴린 손가락이 뒤 화면을 굴리지 않게
 *
 * 열림 상태는 부모(Layout)가 갖는다. 전체 초기화·내 기록 지우기가 끝나면 Layout이 메뉴를 닫아야 해서다.
 * ConfirmDialog처럼 <dialog>.showModal()을 쓰지 않는다 — 테스트 환경(jsdom)이 지원하지 않아 초점 동작을 테스트로 지킬 수 없다.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icon } from "./Icon";
import styles from "./HeaderMenu.module.css";
import { fallbackFocusTarget, useModalFocus } from "./useModalFocus";

interface HeaderMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 메뉴 안에 넣을 사이드바 */
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), summary, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function HeaderMenu({ open, onOpenChange, children }: HeaderMenuProps) {
  const panelId = useId();
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, {
    backdropRef,
    boxRef: panelRef,
    tabbable: FOCUSABLE,
    firstFocus: (panel) => panel.querySelector<HTMLElement>("[data-close]"),
    onEscape: () => onOpenChange(false),
    // 메뉴가 사라지며 초점이 갈 곳을 잃었으면(닫기·Esc·바깥 누름·전체 초기화) 메뉴 버튼으로. 화면이 바뀐 경우에는 이 뒤에
    // Layout이 새 화면 제목으로 옮기고, 확인 창이 떠 있으면 초점은 확인 창 안에 있어 건드리지 않는다
    returnFocus: (_, panel) => {
      const active = document.activeElement;
      if (active && active !== document.body && !panel.contains(active)) return null;
      return buttonRef.current?.isConnected ? buttonRef.current : fallbackFocusTarget();
    },
  });

  // 열린 동안 뒤 화면 굴림을 막는다. 원래 값을 기억해 두었다가 닫힐 때 그대로 돌려놓는다
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-haspopup="dialog"
        aria-expanded={open}
        // 닫혀 있으면 메뉴가 문서에 없다. 없는 것을 가리키지 않는다
        aria-controls={open ? panelId : undefined}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="menu" size={16} />
        {/* 600px 미만에서도 글을 보인다. 시안 폭 390은 아이콘만이지만, 본문 글이 "위쪽 '이 도구에 대해' 메뉴"로 이 버튼을
            가리켜(Sidebar.tsx usePrivacyPlace) 글이 없으면 찾을 수 없다. 390px에서 넘치지 않는 것을 브라우저로 확인함 */}
        <span>이 도구에 대해</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={backdropRef}
            className={styles.backdrop}
            onMouseDown={(e) => {
              if (e.target !== e.currentTarget) return;
              // 기본 동작(누른 곳으로 초점 이동)을 막는다. 막지 않으면 메뉴가 닫히며 버튼으로 돌려보낸 초점을 body가 다시 가져간다
              e.preventDefault();
              onOpenChange(false);
            }}
          >
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className={styles.panel}
              onClick={(e) => {
                // 메뉴 안 링크로 다른 화면에 가면 메뉴는 닫는다
                if (e.target instanceof Element && e.target.closest("a[href]")) onOpenChange(false);
              }}
            >
              <div className={styles.head}>
                <h2 id={titleId} className={styles.title}>
                  이 도구에 대해
                </h2>
                <button
                  type="button"
                  data-close
                  className={styles.close}
                  aria-label="메뉴 닫기"
                  onClick={() => onOpenChange(false)}
                >
                  <Icon name="x" size={18} />
                </button>
              </div>
              {children}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

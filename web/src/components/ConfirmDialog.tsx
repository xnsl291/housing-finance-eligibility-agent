/*
 * 확인 창 — 되돌릴 수 없는 자리(M1 처음부터 다시, M2 내 기록 지우기, M3 예시로 바꾸기, 그리고 설계서에
 * 번호가 없는 '초기화 확인' — 사이드바 전체 초기화).
 * 시안 B0 묶음 11, 설계서 11.3.
 *
 * - 열리면 초점을 안전한 쪽(취소·계속하기)에 둔다. 지우는 쪽에 두면 엔터 한 번에 날아간다
 * - 탭이 창 밖으로 새지 않는다. 창 뒤의 버튼을 누를 수 있으면 확인 창이 아니다
 * - Esc로 닫히고(= 안전한 쪽), 닫히면 창을 연 버튼으로 초점을 돌려보낸다
 *
 * <dialog>.showModal()을 쓰지 않은 이유: 테스트 환경(jsdom)이 아직 지원하지 않아 초점 동작을
 * 테스트로 지킬 수 없다. 대신 같은 동작을 직접 만들었다. 그래서 아래를 모두 직접 챙긴다.
 * - 키(Esc, 탭 가두기)를 문서에서 받고, 열린 동안 창 밖에 inert를 건다. 화면 읽기 프로그램의 훑어보기와
 *   마우스로 창 뒤를 건드리는 길을 막는다. 머리 메뉴와 같은 규칙이라 useModalFocus.ts에 모았다
 * - 배경을 누르면 초점을 창으로 되돌린다
 * - 확인 쪽 일(onConfirm)을 기다리는 동안에는 Esc·취소로 닫히지 않는다. 닫혀도 일은 계속
 *   진행되므로, 닫힌 창은 "취소됐다"는 거짓 신호가 된다
 * - 창을 연 버튼이 그새 사라졌으면(예: 처음부터 다시) 초점을 body에 버리지 않고 본문 제목으로 보낸다
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "./Button";
import styles from "./ConfirmDialog.module.css";
import { fallbackFocusTarget, useModalFocus } from "./useModalFocus";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  /** 되돌릴 수 없는 쪽 글(예: 처음부터, 지우기, 바꾸기) */
  confirmLabel: string;
  /** 안전한 쪽 글. M1·초기화 확인은 '계속하기', M2·M3은 '취소' */
  cancelLabel: string;
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const id = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  // 상태는 다시 그려진 뒤에야 바뀌므로 문서 키 처리와 같은 순간 누름은 ref로 본다
  const pendingRef = useRef(false);

  function cancel() {
    if (!pendingRef.current) onCancel();
  }

  useModalFocus(open, {
    backdropRef,
    boxRef,
    tabbable: "button",
    firstFocus: safeButton,
    onEscape: cancel,
    // 열기 직전 초점이 있던 곳 = 창을 연 버튼
    returnFocus: (opener) => (opener?.isConnected ? opener : fallbackFocusTarget()),
  });

  if (!open) return null;

  function confirm() {
    const result = onConfirm();
    if (!(result instanceof Promise)) return;
    pendingRef.current = true;
    setPending(true);
    return result.finally(() => {
      pendingRef.current = false;
      setPending(false);
    });
  }

  return createPortal(
    <div
      ref={backdropRef}
      className={styles.backdrop}
      onMouseDown={(e) => {
        // 배경을 눌러도 초점이 body로 빠지지 않게 하고 창으로 되돌린다
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        if (boxRef.current && !boxRef.current.contains(document.activeElement)) safeButton(boxRef.current)?.focus();
      }}
    >
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        className={styles.box}
      >
        <h2 id={`${id}-title`} className={styles.title}>
          {title}
        </h2>
        <div id={`${id}-body`} className={styles.body}>
          {children}
        </div>
        <div className={styles.buttons}>
          <Button variant="secondary" onClick={confirm}>
            {confirmLabel}
          </Button>
          <span data-safe>
            <Button onClick={cancel} lockedReason={pending ? "처리가 끝날 때까지 닫을 수 없습니다" : undefined}>
              {cancelLabel}
            </Button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function safeButton(box: HTMLElement) {
  return box.querySelector<HTMLElement>("[data-safe] button");
}

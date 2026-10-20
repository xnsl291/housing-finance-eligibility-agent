/*
 * 확인 창 — 되돌릴 수 없는 자리(M1 처음부터 다시, M2 내 기록 지우기, M3 예시로 바꾸기).
 * 시안 B0 묶음 11, 설계서 11.3.
 *
 * - 열리면 초점을 안전한 쪽(취소·계속하기)에 둔다. 지우는 쪽에 두면 엔터 한 번에 날아간다
 * - 탭이 창 밖으로 새지 않는다. 창 뒤의 버튼을 누를 수 있으면 확인 창이 아니다
 * - Esc로 닫히고(= 안전한 쪽), 닫히면 창을 연 버튼으로 초점을 돌려보낸다
 *
 * <dialog>.showModal()을 쓰지 않은 이유: 테스트 환경(jsdom)이 아직 지원하지 않아 초점 동작을
 * 테스트로 지킬 수 없다. 대신 같은 동작을 직접 만들었다.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "./Button";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  /** 되돌릴 수 없는 쪽 글(예: 처음부터, 지우기, 바꾸기) */
  confirmLabel: string;
  /** 안전한 쪽 글. M1은 '계속하기', M2·M3은 '취소' */
  cancelLabel: string;
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const id = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // 열기 직전 초점이 있던 곳 = 창을 연 버튼
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    boxRef.current?.querySelector<HTMLElement>("[data-safe] button")?.focus();
    return () => opener?.focus();
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const buttons = [...(boxRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className={styles.backdrop}>
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        className={styles.box}
        onKeyDown={onKeyDown}
      >
        <h2 id={`${id}-title`} className={styles.title}>
          {title}
        </h2>
        <div id={`${id}-body`} className={styles.body}>
          {children}
        </div>
        <div className={styles.buttons}>
          <Button variant="secondary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <span data-safe>
            <Button onClick={onCancel}>{cancelLabel}</Button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

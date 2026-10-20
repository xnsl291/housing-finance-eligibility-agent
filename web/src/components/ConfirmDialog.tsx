/*
 * 확인 창 — 되돌릴 수 없는 자리(M1 처음부터 다시, M2 내 기록 지우기, M3 예시로 바꾸기).
 * 시안 B0 묶음 11, 설계서 11.3.
 *
 * - 열리면 초점을 안전한 쪽(취소·계속하기)에 둔다. 지우는 쪽에 두면 엔터 한 번에 날아간다
 * - 탭이 창 밖으로 새지 않는다. 창 뒤의 버튼을 누를 수 있으면 확인 창이 아니다
 * - Esc로 닫히고(= 안전한 쪽), 닫히면 창을 연 버튼으로 초점을 돌려보낸다
 *
 * <dialog>.showModal()을 쓰지 않은 이유: 테스트 환경(jsdom)이 아직 지원하지 않아 초점 동작을
 * 테스트로 지킬 수 없다. 대신 같은 동작을 직접 만들었다. 그래서 아래를 모두 직접 챙긴다.
 * - 키(Esc, 탭 가두기)는 창이 아니라 문서에서 받는다. 배경을 눌러 초점이 창 밖(body)으로
 *   나가도 Esc와 탭이 먹어야 한다
 * - 배경을 누르면 초점을 창으로 되돌린다
 * - 열린 동안 창 밖(body의 다른 자식, 곧 앱 루트)에 inert를 건다. 화면 읽기 프로그램의 훑어보기와
 *   마우스로 창 뒤를 건드리는 길을 막는다. 창은 portal로 body 바로 아래에 붙어 inert 대상 밖이다
 * - 확인 쪽 일(onConfirm)을 기다리는 동안에는 Esc·취소로 닫히지 않는다. 닫혀도 일은 계속
 *   진행되므로, 닫힌 창은 "취소됐다"는 거짓 신호가 된다
 * - 창을 연 버튼이 그새 사라졌으면(예: 처음부터 다시) 초점을 body에 버리지 않고 본문 제목으로 보낸다
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  const backdropRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  // 상태는 다시 그려진 뒤에야 바뀌므로 문서 키 처리와 같은 순간 누름은 ref로 본다
  const pendingRef = useRef(false);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });

  function cancel() {
    if (!pendingRef.current) cancelRef.current();
  }

  useEffect(() => {
    if (!open) return;
    const backdrop = backdropRef.current;
    const box = boxRef.current;
    if (!backdrop || !box) return;
    // 열기 직전 초점이 있던 곳 = 창을 연 버튼
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // 원래 inert였던 것은 건드리지 않고, 여기서 건 것만 닫을 때 푼다
    const madeInert = [...document.body.children].filter((el) => el !== backdrop && !el.hasAttribute("inert"));
    for (const el of madeInert) el.setAttribute("inert", "");
    safeButton(box)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!pendingRef.current) cancelRef.current();
        return;
      }
      if (e.key !== "Tab" || !box) return;
      const buttons = [...box.querySelectorAll<HTMLElement>("button")];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
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
      // inert를 먼저 풀어야 그 안의 버튼에 초점을 줄 수 있다
      for (const el of madeInert) el.removeAttribute("inert");
      (opener?.isConnected ? opener : fallbackFocusTarget())?.focus();
    };
  }, [open]);

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

/**
 * 창을 연 버튼이 사라졌을 때 초점을 보낼 곳. 본문 제목(main h1)이 있으면 거기, 없으면 main.
 * 둘 다 원래 초점을 받지 않는 요소라 tabindex=-1을 붙여 스크립트로만 초점을 받게 한다.
 */
function fallbackFocusTarget(): HTMLElement | null {
  const target = document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>("main");
  if (target && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  return target;
}

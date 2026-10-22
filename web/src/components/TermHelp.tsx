/*
 * 용어 도움말(S10). 시안 S10(uHSUa) — 항목 이름 옆 '?'를 누르면 이름 바로 아래에 설명 상자가 열린다.
 *
 * 설명은 화면이 쓰지 않는다. 서버 항목 목록(GET /v1/fields)의 how_to_check를 글자 그대로 넣는다.
 * 그 정본은 rules/field_guides.yaml이고, 원문에 확인 방법이 있는 항목에만 있다. 없는 항목에는 '?'를 두지 않는다 —
 * 빈 상자를 띄우면 '설명이 안 뜬다'로 읽히고, 화면이 설명을 지어내면 없는 창구를 알려 주게 된다(설계서 S10·7.1).
 *
 * 떠 있는 팝오버가 아니라 이름 아래에 끼워 넣는 펼침이다. 칸을 가리지 않고, 화면 폭이 좁아도 잘리지 않는다.
 * 키보드: 버튼에서 Enter·Space로 열고 닫는다. 열린 동안 칸 묶음 안에서 Esc를 누르면 닫고 초점을 '?'로 돌린다.
 * 설명 상자는 칸의 aria-describedby가 가리킨다. 닫혀 있어도(hidden) 화면 읽기 프로그램은 칸에 들어갈 때
 * 설명을 읽는다 — 숨은 요소도 aria-describedby로 가리키면 설명이 된다. 그래서 '?'를 열지 않아도 설명을 놓치지 않는다.
 */
import { useRef, useState, type KeyboardEvent, type RefObject } from "react";

import styles from "./TermHelp.module.css";

/** '?'와 설명 상자의 열림 상태. onKeyDown은 칸 묶음 바깥 요소에 건다(Esc) */
export function useTermHelp() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  }
  return { open, toggle: () => setOpen((o) => !o), buttonRef, onKeyDown };
}

interface ButtonProps {
  /** 항목 이름. 버튼 이름('전용면적 도움말')에 쓴다 */
  label: string;
  open: boolean;
  panelId: string;
  onToggle: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
}

/** '?' 버튼. 설명 상자(HelpPanel)는 따로 그린다 — 이름 줄과 칸 사이에 끼우려고 */
export function TermHelpButton({ label, open, panelId, onToggle, buttonRef }: ButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={styles.button}
      aria-label={`${label} 도움말`}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
    >
      ?
    </button>
  );
}

/** 설명 상자. text는 서버가 준 how_to_check 그대로 */
export function HelpPanel({ text, panelId, open }: { text: string; panelId: string; open: boolean }) {
  return (
    <div id={panelId} className={styles.panel} hidden={!open}>
      {text}
    </div>
  );
}

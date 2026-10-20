/*
 * 버튼 4종(주·보조·글자, 그리고 잠김)과 버튼 안 로딩. 시안 B0 묶음 2, 묶음 9 ②.
 *
 * 주 버튼도 무채색이다 — 색 있는 버튼은 판정 배지와 경쟁한다(설계서 11.5).
 *
 * 잠김과 로딩은 `disabled` 대신 `aria-disabled`로 막는다. `disabled`를 걸면 누른 순간
 * 초점이 버튼에서 떨어져 화면 읽기 프로그램 사용자가 자리를 잃고, 잠긴 이유도 탭으로
 * 찾아갈 수 없다. 대신 누름을 직접 무시한다(폼 제출도 막으려고 preventDefault).
 *
 * 로딩: onClick이 Promise를 돌려주면 끝날 때까지 버튼이 스스로 잠긴다. 두 번 눌러 답이
 * 두 번 들어가는 것을 막는 자리다(N4). 상태(useState)는 다시 그려진 뒤에야 바뀌므로,
 * 아주 빠른 두 번 누름을 막으려고 ref로도 같이 막는다.
 *
 * 실패: 버튼은 잠금을 풀 뿐 실패를 해석하지 않는다. 무엇을 보여 줄지는 화면마다 달라서,
 * 실패 처리는 onClick이 돌려준 Promise를 가진 부모가 한다(예: Sidebar의 '내 기록 지우기').
 * 버튼이 기다리면서 실패를 다시 던지면 받을 곳이 없어 '처리되지 않은 rejection'이 되므로
 * 버튼 안에서는 다시 던지지 않는다. 부모가 처리하지 않은 실패는 화면에 아무 표시가 없으니,
 * 실패할 수 있는 일은 부모가 반드시 잡아 사용자에게 알린다.
 */
import { useId, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { Icon, type IconName } from "./Icon";
import styles from "./Button.module.css";

interface ButtonProps {
  children: ReactNode;
  variant?: "primary" | "secondary" | "text";
  /** 글자 버튼 앞 아이콘(예: 처음부터 다시의 ←) */
  icon?: IconName;
  type?: "button" | "submit";
  /** 있으면 잠긴다. 잠긴 이유를 버튼 바로 아래 한 줄로 적는다(색만 흐리게 하지 않음) */
  lockedReason?: string;
  /** 로딩 중 버튼 안 글자 */
  busyLabel?: string;
  onClick?: () => void | Promise<unknown>;
}

export function Button({
  children,
  variant = "primary",
  icon,
  type = "button",
  lockedReason,
  busyLabel = "보내는 중",
  onClick,
}: ButtonProps) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const reasonId = useId();
  const locked = Boolean(lockedReason) || busy;

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (locked || busyRef.current) {
      event.preventDefault();
      return;
    }
    const result = onClick?.();
    if (!(result instanceof Promise)) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await result;
    } catch {
      // 위 설명대로 부모 몫이다. 여기서는 잠금만 푼다
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <span className={styles.wrap}>
      <button
        type={type}
        className={`${styles.button} ${styles[variant]}`}
        aria-disabled={locked || undefined}
        aria-busy={busy || undefined}
        aria-describedby={lockedReason ? reasonId : undefined}
        onClick={handleClick}
      >
        {busy ? <span className={styles.spin}><Icon name="loader" /></span> : icon && <Icon name={icon} size={15} />}
        {busy ? busyLabel : children}
      </button>
      {/* 화면 읽기 프로그램에 "보내는 중"을 알린다. 영역은 늘 두고 글만 바꿔야 읽힌다 */}
      <span className="sr-only" aria-live="polite">
        {busy ? busyLabel : ""}
      </span>
      {lockedReason && (
        <span id={reasonId} className={styles.reason}>
          {lockedReason}
        </span>
      )}
    </span>
  );
}

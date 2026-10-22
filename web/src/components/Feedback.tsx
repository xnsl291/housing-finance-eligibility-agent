/*
 * 기다림·오류·알림. 시안 B0 묶음 9(로딩 3종 중 문장·뼈대 — 버튼 로딩은 Button), 묶음 10(오류),
 * 묶음 14(완료 알림).
 *
 * 바뀌는 안내는 눈으로만 보여서는 안 된다. 화면 읽기 프로그램이 바뀔 때 읽도록 aria-live를
 * 단다(설계서 11.3). live 영역은 늘 두고 안의 글만 바꾼다 — 글과 영역이 함께 새로 생기면
 * 읽지 않는 프로그램이 있다.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import styles from "./Feedback.module.css";

const SLOW_MS = 10_000;

/**
 * 문장 읽기처럼 몇 초 걸리는 일(시안 '로딩 문장'). CSS로 움직이므로 서버를 기다리는 동안에도
 * 멈추지 않는다. 10초가 넘으면 한 줄을 더해 멈춘 게 아님을 알린다(C-LOADING [제안 P2]).
 */
export function LoadingSentence({ label }: { label: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={styles.sentence} role="status" aria-live="polite">
      <span className={styles.dots} aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <strong>{label}</strong>
      {slow && <span className={styles.slow}>조금 더 걸리고 있습니다</span>}
    </div>
  );
}

/** 첫 진입 뼈대. 상품·항목 목록을 받는 동안. 눈에는 글자를 넣지 않는다(시안) */
export function Skeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true">
      <span className="sr-only">불러오는 중입니다</span>
      <span className={styles.bone} style={{ width: 160 }} />
      <span className={styles.bone} />
      <span className={styles.bone} />
      <span className={styles.bone} style={{ width: 220 }} />
    </div>
  );
}

interface SystemErrorProps {
  /** 예: "지금 판정 서버에 연결할 수 없습니다", "문장을 읽는 데 너무 오래 걸려 중단했습니다" */
  title: string;
  /** "조건의 문제가 아닙니다"가 드러나는 본문. 화면마다 남아 있는 것이 달라 화면이 정한다 */
  children: ReactNode;
  onRetry: () => void | Promise<unknown>;
  /** 제목 앞 아이콘. 기본은 서버 꺼짐. 서버는 살아 있는 오류(문장 해석 실패·시간 초과)는 다른 모양을 쓴다(시안 S1-d·S1-f) */
  icon?: IconName;
  /** 다시 시도 버튼 글. 같은 화면에 상자가 둘 뜰 수 있는 자리(E1)에서 무엇을 다시 하는지 구분하려고 */
  retryLabel?: string;
  /**
   * 버튼 무게. 기본은 보조 버튼. 다시 해도 소용없고 그 버튼이 유일한 길인 자리(E2 세션 없음의 '처음부터')는
   * 주 버튼으로(시안 E2)
   */
  retryVariant?: "primary" | "secondary";
  /** 있으면 다시 시도 버튼을 잠근다(예: 고친 값을 저장하는 중 — 끝나면 화면이 다시 받는다) */
  lockedReason?: string;
}

/**
 * 시스템 오류(서버 꺼짐·시간 초과·세션 없음). 본문 맨 위 전면.
 * '조건 불충족' 판정과 섞이면 "서버가 안 됨"이 "당신은 안 됨"으로 읽힌다(G13). 그래서 빨강을
 * 쓰지 않고 먹색 굵은 테두리로, 판정 배지·입력 오류와 모양이 다르게 그린다.
 * 뜨면 초점을 제목으로 옮긴다(시안 C0 1절).
 *
 * role="alert"는 달지 않는다. 초점을 제목으로 옮기면 화면 읽기 프로그램이 제목을 읽는데,
 * alert까지 있으면 같은 오류를 두 번 읽거나 서로 끊는다. 둘 중 초점 이동을 남긴 이유:
 * 키보드 사용자의 자리도 '다시 시도' 바로 앞으로 옮겨 주고, 다른 화면 바뀜(질문 카드 등)과
 * 같은 방식이다. 묶음은 제목을 이름으로 단 영역(region)으로 둔다.
 */
export function SystemError({
  title,
  children,
  onRetry,
  icon = "serverOff",
  retryLabel = "다시 시도",
  retryVariant = "secondary",
  lockedReason,
}: SystemErrorProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className={styles.system} aria-labelledby={titleId}>
      <h2 id={titleId} ref={titleRef} tabIndex={-1} className={styles.systemTitle}>
        <Icon name={icon} size={18} />
        {title}
      </h2>
      <div className={styles.systemBody}>{children}</div>
      <Button variant={retryVariant} lockedReason={lockedReason} onClick={onRetry}>
        {retryLabel}
      </Button>
    </section>
  );
}

const TOAST_MS = 4_000;

/**
 * 완료 알림(예: 결과를 복사했습니다). 판정 4색을 쓰지 않는다. 몇 초 뒤 사라진다.
 * message가 null이면 아무것도 안 보이지만 live 영역은 남겨 둔다.
 * 실패를 알릴 때(예: 복사하지 못함)는 icon을 바꾼다. 체크 표시 옆에 실패 글이 있으면 눈으로는 성공으로 읽힌다
 */
export function Toast({
  message,
  onClose,
  icon = "check",
}: {
  message: string | null;
  onClose: () => void;
  icon?: IconName;
}) {
  // 부모가 onClose를 매 렌더 새 함수로 넘겨도(`() => setMessage(null)`) 타이머가 다시 시작되면
  // 알림이 사라지지 않는다. 타이머는 message에만 걸고, 닫을 때는 그때의 최신 onClose를 부른다
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => closeRef.current(), TOAST_MS);
    return () => clearTimeout(t);
  }, [message]);

  return (
    <div role="status" aria-live="polite" className={styles.toastArea}>
      {message && (
        <div className={styles.toast}>
          <Icon name={icon} />
          {message}
        </div>
      )}
    </div>
  );
}

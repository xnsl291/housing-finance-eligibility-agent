/*
 * 머리 영역과 단계 표시. 시안 B0 묶음 12, 설계서 4절 C-HEADER.
 *
 * 단계 표시는 눌러서 이동하는 탭이 아니다. 되돌아가는 길 제약(설계서 3.2)을 풀기 전에는
 * 누르게 만들면 안 되므로 버튼도 링크도 아니고, 탭으로 가지도 않는다(시안 C0 3절).
 * 단계는 따로 저장하지 않고 화면이 가진 값으로 계산해 넘긴다.
 *
 * 연결 상태는 정상일 때 작은 점 한 줄뿐이다. 끊기면 본문 맨 위에 시스템 오류가 뜬다
 * (머리나 사이드바에만 빨간 글씨를 두지 않음 — 결함 D5).
 */
import { Icon } from "./Icon";
import { Notice } from "./Notice";
import styles from "./AppHeader.module.css";

/** 서버 쪽 화면의 STEPS(`ui/app.py`)와 같은 순서·이름 */
export const STEPS = ["조건 입력", "읽은 내용 확인", "하나씩 확인", "판정 결과"] as const;

export type Step = 0 | 1 | 2 | 3;

/** step: 0 조건 입력 · 1 읽은 내용 확인 · 2 하나씩 확인 · 3 판정 결과 */
export function StepIndicator({ step }: { step: Step }) {
  return (
    <>
      <ol className={styles.steps} aria-label="진행 단계">
        {STEPS.map((name, i) => (
          <li key={name} className={styles.stepItem}>
            {i > 0 && (
              <span className={styles.sep}>
                <Icon name="chevronRight" size={15} />
              </span>
            )}
            <span
              className={`${styles.step} ${i < step ? styles.done : i === step ? styles.now : styles.next}`}
              aria-current={i === step ? "step" : undefined}
            >
              {i < step && <Icon name="check" size={14} />}
              {name}
              {i < step && <span className="sr-only"> (끝남)</span>}
            </span>
          </li>
        ))}
      </ol>
      {/* 좁은 화면: 네 칸을 가로로 늘어놓으면 글자가 잘려 'N / 4 단계 + 막대'로(시안 폭 390) */}
      <div className={styles.compact}>
        <span className={styles.compactText}>
          {step + 1} / 4 단계 · {STEPS[step]}
        </span>
        <span className={styles.bars} aria-hidden="true">
          {STEPS.map((name, i) => (
            <span key={name} className={i <= step ? styles.barOn : styles.bar} />
          ))}
        </span>
      </div>
    </>
  );
}

export function AppHeader({ step, connected }: { step: Step; connected: boolean }) {
  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <span className={styles.title}>주거금융 지원가능성 판정</span>
        <span className={styles.connection}>
          <span className={styles.dot} aria-hidden="true" />
          {connected ? "연결됨" : "연결 안 됨"}
        </span>
      </div>
      <Notice kind="header" />
      <StepIndicator step={step} />
    </header>
  );
}

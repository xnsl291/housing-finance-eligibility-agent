/*
 * 질문 카드. 시안 B0 묶음 6, 하나씩 확인 화면(S3).
 *
 * 질문은 제안이고 강제가 아니다 — 매 질문에 '모르겠어요'가 있다.
 * '왜 묻는지'는 이 화면이 그냥 설문과 다른 이유라 눈에 띄게 두고 줄이지 않는다(설계서 10.3).
 * '모르겠어요'를 누르면 그 항목은 다시 나오지 않으므로 누르기 전에 알린다(시안 C0 8절).
 *
 * 초점: 질문이 바뀌면 질문 제목으로 옮긴다. 같은 화면이라도 내용이 바뀌므로, 옮기지 않으면
 * 화면 읽기 프로그램 사용자는 다음 질문이 나온 것을 모른다(시안 C0 1절).
 */
import { useEffect, useId, useRef, type ReactNode } from "react";

import { Button } from "./Button";
import { Icon } from "./Icon";
import styles from "./QuestionCard.module.css";

interface QuestionCardProps {
  /** 항목 이름표(서버 question.label) */
  title: string;
  /** 왜 묻는지(서버 question.why) */
  why: string;
  /** 값이 기준에 걸쳐 다시 묻는 경우의 지금 아는 값 글 */
  known?: string;
  howToCheck?: string | null;
  /** 답 칸. 선택지 묶음 이름으로 쓸 제목 id를 받는다 */
  children: (titleId: string) => ReactNode;
  /** 답을 고르거나 적었는가. 아니면 '답하기'가 잠긴다 */
  answerReady: boolean;
  onAnswer: () => void | Promise<unknown>;
  onDecline: () => void | Promise<unknown>;
}

export function QuestionCard({
  title,
  why,
  known,
  howToCheck,
  children,
  answerReady,
  onAnswer,
  onDecline,
}: QuestionCardProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const firstShow = useRef(true);

  useEffect(() => {
    // 처음 그릴 때는 화면을 끌어내리지 않고 초점만 옮긴다
    titleRef.current?.focus({ preventScroll: firstShow.current });
    firstShow.current = false;
  }, [title]);

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <h2 id={titleId} ref={titleRef} tabIndex={-1} className={styles.title}>
        {title}
      </h2>
      <p className={styles.why}>
        <Icon name="info" />
        <span>{why}</span>
      </p>
      {known && (
        <div className={styles.known}>
          <span className={styles.knownLabel}>지금 아는 값</span>
          <span>{known}</span>
        </div>
      )}
      {children(titleId)}
      {howToCheck && (
        <p className={styles.how}>
          <Icon name="externalLink" size={14} />
          <span>확인 방법: {howToCheck}</span>
        </p>
      )}
      <div className={styles.buttons}>
        <Button onClick={onAnswer} lockedReason={answerReady ? undefined : "답을 고르거나 적으면 누를 수 있습니다"}>
          답하기
        </Button>
        <Button variant="secondary" onClick={onDecline}>
          모르겠어요
        </Button>
      </div>
      <p className={styles.declineNote}>
        ‘모르겠어요’를 고르면 이 항목은 다시 묻지 않습니다. 나중에 결과 화면의 ‘이 조건으로
        판정했습니다’에서 값을 넣을 수 있습니다.
      </p>
    </section>
  );
}

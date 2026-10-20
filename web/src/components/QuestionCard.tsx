/*
 * 질문 카드. 시안 B0 묶음 6, 하나씩 확인 화면(S3).
 *
 * 질문은 제안이고 강제가 아니다 — 매 질문에 '모르겠어요'가 있다.
 * '왜 묻는지'는 이 화면이 그냥 설문과 다른 이유라 눈에 띄게 두고 줄이지 않는다(설계서 10.3).
 * '모르겠어요'를 누르면 그 항목은 다시 나오지 않으므로 누르기 전에 알린다(시안 C0 8절).
 *
 * 초점: 질문이 바뀌면 질문 제목으로 옮긴다. 같은 화면이라도 내용이 바뀌므로, 옮기지 않으면
 * 화면 읽기 프로그램 사용자는 다음 질문이 나온 것을 모른다(시안 C0 1절).
 * '질문이 바뀌었다'는 제목 글이 아니라 questionKey로 판단한다. 같은 항목을 값이 기준에 걸쳐
 * 다시 물으면 제목이 같아 초점이 안 옮겨지고, 반대로 같은 질문의 글만 고쳐져도 초점이 튄다.
 *
 * 두 버튼은 카드 하나의 대기 상태를 같이 쓴다. '답하기'를 보내는 동안 '모르겠어요'가 눌리면
 * 한 질문에 답과 모름이 둘 다 서버로 간다. 버튼마다 따로 잠그면 이 경우를 못 막는다.
 * 상태(useState)는 다시 그려진 뒤에야 바뀌므로 같은 순간 두 번 누름은 ref로 막는다.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "./Button";
import { Icon } from "./Icon";
import styles from "./QuestionCard.module.css";

const WAIT_REASON = "보내는 중이라 잠시 누를 수 없습니다";

interface QuestionCardProps {
  /** 질문 식별자. 부르는 쪽이 필드명+순번(예: `household_head_status:2`)을 넘긴다. 바뀌면 초점을 옮긴다 */
  questionKey: string;
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
  questionKey,
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
  // 지금 기다리는 쪽. 다른 쪽 버튼을 잠그는 데 쓴다
  const [pending, setPending] = useState<"answer" | "decline" | null>(null);
  const pendingRef = useRef(false);

  function send(which: "answer" | "decline", action: () => void | Promise<unknown>) {
    return () => {
      if (pendingRef.current) return;
      const result = action();
      if (!(result instanceof Promise)) return;
      pendingRef.current = true;
      setPending(which);
      return result.finally(() => {
        pendingRef.current = false;
        setPending(null);
      });
    };
  }

  useEffect(() => {
    // 처음 그릴 때는 화면을 끌어내리지 않고 초점만 옮긴다
    titleRef.current?.focus({ preventScroll: firstShow.current });
    firstShow.current = false;
  }, [questionKey]);

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
        <Button
          onClick={send("answer", onAnswer)}
          lockedReason={
            pending === "decline"
              ? WAIT_REASON
              : answerReady
                ? undefined
                : "답을 고르거나 적으면 누를 수 있습니다"
          }
        >
          답하기
        </Button>
        <Button
          variant="secondary"
          onClick={send("decline", onDecline)}
          lockedReason={pending === "answer" ? WAIT_REASON : undefined}
        >
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

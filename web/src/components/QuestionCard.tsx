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
 * 카드 밖에서 보내는 중(저장 실패 상자의 '다시 시도')이면 부모가 sending으로 알려 두 버튼을 함께 잠근다.
 *
 * 서버가 답을 거절한 사유(422)는 카드 맨 아래에 둔다(시안 S3-c). 선택지 묶음에는 칸별 오류 자리가 없고,
 * 어느 칸 종류든 같은 자리에 보이는 편이 찾기 쉽다. 서버 사유는 사람이 쓴 문장이 아닐 수 있어(결함 D10)
 * 앞에 읽을 한 줄을 두고 원문은 괄호로 뒤에 붙인다 — 원문을 지우면 문의할 때 단서가 사라진다(시안 S3-c 메모).
 * 그 줄은 답 칸이 설명(aria-describedby)으로 가리킨다. 그래서 children에 그 줄의 id를 넘긴다.
 *
 * 부모가 준 잠긴 이유(연결 끊김 등)는 버튼마다 적지 않고 카드에 한 줄만 둔다. 같은 말이 버튼 아래 거듭 보이고
 * 화면 읽기 프로그램이 거듭 읽는다. 두 버튼은 그 줄을 설명으로 가리킨다.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "./Button";
import { FieldError } from "./Field";
import { Icon } from "./Icon";
import styles from "./QuestionCard.module.css";

const WAIT_REASON = "보내는 중이라 잠시 누를 수 없습니다";
const NOT_READY = "답을 고르거나 적으면 누를 수 있습니다";
const FIX_INPUT = "위 칸의 입력을 고쳐 주세요";

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
  /** 답 칸. 선택지 묶음 이름으로 쓸 제목 id와, 거절 사유가 있으면 그 줄의 id(칸의 aria-describedby로)를 받는다 */
  children: (titleId: string, describedBy: string | undefined) => ReactNode;
  /** 답을 고르거나 적었는가. 아니면 '답하기'가 잠긴다 */
  answerReady: boolean;
  /** 칸에 못 읽는 글이 있는가(금액을 못 읽음 등). 그러면 '답하기' 잠긴 이유가 '고쳐 주세요'로 바뀐다 */
  inputProblem?: boolean;
  /** 부모가 카드 밖에서 보내는 중(다시 시도). 두 버튼을 함께 잠근다 */
  sending?: boolean;
  onAnswer: () => void | Promise<unknown>;
  onDecline: () => void | Promise<unknown>;
  /** 있으면 두 버튼을 함께 잠그고 이 이유를 적는다(예: 서버에 연결되지 않음 — 설계서 E1) */
  lockedReason?: string;
  /** 서버가 답을 거절한 사유(422) 원문. 카드 맨 아래 읽을 한 줄 뒤에 붙인다 */
  error?: string | null;
}

export function QuestionCard({
  questionKey,
  title,
  why,
  known,
  howToCheck,
  children,
  answerReady,
  inputProblem,
  sending,
  onAnswer,
  onDecline,
  lockedReason,
  error,
}: QuestionCardProps) {
  const titleId = useId();
  const errorId = useId();
  const lockId = useId();
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
      {children(titleId, error ? errorId : undefined)}
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
            lockedReason ??
            (pending === "decline" || (sending && pending === null)
              ? WAIT_REASON
              : answerReady
                ? undefined
                : inputProblem
                  ? FIX_INPUT
                  : NOT_READY)
          }
          reasonId={lockedReason ? lockId : undefined}
        >
          답하기
        </Button>
        <Button
          variant="secondary"
          onClick={send("decline", onDecline)}
          lockedReason={lockedReason ?? (pending === "answer" || (sending && pending === null) ? WAIT_REASON : undefined)}
          reasonId={lockedReason ? lockId : undefined}
        >
          모르겠어요
        </Button>
      </div>
      {lockedReason && (
        <p id={lockId} className={styles.lockNote}>
          {lockedReason}
        </p>
      )}
      {/* 결과 화면에서 값을 넣는 길(S7)은 아직 없어 약속하지 않는다 */}
      <p className={styles.declineNote}>‘모르겠어요’를 고르면 이 항목은 다시 묻지 않습니다.</p>
      <FieldError
        id={errorId}
        message={error ? `이 값으로는 저장하지 못했습니다. (서버가 보낸 사유: ${error})` : null}
      />
    </section>
  );
}

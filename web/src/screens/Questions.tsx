/*
 * S3 하나씩 확인. 설계서 6절 S3, 시안 S3(Zxcoj)·S3-a~f·S3-M1.
 *
 * 판정에 필요한 값만 서버가 정한 순서로 하나씩 묻는다. 무엇을 물을지 화면이 정하지 않는다 — 들어올 때와 답할 때마다
 * 서버에 "다음에 뭘 할까"(GET /next)를 묻고, 서버가 질문 하나(ASK)를 주거나 "결과를 내라"(RESULT)고 한다.
 * 질문은 제안이고 강제가 아니다. 매 질문에 '모르겠어요'가 있고 언제든 그만 묻고 결과를 볼 수 있다.
 *
 * 서버와 주고받는 일과 실패 나누기는 useQuestionFlow.ts, 칸 종류별 답 칸은 QuestionInput.tsx. 여기서는 그린다.
 * - RESULT면 바로 결과로 간다. 멈춘 이유는 넘기지 않는다(아래 S4와의 약속)
 * - 세션 없음(404)은 E2, 연결 안 됨은 맨 위 E1 상자 하나. 고른 답은 칸에 두고 버튼만 잠근다(설계서 E1 S3 줄)
 * - 다음 질문을 못 받거나 답 저장이 서버 오류로 실패하면 '다시 시도'와 아래 '그만 묻고 결과 보기'를 남긴다
 *   (결함 D15 — Streamlit 화면은 거기서 끝나 '처음부터 다시'만 남았다)
 * - 진행 줄에는 질문 총 개수·남은 개수를 쓰지 않는다(설계서 N3 — 실제 사용자로 잰 적이 없다). 확인 수는 AppState.tsx
 *
 * S4와의 약속: S3는 결과 화면에 멈춘 이유를 넘기지 않는다. S4가 next를 다시 불러 RESULT면 서버가 준 이유를,
 * ASK면(아직 물을 것이 남았는데 결과로 옴) '사용자가 멈춤'으로 판단한다. next는 기록을 쓰지 않아 몇 번 불러도
 * 같은 답이므로(api.py get_next) 새로 고친 뒤에도 같은 판단이 나온다. 라우터 state로 넘기면 새로 고칠 때 사라진다.
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Skeleton, SystemError } from "../components/Feedback";
import { Icon } from "../components/Icon";
import { QuestionCard } from "../components/QuestionCard";
import { useAppState } from "./AppState";
import { Missing } from "./Confirm";
import { describeFailure, isTimeout } from "./failure";
import { QuestionInput, valueToSend } from "./QuestionInput";
import { sessionPath } from "./routes";
import { useQuestionFlow } from "./useQuestionFlow";
import screen from "./Screen.module.css";
import styles from "./Questions.module.css";

const OFFLINE_LOCK = "서버에 연결되지 않아 지금은 보낼 수 없습니다.";

export function Questions() {
  const { sessionId = "" } = useParams();
  const { connected, recheckConnection, answeredCount } = useAppState();
  const { load, answer, changeAnswer, rejected, saveFailure, retry, sending, hasValues, fetchNext, save } =
    useQuestionFlow(sessionId);
  const count = answeredCount(sessionId);
  // 확인 수는 앱 메모리라 새로 고치면 0부터 센다(AppState.tsx). 세션에 값이 있는데 0이라고 쓰면 사실과 다르므로,
  // 이 화면에서 센 것이 있거나 세션이 비어 있다고 확인됐을 때만 수를 쓴다
  const showCount = count > 0 || hasValues === false;

  if (load.kind === "missing") return <Missing />;

  const offline = connected === false || load.kind === "offline";
  async function reconnect() {
    await recheckConnection();
    if (load.kind !== "ask") await fetchNext(true);
  }

  return (
    <>
      {offline && (
        <SystemError title="지금 판정 서버에 연결할 수 없습니다" retryLabel="다시 연결 확인" onRetry={reconnect}>
          <span className={styles.line}>조건의 문제가 아닙니다.</span>
          {load.kind === "ask" && <span className={styles.line}>고르신 답은 화면에 그대로 있습니다.</span>}
        </SystemError>
      )}
      <section className={screen.heading}>
        <span className={screen.eyebrow}>하나씩 확인</span>
        <h1 className={screen.title}>몇 가지만 더 여쭙겠습니다</h1>
      </section>
      <div className={styles.progress}>
        <p className={styles.progressLine}>
          <Icon name="check" size={15} />
          판정에 필요한 것만 하나씩 여쭙니다{showCount && ` · 지금까지 ${count}개 확인`}
        </p>
        <p className={styles.progressNote}>남은 질문 수는 답에 따라 달라집니다. 언제든 멈추고 결과를 볼 수 있습니다.</p>
      </div>

      <div className={styles.body}>
        {load.kind === "loading" && <Skeleton />}
        {/* 연결이 끊겼으면 맨 위 상자 하나만(Confirm.tsx와 같은 이유 — 두 상자가 초점을 다툼) */}
        {load.kind === "failed" && !offline && (
          <NextFailed error={load.error} count={count} onRetry={() => fetchNext(true)} />
        )}
        {load.kind === "ask" && (
          <QuestionCard
            questionKey={load.key}
            title={load.question.label}
            why={load.question.why}
            known={load.known}
            howToCheck={load.question.how_to_check}
            answerReady={valueToSend(answer) !== null}
            inputProblem={answer.problem !== null}
            lockedReason={offline ? OFFLINE_LOCK : undefined}
            // 다시 시도처럼 카드 밖에서 보내는 동안에도 카드 버튼을 잠근다
            sending={sending}
            error={rejected}
            onAnswer={() => save("answer")}
            onDecline={() => save("decline")}
          >
            {(titleId, describedBy) => (
              <QuestionInput
                key={load.key}
                question={load.question}
                titleId={titleId}
                describedBy={describedBy}
                answer={answer}
                onChange={changeAnswer}
              />
            )}
          </QuestionCard>
        )}
        {saveFailure && !offline && (
          <SaveFailed key={saveFailure.id} error={saveFailure.error} onRetry={retry} />
        )}
      </div>

      <StopActions
        sessionId={sessionId}
        stopLock={offline ? OFFLINE_LOCK : sending ? "답을 보내는 중이라 잠시 누를 수 없습니다" : undefined}
        // 지울 것이 있을 때만 확인 창(설계서 M1). 세션 상태를 못 받았으면 있다고 본다
        dirty={count > 0 || hasValues !== false}
      />
    </>
  );
}

/** 맨 아래 버튼 줄(그만 묻고 결과 보기 · 처음부터 다시)과 처음부터 다시 확인 창(M1, 시안 S3-M1) */
function StopActions({ sessionId, stopLock, dirty }: { sessionId: string; stopLock: string | undefined; dirty: boolean }) {
  const navigate = useNavigate();
  const { draft, rememberSession } = useAppState();
  const [askBack, setAskBack] = useState(false);
  // 떠나면 주소에서 이 세션이 빠진다. 새로 고친 뒤라 이 탭의 연 세션 목록에 없으면 '내 기록 지우기'가 더는
  // 이 세션을 못 지우므로, 떠나기 전에 목록에 넣는다(확인 창이 "'내 기록 지우기'로 지울 수 있습니다"라고 약속함)
  function backToWrite() {
    rememberSession(sessionId);
    navigate("/write");
  }
  return (
    <>
      <section className={styles.actions} aria-label="질문 멈추기">
        {/* 판정은 S4가 한다(머리말 S4와의 약속). 여기서는 주소만 옮긴다 */}
        <Button variant="secondary" lockedReason={stopLock} onClick={() => navigate(sessionPath(sessionId, "result"))}>
          그만 묻고 지금까지로 결과 보기
        </Button>
        <span className={styles.back}>
          <Button variant="text" icon="arrowLeft" onClick={() => (dirty ? setAskBack(true) : backToWrite())}>
            처음부터 다시
          </Button>
        </span>
      </section>

      <ConfirmDialog
        open={askBack}
        title="처음부터 다시 할까요?"
        confirmLabel="처음부터"
        cancelLabel="계속하기"
        onConfirm={() => {
          setAskBack(false);
          backToWrite();
        }}
        onCancel={() => setAskBack(false)}
      >
        {/* 설계서 M1의 "사라집니다"는 쓰지 않는다. 이 버튼은 화면만 S1로 옮기고 서버 세션은 지우지 않으므로
            사실과 다른 약속이 된다(G12). 사이드바 전체 초기화 창(RESET_NOTE "서버에 남은 기록은 지워지지 않습니다")과
            같은 말을 쓰고, 지우는 길(내 기록 지우기 — backToWrite가 지킴)을 덧붙인다. 적은 문장은 앱 메모리에 있어
            S1 칸에 그대로 남는다. 직접 입력으로 시작했거나 새로 고친 뒤라 문장이 없으면 '남습니다'를 말하지 않는다 */}
        처음부터 다시 시작합니다. 지금까지 고치고 답한 값은 새 판정에 쓰지 않습니다. 서버에 남은 기록은 지워지지
        않으며, ‘내 기록 지우기’로 지울 수 있습니다.
        {draft.trim() !== "" && " 적어 두신 문장은 남습니다."}
      </ConfirmDialog>
    </>
  );
}

/** 서버가 준 거절 사유는 그대로, 그 밖(시간 초과 등)은 failure.ts의 문장으로 */
function reasonLines(error: unknown) {
  if (error instanceof ApiError && error.kind === "http") {
    return (
      <>
        <span className={styles.line}>조건의 문제가 아닙니다.</span>
        <span className={styles.line}>사유: {error.message}</span>
      </>
    );
  }
  return <span className={styles.line}>{describeFailure(error, "start").body}</span>;
}

/** 다음 질문을 못 받음(시안 S3-d, 결함 D15). 아래 '그만 묻고 결과 보기'는 그대로 남는다 */
function NextFailed({ error, count, onRetry }: { error: unknown; count: number; onRetry: () => Promise<void> }) {
  return (
    <SystemError title="다음 질문을 받지 못했습니다" icon={describeFailure(error, "start").icon} onRetry={onRetry}>
      {reasonLines(error)}
      {/* 확인 수는 저장이 성공했을 때만 늘므로, 센 것은 서버에 있다. 모르겠어요도 세므로 '답하신'이 아니라 '확인하신' */}
      {count > 0 && <span className={styles.line}>지금까지 확인하신 {count}개는 서버에 그대로 있습니다.</span>}
      <span className={styles.line}>다시 시도하거나, 지금까지로 결과를 볼 수 있습니다.</span>
    </SystemError>
  );
}

/**
 * 답 저장이나 모름 기록이 서버 오류·시간 초과로 실패함. 다시 시도는 실패한 일을 지금 화면의 답으로 다시 한다
 * (useQuestionFlow.ts retry — 실패 뒤 답을 바꿨으면 바꾼 값이 간다).
 * 시간 초과는 서버가 저장을 마쳤는지 모르므로 "저장하지 못했습니다"라고 단정하지 않는다. 다시 보내도
 * 안전하다(값은 덮어쓰고, 모름은 같은 항목을 한 번 더 기록할 뿐)
 */
function SaveFailed({ error, onRetry }: { error: unknown; onRetry: () => Promise<void> | undefined }) {
  const text = describeFailure(error, "start");
  return (
    <SystemError title={isTimeout(error) ? text.title : "답을 저장하지 못했습니다"} icon={text.icon} onRetry={onRetry}>
      {reasonLines(error)}
      <span className={styles.line}>고르신 답은 화면에 그대로 있습니다. 다시 시도하거나, 지금까지로 결과를 볼 수 있습니다.</span>
    </SystemError>
  );
}

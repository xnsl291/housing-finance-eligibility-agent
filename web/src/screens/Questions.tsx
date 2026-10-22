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
 * S7 '지금까지 확인한 항목'(접힘, 시안 S3-e) — 값이 있는 항목과 모른다고 한 항목. 줄마다 고치기를 저장하면 그 값만 보내고
 * 다음 질문을 다시 받는다(HeldList.tsx·useValueEdit.ts). 질문 카드와 고치기는 서로 보내는 동안 잠근다 — 한쪽이 보내는 중에
 * 다른 쪽이 보내면 어느 값으로 다음 질문을 받았는지 알 수 없다.
 * S8 이어서 하기 배너는 제목 아래(ResumeBanner.tsx).
 *
 * S4와의 약속: S3는 결과 화면에 멈춘 이유를 넘기지 않는다. S4가 next를 다시 불러 RESULT면 서버가 준 이유를,
 * ASK면(아직 물을 것이 남았는데 결과로 옴) '사용자가 멈춤'으로 판단한다. next는 기록을 쓰지 않아 몇 번 불러도
 * 같은 답이므로(api.py get_next) 새로 고친 뒤에도 같은 판단이 나온다. 라우터 state로 넘기면 새로 고칠 때 사라진다.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api, ApiError } from "../api/client";
import type { FieldCatalog } from "../api/types";
import { Button } from "../components/Button";
import { Skeleton, SystemError } from "../components/Feedback";
import { Icon } from "../components/Icon";
import { QuestionCard } from "../components/QuestionCard";
import { useAlive, useAppState } from "./AppState";
import { Missing } from "./Confirm";
import { describeFailure, isTimeout } from "./failure";
import { heldItems } from "./heldItems";
import { HeldList } from "./HeldList";
import { QuestionInput, valueToSend } from "./QuestionInput";
import { ResumeBanner } from "./ResumeBanner";
import { sessionPath } from "./routes";
import { StartOver } from "./StartOver";
import { useQuestionFlow } from "./useQuestionFlow";
import { useValueEdit } from "./useValueEdit";
import screen from "./Screen.module.css";
import styles from "./Questions.module.css";

const OFFLINE_LOCK = "서버에 연결되지 않아 지금은 보낼 수 없습니다.";

export function Questions() {
  const { sessionId = "" } = useParams();
  const { connected, recheckConnection, answeredCount } = useAppState();
  const flow = useQuestionFlow(sessionId);
  const { load, answer, changeAnswer, rejected, saveFailure, retry, hasValues, fetchNext, save } = flow;
  // S7 고치기 저장. 끝나면 다음 질문을 다시 받는다(useQuestionFlow.ts 머리말)
  const edit = useValueEdit(sessionId, () => fetchNext(false));
  // 답 저장과 고치기 저장은 서로를 잠근다(머리말)
  const sending = flow.sending || edit.saving;
  const count = answeredCount(sessionId);
  // 확인 수는 앱 메모리라 새로 고치면 0부터 센다(AppState.tsx). 세션에 값이 있는데 0이라고 쓰면 사실과 다르므로,
  // 이 화면에서 센 것이 있거나 세션이 비어 있다고 확인됐을 때만 수를 쓴다
  const showCount = count > 0 || hasValues === false;
  // 지울 것이 있을 때만 확인 창(설계서 M1). 세션 상태를 못 받았으면 있다고 본다
  const dirty = count > 0 || hasValues !== false;
  const busy = edit.saving ? "고친 값을 저장하는 중이라" : flow.sending ? "답을 보내는 중이라" : null;

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
      <ResumeBanner sessionId={sessionId} dirty={dirty} />
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

      <HeldSection records={flow.records} edit={edit} offline={offline} answering={flow.sending} fetching={flow.fetching} />

      <StopActions
        sessionId={sessionId}
        stopLock={offline ? OFFLINE_LOCK : busy ? `${busy} 잠시 누를 수 없습니다` : undefined}
        dirty={dirty}
      />
    </>
  );
}

/** S7 지금까지 확인한 항목(접힘, 시안 S3-e). 목록 재료를 못 받았으면 그렇다고 적는다 — 빈 목록으로 보이면 아무것도 없는 것으로 읽힌다 */
function HeldSection({
  records,
  edit,
  ...state
}: {
  records: ReturnType<typeof useQuestionFlow>["records"];
  edit: ReturnType<typeof useValueEdit>;
  offline: boolean;
  /** 질문 카드의 답을 보내는 중 */
  answering: boolean;
  /** 다음 질문을 받는 중(useQuestionFlow.ts 머리말 — 받는 중에 저장하면 고친 뒤의 질문을 받지 못한다) */
  fetching: boolean;
}) {
  const [openField, setOpenField] = useState<string | null>(null);
  const catalog = useCatalog();
  const lockedReason = state.offline
    ? OFFLINE_LOCK
    : state.answering
      ? "답을 보내는 중입니다."
      : state.fetching
        ? "다음 질문을 받는 중입니다."
        : undefined;
  if (records === null) return null;
  const items = records === "failed" ? null : heldItems(records.held.values, records.events, catalog);
  return (
    <details className={styles.held}>
      <summary>
        <Icon name="chevronRight" size={15} />
        지금까지 확인한 항목{items && ` ${items.length}개`} — 잘못된 값은 여기서 고칠 수 있습니다
      </summary>
      <div className={styles.heldBody}>
        {items ? (
          <HeldList
            items={items}
            catalog={catalog}
            openField={openField}
            onOpenField={setOpenField}
            onSave={edit.save}
            saving={edit.saving}
            lockedReason={lockedReason}
            afterSave="저장하면 다음 질문을 다시 받습니다."
          />
        ) : (
          <p className={styles.heldNote}>지금까지 확인한 항목을 불러오지 못했습니다. 다음 질문을 받을 때 다시 불러옵니다.</p>
        )}
      </div>
    </details>
  );
}

/** 고치기 칸의 종류·선택지(GET /v1/fields). 못 받으면 null — 목록은 보이되 고치기는 두지 않는다(HeldList.tsx) */
function useCatalog(): FieldCatalog | null {
  const alive = useAlive();
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  useEffect(() => {
    api.fields().then(
      (r) => alive.current && setCatalog(r.fields),
      () => {},
    );
  }, [alive]);
  return catalog;
}

/** 맨 아래 버튼 줄(그만 묻고 결과 보기 · 처음부터 다시). 처음부터 다시 확인 창(M1)은 S4와 함께 쓴다(StartOver.tsx) */
function StopActions({ sessionId, stopLock, dirty }: { sessionId: string; stopLock: string | undefined; dirty: boolean }) {
  const navigate = useNavigate();
  return (
    <section className={styles.actions} aria-label="질문 멈추기">
      {/* 판정은 S4가 한다(머리말 S4와의 약속). 여기서는 주소만 옮긴다 */}
      <Button variant="secondary" lockedReason={stopLock} onClick={() => navigate(sessionPath(sessionId, "result"))}>
        그만 묻고 지금까지로 결과 보기
      </Button>
      <span className={styles.back}>
        <StartOver sessionId={sessionId} dirty={dirty} />
      </span>
    </section>
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

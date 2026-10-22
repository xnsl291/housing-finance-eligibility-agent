/*
 * S3 하나씩 확인의 서버 주고받기 — 다음 질문 받기(GET /next)와 답 저장·모름 기록. 그리는 일은 Questions.tsx가 한다.
 * 화면과 나눈 이유: 받기·보내기·실패 나누기가 한 함수에 그리기와 섞이면 100줄을 넘고, 어느 실패가 어느 상자로
 * 가는지 한눈에 안 보인다.
 *
 * 실패 나누기(설계서 6절 S3 동작표·상태표, C-ERROR)
 * - 404 세션 없음 → missing(E2)
 * - 연결 안 됨 → Layout 연결 상태를 끊김으로(lostConnection). 다음 질문을 받다가였으면 offline
 * - 답을 서버가 거절함(422) → rejected. 같은 질문에 머물고 카드 안에 사유
 * - 그 밖(서버 오류·시간 초과) → 다음 질문이면 failed, 답 저장이면 saveFailure. 둘 다 다시 시도를 준다(결함 D15)
 *
 * 떠난 뒤 늦게 온 응답은 버린다(useAlive).
 *
 * 한 번에 하나만 보낸다
 * - 다음 질문 받기: 받는 중이면 새로 부르지 않는다(fetching). StrictMode가 효과를 두 번 돌리거나, 받는 중에
 *   '다시 연결 확인'·'다시 시도'를 눌러도 GET /next가 겹쳐 나가지 않는다
 * - 답 저장·모름 기록: 보내는 중이면 새로 보내지 않는다(sendingRef). 카드 버튼은 카드가 막지만 '다시 시도'는
 *   카드 밖에 있어, 여기서 막지 않으면 한 질문에 답과 모름이 둘 다 갈 수 있다
 *
 * S7 '지금까지 확인한 항목'(heldItems.ts)에 쓸 세션 값과 기록(trace)도 다음 질문을 받을 때마다 함께 받는다.
 * 고치기 저장(useValueEdit.ts, Questions.tsx가 부름)이 끝나면 다음 질문을 다시 받는다 — 고친 값에 따라 물을 것이 바뀐다.
 * 다음 질문을 받는 동안(fetching)은 화면이 고치기를 잠근다. 받는 중에 고치기를 저장하면 위 '받는 중이면 새로 부르지
 * 않는다' 때문에 고친 뒤의 질문을 받지 못한다
 *
 * 다음 질문 받기(useNextQuestion)와 답 보내기(useQuestionFlow)를 두 함수로 나눴다. S7 목록 재료가 붙으며 한 함수가
 * 150줄을 넘었다. 둘이 맞물리는 곳은 두 군데뿐이다 — 새 질문을 받으면 답 칸을 비우고(onAsk), 답을 보내면 다음 질문을 받는다
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "../api/client";
import type { Question, SessionState, TraceEvent } from "../api/types";
import { formatRange, formatWon } from "../components/amount";
import { useAlive, useAppState } from "./AppState";
import { NO_ANSWER, valueToSend, type Answer } from "./QuestionInput";
import { sessionPath } from "./routes";

type Load =
  | { kind: "loading" }
  /** key: 항목 + 이 화면에서 받은 질문 순번. 같은 항목을 다시 물어도 바뀌어 초점이 옮겨지고 칸이 비워진다 */
  | { kind: "ask"; question: Question; known: string | undefined; key: string }
  | { kind: "missing" }
  | { kind: "offline" }
  | { kind: "failed"; error: unknown };

type Send = "answer" | "decline";

export function useQuestionFlow(sessionId: string) {
  const { lostConnection, countAnswer } = useAppState();
  const alive = useAlive();
  const [answer, setAnswer] = useState<Answer>(NO_ANSWER);
  /** 서버가 답을 거절한 사유(422) */
  const [rejected, setRejected] = useState<string | null>(null);
  /**
   * 답 저장·모름 기록이 서버 오류·시간 초과로 실패함. which는 실패한 일(답 저장인지 모름 기록인지).
   * 보낸 값은 들고 있지 않는다 — 다시 시도는 그때 화면에 있는 답을 보낸다(retry)
   */
  const [saveFailure, setSaveFailure] = useState<{ id: number; error: unknown; which: Send } | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const next = useNextQuestion(sessionId, () => {
    setAnswer(NO_ANSWER);
    setRejected(null);
    setSaveFailure(null);
  });
  const { load, setLoad, fetchNext } = next;

  /**
   * 답 저장(answer)이나 모름 기록(decline). 성공하면 확인 수 +1 → 다음 질문(칸은 그대로 둔 채 받아 온다).
   * 답 저장은 지금 화면의 답을 보낸다. 보낼 답이 없으면(비었거나 칸에 못 읽는 글) 보내지 않는다
   */
  async function save(which: Send): Promise<void> {
    if (load.kind !== "ask" || sendingRef.current) return;
    const field = load.question.field;
    const value = valueToSend(answer);
    if (which === "answer" && value === null) return;
    sendingRef.current = true;
    setSending(true);
    setRejected(null);
    setSaveFailure(null);
    try {
      await (which === "answer" ? api.setFields(sessionId, { [field]: value }) : api.decline(sessionId, field));
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.status === 422) setRejected(error.message);
      else if (error instanceof ApiError && error.status === 404) setLoad({ kind: "missing" });
      else if (error instanceof ApiError && error.kind === "network") lostConnection();
      else setSaveFailure((f) => ({ id: (f?.id ?? 0) + 1, error, which }));
      return;
    } finally {
      sendingRef.current = false;
      if (alive.current) setSending(false);
    }
    if (!alive.current) return;
    countAnswer(sessionId);
    await fetchNext(false);
  }

  /**
   * 저장 실패 상자의 다시 시도. 실패한 일을 지금 화면의 답으로 다시 한다 — 실패 뒤 답을 바꿨으면 바꾼 값이 간다.
   * 답을 지워 보낼 것이 없으면 상자를 걷는다. 그러면 카드의 '답하기' 아래 잠긴 이유가 무엇을 하라는지 말한다
   */
  function retry(): Promise<void> | undefined {
    if (!saveFailure) return undefined;
    if (saveFailure.which === "answer" && valueToSend(answer) === null) {
      setSaveFailure(null);
      return undefined;
    }
    return save(saveFailure.which);
  }

  function changeAnswer(value: Answer) {
    setAnswer(value);
    // 거절 사유는 앞서 보낸 값에 대한 것이다. 답을 바꾸면 지난 일이다
    setRejected(null);
  }

  const { hasValues, records, fetching } = next;
  return { load, answer, changeAnswer, rejected, saveFailure, retry, sending, hasValues, fetchNext, save, records, fetching };
}

/**
 * 다음 질문 받기와 그때 함께 받는 세션 값·기록. onAsk는 새 질문을 받았을 때(답 칸 비우기). 부를 때마다 새 함수가 와도
 * 다시 받지 않게 ref로 든다 — fetchNext가 바뀌면 들어올 때의 효과가 다시 돌아 GET /next를 또 부른다
 */
function useNextQuestion(sessionId: string, onAsk: () => void) {
  const navigate = useNavigate();
  const { lostConnection } = useAppState();
  const alive = useAlive();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  /** 세션에 값이 하나라도 있는가. null은 모름(세션 상태를 못 받음) */
  const [hasValues, setHasValues] = useState<boolean | null>(null);
  /** S7 목록의 재료. null은 처음 받는 중, failed는 세션 값이나 기록을 못 받음(목록 자리에 그렇게 알린다) */
  const [records, setRecords] = useState<{ held: SessionState; events: TraceEvent[] } | "failed" | null>(null);
  const [fetchingNow, setFetchingNow] = useState(false);
  const fetching = useRef(false);
  const asked = useRef(0);
  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;

  // 세션 상태는 '지금 아는 값'과 '처음부터 다시' 확인 창을 띄울지, S7 목록에 쓴다. 못 받아도 질문은 그린다
  const fetchNext = useCallback(
    async (skeleton: boolean) => {
      if (fetching.current) return;
      fetching.current = true;
      setFetchingNow(true);
      if (skeleton) setLoad({ kind: "loading" });
      try {
        // next를 먼저 부른다. 예전에는 서버가 같은 세션을 동시에 두 번 읽으면 500·404를 내서 꼭 차례로 불러야 했으나,
        // 서버 쪽은 이슈 #36(PR #37, 세션 저장소에 잠금)에서 고쳐졌다. 지금 먼저 두는 것은 단순해서다 —
        // next가 실패하면 세션 상태는 부를 필요가 없다. 세션 값과 기록은 둘 다 실패해도 되는 것이라 함께 부른다
        const next = await api.next(sessionId);
        const [held, trace] = await Promise.all([
          api.session(sessionId).catch(() => null),
          api.trace(sessionId).catch(() => null),
        ]);
        if (!alive.current) return;
        setHasValues(held === null ? null : Object.keys(held.values).length > 0);
        setRecords(held && trace ? { held, events: trace.events } : "failed");
        if (next.action === "RESULT") {
          // replace: 뒤로 가기로 질문 없는 이 화면에 돌아오지 않게. 멈춘 이유는 넘기지 않는다(Questions.tsx 머리말)
          navigate(sessionPath(sessionId, "result"), { replace: true });
          return;
        }
        if (!next.question) throw new Error("질문이 없는 ASK 응답");
        asked.current += 1;
        onAskRef.current();
        setLoad({
          kind: "ask",
          question: next.question,
          known: knownText(next.question, held),
          key: `${next.question.field}:${asked.current}`,
        });
      } catch (error) {
        if (!alive.current) return;
        if (error instanceof ApiError && error.status === 404) setLoad({ kind: "missing" });
        else if (error instanceof ApiError && error.kind === "network") {
          lostConnection();
          setLoad({ kind: "offline" });
        } else setLoad({ kind: "failed", error });
      } finally {
        fetching.current = false;
        if (alive.current) setFetchingNow(false);
      }
    },
    [sessionId, alive, navigate, lostConnection],
  );

  useEffect(() => {
    void fetchNext(true);
  }, [fetchNext]);

  return { load, setLoad, fetchNext, hasValues, records, fetching: fetchingNow };
}

/** 기준에 걸쳐 다시 묻는 경우(IMPRECISE)만 지금 아는 값을 억·만으로(설계서 S3 질문 카드). 값을 못 받았으면 줄을 그리지 않는다 */
function knownText(question: Question, held: SessionState | null): string | undefined {
  if (question.ask_kind !== "IMPRECISE") return undefined;
  const value = held?.values[question.field]?.value;
  if (value === undefined || value === null) return undefined;
  // 기준에 걸치는 값은 금액 범위뿐이라(next_action.py) 끝이 늘 '원'이다. 그래서 조사는 '으로'
  const shown =
    typeof value === "object"
      ? formatRange(value.low, value.high)
      : typeof value === "number"
        ? formatWon(value)
        : String(value);
  return `지금은 ${shown}으로 알고 있습니다. 기준에 걸쳐 정확한 값이 필요합니다.`;
}

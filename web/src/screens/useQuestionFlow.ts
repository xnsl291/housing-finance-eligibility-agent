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
 * 떠난 뒤 늦게 온 응답은 버린다(useAlive). 다시 시도를 거듭 누르면 마지막 요청의 답만 쓴다(seq).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "../api/client";
import type { Question, SessionState } from "../api/types";
import { formatRange, formatWon } from "../components/amount";
import { useAlive, useAppState } from "./AppState";
import { NO_ANSWER, type Answer } from "./QuestionInput";
import { sessionPath } from "./routes";

export type Load =
  | { kind: "loading" }
  /** key: 항목 + 이 화면에서 받은 질문 순번. 같은 항목을 다시 물어도 바뀌어 초점이 옮겨지고 칸이 비워진다 */
  | { kind: "ask"; question: Question; known: string | undefined; key: string }
  | { kind: "missing" }
  | { kind: "offline" }
  | { kind: "failed"; error: unknown };

export function useQuestionFlow(sessionId: string) {
  const navigate = useNavigate();
  const { lostConnection, countAnswer } = useAppState();
  const alive = useAlive();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [answer, setAnswer] = useState<Answer>(NO_ANSWER);
  /** 서버가 답을 거절한 사유(422) */
  const [rejected, setRejected] = useState<string | null>(null);
  /** 답 저장·모름 기록이 서버 오류·시간 초과로 실패함. retry는 같은 요청을 다시 보낸다 */
  const [saveFailure, setSaveFailure] = useState<{ id: number; error: unknown; retry: () => Promise<void> } | null>(null);
  const [sending, setSending] = useState(false);
  /** 세션에 값이 하나라도 있는가. null은 모름(세션 상태를 못 받음) */
  const [hasValues, setHasValues] = useState<boolean | null>(null);
  const seq = useRef(0);
  const asked = useRef(0);

  // 세션 상태는 '지금 아는 값'과 '처음부터 다시' 확인 창을 띄울지에만 쓴다. 못 받아도 질문은 그린다
  const fetchNext = useCallback(
    async (skeleton: boolean) => {
      const mine = ++seq.current;
      if (skeleton) setLoad({ kind: "loading" });
      try {
        // 함께(Promise.all) 부르지 않고 차례로 부른다. 서버가 세션 저장소(SQLite) 연결 하나를 잠금 없이 여러 요청에
        // 나눠 쓰고 있어, 같은 세션을 동시에 두 번 읽으면 한쪽이 500("bad parameter or other API misuse")이 되고 다른
        // 쪽이 있는 세션을 404로 답한 일이 실제로 있었다(2026-10-21 브라우저 확인). 404는 E2(기록 없음)로 보이므로 치명적이다
        const next = await api.next(sessionId);
        const held = await api.session(sessionId).catch(() => null);
        if (!alive.current || mine !== seq.current) return;
        setHasValues(held === null ? null : Object.keys(held.values).length > 0);
        if (next.action === "RESULT") {
          // replace: 뒤로 가기로 질문 없는 이 화면에 돌아오지 않게. 멈춘 이유는 넘기지 않는다(Questions.tsx 머리말)
          navigate(sessionPath(sessionId, "result"), { replace: true });
          return;
        }
        if (!next.question) throw new Error("질문이 없는 ASK 응답");
        asked.current += 1;
        setAnswer(NO_ANSWER);
        setRejected(null);
        setSaveFailure(null);
        setLoad({
          kind: "ask",
          question: next.question,
          known: knownText(next.question, held),
          key: `${next.question.field}:${asked.current}`,
        });
      } catch (error) {
        if (!alive.current || mine !== seq.current) return;
        if (error instanceof ApiError && error.status === 404) setLoad({ kind: "missing" });
        else if (error instanceof ApiError && error.kind === "network") {
          lostConnection();
          setLoad({ kind: "offline" });
        } else setLoad({ kind: "failed", error });
      }
    },
    [sessionId, alive, navigate, lostConnection],
  );

  useEffect(() => {
    void fetchNext(true);
  }, [fetchNext]);

  /** 답 저장이나 모름 기록. 성공하면 확인 수 +1 → 다음 질문(칸은 그대로 둔 채 받아 온다) */
  async function save(call: () => Promise<unknown>): Promise<void> {
    setSending(true);
    setRejected(null);
    setSaveFailure(null);
    try {
      await call();
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.status === 422) setRejected(error.message);
      else if (error instanceof ApiError && error.status === 404) setLoad({ kind: "missing" });
      else if (error instanceof ApiError && error.kind === "network") lostConnection();
      else setSaveFailure((f) => ({ id: (f?.id ?? 0) + 1, error, retry: () => save(call) }));
      return;
    } finally {
      if (alive.current) setSending(false);
    }
    if (!alive.current) return;
    countAnswer(sessionId);
    await fetchNext(false);
  }

  function changeAnswer(next: Answer) {
    setAnswer(next);
    // 거절 사유는 앞서 보낸 값에 대한 것이다. 답을 바꾸면 지난 일이다
    setRejected(null);
  }

  return { load, answer, changeAnswer, rejected, saveFailure, sending, hasValues, fetchNext, save };
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

/*
 * S4 판정 결과의 서버 주고받기. 그리는 일은 Result.tsx가 한다(useQuestionFlow.ts와 같은 나눔).
 *
 * 들어오면 차례로
 * 1. GET /next — 멈춘 이유와 후보 상품. RESULT면 서버가 준 이유, ASK면 사용자가 멈춘 것(USER_STOPPED)이다.
 *    S3는 결과 화면에 이유를 넘기지 않는다(Questions.tsx 머리말 'S4와의 약속'). next는 기록을 쓰지 않아
 *    새로 고쳐도 같은 판단이 나온다
 * 2. POST /assessment — 후보 상품만 판정한다(Streamlit questions.finish와 같음. 전세라고 한 사람에게 매매 상품의
 *    '정보 부족'을 보이지 않으려고). 후보가 없으면 부르지 않는다 — 빈 목록을 보내면 서버가 '전부'로 읽는다
 * 3. GET /trace — 확인 과정(S6), 전세·매매를 모른다고 했는지(왜 이 상품만 보이나), 처음부터 다시 확인 창을 띄울지.
 *    판정 뒤에 불러야 방금 한 판정이 기록 끝에 들어 있다. 실패해도 결과는 그린다
 *    세션 값(GET /v1/sessions/{id})도 같이 받는다 — S7 '이 조건으로 판정했습니다' 요약(heldItems.ts). 둘 다 실패해도 결과는 그린다
 * 항목 목록(GET /v1/fields)은 처음부터 함께 받는다. 못 받아도 결과는 그린다 — 이름 자리에 코드가 나올 뿐이다
 *
 * S7 고치기 저장 뒤 다시 판정(refresh)도 같은 차례(next → assess → trace·세션)다. 다른 점은 받는 동안 앞 결과를 지우지 않고
 * 그대로 두는 것(고치던 줄과 초점을 잃지 않게)과, 끝나면 앞 결과를 change에 실어 바뀐 곳을 알리게 하는 것(시안 S4-k).
 * 고친 뒤 아직 물을 것이 남았으면(ASK) 사용자가 멈춘 것이 아니므로 MORE_TO_ASK로 둔다. 앞서 사용자가 멈췄던 결과면 그대로
 * USER_STOPPED — 멈춘 사실은 고쳐도 그대로다
 *
 * 실패 나누기(설계서 C-ERROR, S3 상태표 '판정 실패')
 * - 404 세션 없음 → missing(E2)
 * - 연결 안 됨 → Layout 연결 상태를 끊김으로. 받은 결과가 있으면 그대로 둔다(시안 S4-f)
 * - 그 밖(next·판정 실패, 시간 초과) → failed. '판정하지 못했습니다' + 다시 시도(결함 D15와 같은 원칙)
 * 떠난 뒤 늦게 온 응답은 버린다(useAlive). 받는 중이면 다시 부르지 않는다 — StrictMode가 효과를 두 번 돌려도
 * 판정 기록(ASSESSED)이 두 번 쌓이지 않게
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError } from "../api/client";
import type { FieldCatalog, HeldValue, ProgramResult, TraceEvent } from "../api/types";
import { useAlive, useAppState } from "./AppState";

export const USER_STOPPED = "USER_STOPPED";
/** 고친 뒤 다시 판정했더니 아직 물을 것이 남음(StopBanner.tsx) */
export const MORE_TO_ASK = "MORE_TO_ASK";

/** 기록: 받음 / 못 받음(사유) */
export type TraceState = { kind: "ready"; events: TraceEvent[] } | { kind: "failed"; error: unknown };
/** 세션 값: 받음 / 못 받음(사유) */
export type HeldState = { kind: "ready"; values: Record<string, HeldValue> } | { kind: "failed"; error: unknown };

/** 고쳐서 다시 판정한 경우. 무엇을 고쳤고(field, 고치기 전 보이던 값) 앞 판정은 무엇이었나 */
export interface Change {
  field: string;
  before: string;
  previous: ProgramResult[];
}

type ResultLoad =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "offline" }
  | { kind: "failed"; error: unknown }
  | {
      kind: "ready";
      /** 서버 next의 이유 또는 USER_STOPPED */
      reason: string | undefined;
      declinedNeeded: string[];
      /** next가 준 후보 상품. 왜 이 상품만 보이나 한 줄에 쓴다 */
      candidates: string[];
      results: ProgramResult[];
      trace: TraceState;
      held: HeldState;
      change: Change | null;
    };

export function useResult(sessionId: string) {
  const { lostConnection } = useAppState();
  const alive = useAlive();
  const [load, setLoad] = useState<ResultLoad>({ kind: "loading" });
  /** 항목 목록. null은 못 받았거나 아직 받는 중 */
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  const fetching = useRef(false);

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) setLoad({ kind: "missing" });
      else if (error instanceof ApiError && error.kind === "network") {
        lostConnection();
        setLoad({ kind: "offline" });
      } else setLoad({ kind: "failed", error });
    },
    [lostConnection],
  );

  /** 차례로 받는다(머리말). change가 있으면 고친 뒤 다시 판정 — 받는 동안 앞 결과를 그대로 둔다 */
  const run = useCallback(
    async (change: Change | null, previousReason: string | undefined) => {
      if (fetching.current) return;
      fetching.current = true;
      if (!change) {
        setLoad({ kind: "loading" });
        api.fields().then(
          (r) => alive.current && setCatalog(r.fields),
          () => {},
        );
      }
      try {
        const next = await api.next(sessionId);
        // 그새 떠났으면 판정을 부르지 않는다. 부르면 아무도 보지 않는 판정이 기록(ASSESSED)에 남는다
        if (!alive.current) return;
        const results = next.candidates.length > 0 ? (await api.assess(sessionId, next.candidates)).results : [];
        if (!alive.current) return;
        const [trace, held] = await records(sessionId);
        if (!alive.current) return;
        if ([trace, held].some((r) => r.kind === "failed" && isNetwork(r.error))) lostConnection();
        const asked = change && previousReason !== USER_STOPPED ? MORE_TO_ASK : USER_STOPPED;
        setLoad({
          kind: "ready",
          reason: next.action === "RESULT" ? next.reason : asked,
          declinedNeeded: next.declined_needed ?? [],
          candidates: next.candidates,
          results,
          trace,
          held,
          change,
        });
      } catch (error) {
        if (alive.current) fail(error);
      } finally {
        fetching.current = false;
      }
    },
    [sessionId, alive, fail, lostConnection],
  );

  const fetchAll = useCallback(() => run(null, undefined), [run]);

  /** S7 고치기 저장 뒤 다시 판정. 지금 결과를 앞 결과로 실어 보낸다 */
  const refresh = useCallback(
    (field: string, before: string) => {
      const now = load.kind === "ready" ? load : null;
      return run({ field, before, previous: now?.results ?? [] }, now?.reason);
    },
    [run, load],
  );

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  /** 확인 과정과 세션 값만 다시 받는다(S6·S7 '다시 시도'). 결과는 그대로 둔다 */
  const retryRecords = useCallback(async () => {
    const [trace, held] = await records(sessionId);
    if ([trace, held].some((r) => r.kind === "failed" && isNetwork(r.error))) lostConnection();
    if (!alive.current) return;
    setLoad((l) => (l.kind === "ready" ? { ...l, trace, held } : l));
  }, [sessionId, alive, lostConnection]);

  return { load, catalog, fetchAll, refresh, retryRecords };
}

const isNetwork = (error: unknown) => error instanceof ApiError && error.kind === "network";

/** 기록과 세션 값을 함께 받는다. 실패해도 던지지 않고 각자 실패로 돌려준다 — 결과는 그대로 그린다 */
function records(sessionId: string): Promise<[TraceState, HeldState]> {
  return Promise.all([
    api.trace(sessionId).then(
      (r): TraceState => ({ kind: "ready", events: r.events }),
      (error): TraceState => ({ kind: "failed", error }),
    ),
    api.session(sessionId).then(
      (r): HeldState => ({ kind: "ready", values: r.values }),
      (error): HeldState => ({ kind: "failed", error }),
    ),
  ]);
}

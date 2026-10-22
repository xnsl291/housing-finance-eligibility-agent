/*
 * 화면들이 함께 쓰는 앱 메모리. 적은 문장, 상품 목록, 이 탭에서 연 세션 번호.
 *
 * 적은 문장은 서버에도 브라우저 저장소(localStorage 등)에도 두지 않고 여기에만 둔다. 개인정보 안내가
 * "입력한 문장 전체는 저장하지 않습니다"라고 약속하기 때문이다(G12). 그래서 같은 탭 안에서만 남고,
 * 새로 고치면 사라진다. 실패하거나 S2에서 '문장 다시 쓰기'로 돌아와도 남아 있는 것은 이 덕분이다.
 *
 * 연 세션 번호는 '내 기록 지우기'가 지울 대상이다. 문장을 다시 읽거나 전체 초기화를 하면 주소에서
 * 앞 세션이 사라지는데, 그 세션에도 읽어 낸 값이 남아 있다. 개인정보 안내가 "'내 기록 지우기'로 서버에서
 * 지울 수 있습니다"라고 약속하므로 번호를 받은 순간(그 뒤 성공·실패·시간 초과와 관계없이) 여기 모은다.
 * 한계: 이 목록도 메모리라서 새로 고치면 사라진다. 그 뒤에는 주소에 있는 세션만 지울 수 있다.
 * 세션 열기 자체가 시간 초과로 끊겨 번호를 받지 못한 경우도 모을 수 없다.
 * 브라우저 저장소에 두지 않은 것은 적은 문장과 같은 이유다(이 탭 밖에 흔적을 남기지 않음).
 *
 * 확인 수는 S3 진행 줄의 '지금까지 N개 확인'이다. 세션마다 S3에서 답하거나 모른다고 한 수를 센다.
 * 화면(S3) 안이 아니라 여기 두는 것은 S4에서 '질문 이어서 하기'로 돌아와도 이어 세려고다.
 * 서버에서 셀 수는 없다 — 확인 과정(trace)의 값 저장 기록에는 S2에서 고친 값도 섞여 있어 S3 답만 골라낼 수 없다.
 * 그래서 새로 고치면 0부터 다시 센다.
 */
import { createContext, useCallback, useContext, useEffect, useRef, type RefObject } from "react";

import type { Program } from "../api/types";

/** 상품 목록: 받는 중 / 받지 못함 / 받음 */
export type ProgramsState = "loading" | "failed" | Program[];

export interface AppState {
  draft: string;
  setDraft: (text: string) => void;
  programs: ProgramsState;
  /** 세션을 열어 번호를 받으면 곧바로 부른다. 같은 번호는 한 번만 모인다 */
  rememberSession: (id: string) => void;
  /** 이 탭에서 연(또는 이어 받은) 세션인가. 아니면 새로 고침·주소로 들어온 것이다 — S8 이어서 하기 배너(ResumeBanner.tsx) */
  knowsSession: (id: string) => boolean;
  /** 판정 서버 연결 상태. null은 아직 확인 전 */
  connected: boolean | null;
  /** 연결 확인(GET /health)을 다시 부른다. E1의 '다시 연결 확인' */
  recheckConnection: () => Promise<void>;
  /** 화면이 부른 호출이 '연결 안 됨'(network)으로 실패했을 때. 머리·사이드바 표시와 E1을 맞춘다 */
  lostConnection: () => void;
  /** 이 세션에서 S3가 답하거나 모른다고 한 수(위 머리말). 모르는 세션은 0 */
  answeredCount: (id: string) => number;
  /** S3에서 답 저장이나 모름 기록이 성공했을 때 부른다 */
  countAnswer: (id: string) => void;
}

export const AppStateContext = createContext<AppState | null>(null);

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error("useAppState는 Layout 안에서만 쓸 수 있습니다");
  return state;
}

/**
 * 이 화면이 아직 떠 있는가(언마운트되면 false). 서버를 기다리는 동안 사용자가 전체 초기화·뒤로 가기로
 * 떠날 수 있는데, 그 뒤에 온 답으로 화면을 옮기거나 상태를 바꾸지 않으려고 S0·S1이 함께 쓴다.
 * StrictMode가 효과를 두 번 돌려도 맞도록 마운트될 때마다 true로 되돌린다
 */
export function useAlive(): RefObject<boolean> {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/**
 * 서버에서 다시 받는 일을 한 번에 하나만 돌린다(S3 다음 질문 받기, S4 판정). 도는 중에 새 부름이 오면
 * - drop이면 버린다. 들어올 때·다시 시도·다시 연결 확인처럼 '같은 것을 또 받을' 뿐인 부름이다. StrictMode가 효과를
 *   두 번 돌려도 S4 판정 기록(ASSESSED)이 두 번 쌓이지 않는 것도 이 덕분이다
 * - 아니면 앞 것이 끝난 뒤 돈다. 값을 저장한 뒤의 다시 받기다 — 도는 중인 것은 저장 전 상태로 물은 것일 수 있어
 *   버리면 고친 값이 화면에 반영되지 않는다. 돌려준 Promise는 자기 차례가 끝나야 풀린다(부른 쪽이 '저장하는 중'을 그만큼 유지)
 * job은 던지지 않아야 한다(실패는 job 안에서 상태로 바꾼다)
 */
export function useOneAtATime(): (job: () => Promise<void>, drop: boolean) => Promise<void> {
  const running = useRef<Promise<void> | null>(null);
  return useCallback(async (job: () => Promise<void>, drop: boolean) => {
    if (running.current && drop) return;
    // 기다리는 사이 다른 부름이 먼저 자리를 잡을 수 있어 비었는지 다시 본다
    while (running.current) await running.current;
    const mine = job();
    running.current = mine;
    try {
      await mine;
    } finally {
      if (running.current === mine) running.current = null;
    }
  }, []);
}

/*
 * 화면 주소와 단계. 세션 번호는 주소에 싣는다(설계서 13절 Q3 — 새로 고쳐도 이어지게).
 * 서버가 세션의 정본이고, 화면은 주소의 번호로 서버에서 다시 읽어 온다.
 *
 * 단계는 따로 저장하지 않고 주소로 정한다(설계서 3.2 "가진 값으로 계산"). 첫 화면(S0)은 단계가 없다.
 */
import type { Step } from "../components/AppHeader";

export type SessionPage = "confirm" | "questions" | "result";

const STEP_OF_PAGE: Record<SessionPage, Step> = { confirm: 1, questions: 2, result: 3 };

export function sessionPath(sessionId: string, page: SessionPage): string {
  return `/s/${encodeURIComponent(sessionId)}/${page}`;
}

/** 주소 → 단계. 단계가 없는 화면(첫 화면, 없는 주소)은 undefined */
export function stepOf(pathname: string): Step | undefined {
  if (pathname === "/write") return 0;
  const page = /^\/s\/[^/]+\/([^/]+)$/.exec(pathname)?.[1];
  return page && page in STEP_OF_PAGE ? STEP_OF_PAGE[page as SessionPage] : undefined;
}

/**
 * S1 → S2로 넘길 때 라우터 state로 싣는 값. 서버가 이번 문장에만 돌려주고 저장하지 않는 값이라
 * (types.ts `ExtractedState`) 서버에서 다시 읽어 올 수 없다. 새로 고치면 사라진다.
 */
export interface ConfirmState {
  warnings: string[];
  unreadable: Record<string, string>;
}

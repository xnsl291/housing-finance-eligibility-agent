/*
 * S4 테스트 도우미. 판정·기록 응답은 서버가 실제로 내는 모양(api.py _판정들, get_trace)을 따른다.
 */
import { screen } from "@testing-library/react";

import type { ProgramResult, TraceEvent } from "../api/types";
import { result } from "./questionsTesting";
import { fakeServer, json, renderApp } from "./testing";

export const PATH = "/s/s-1/result";
export const NEXT = "GET /v1/sessions/s-1/next";
export const ASSESS = "POST /v1/sessions/s-1/assessment";
export const TRACE = "GET /v1/sessions/s-1/trace";
export const SESSION = "GET /v1/sessions/s-1";
export const PUT = "PUT /v1/sessions/s-1/fields";

/** 상품 하나의 판정. 기본은 전세 상품(p-youth)의 '사전 조건 부합', 남은 조건 0개 */
export function program(over: Partial<ProgramResult> = {}): ProgramResult {
  return {
    program_id: "p-youth",
    program_name: "가상 청년 상품 가",
    status: "PRECHECK_MATCH",
    passed_rules: [],
    failed_rules: [],
    missing_fields: [],
    imprecise_fields: [],
    next_actions: [],
    loan_limit: {
      amount_krw: 144_000_000,
      tier: "default",
      tier_label: "그 밖의 가구",
      skipped_tiers: [],
      skipped_tier_labels: [],
      ratio_amount_krw: 144_000_000,
      cap_amount_krw: 150_000_000,
      citation: "임차보증금의 80%이내에서 최고 1억 5천만원 이내",
      rule_id: "B-12",
      reason: null,
    },
    rule_outcomes: [],
    unresolved: [],
    rule_version: 2,
    source_url: "https://example.invalid/1",
    source_checked_at: "2026-09-08",
    ...over,
  };
}

export function assessment(...results: ProgramResult[]): Response {
  return json({ session_id: "s-1", results });
}

let seq = 0;
export function event(kind: string, payload: Record<string, unknown> = {}): TraceEvent {
  seq += 1;
  return { seq, at: "2026-10-22T00:00:00Z", kind, payload };
}

/** 문장에서 나이·전세를 읽고, 세대주 여부에 답하고, 임차보증금을 모른다고 한 뒤 판정한 기록 */
export const EVENTS: TraceEvent[] = [
  event("SESSION_STARTED"),
  event("EXTRACTED", { values: { age: 29, intended_tenure: "JEONSE" }, sources: {}, unreadable: {} }),
  event("FIELD_SET", { values: { household_head_status: "HEAD" } }),
  event("FIELD_DECLINED", { field: "lease_deposit_krw" }),
  event("ASSESSED", { results: [] }),
];

export function traceOf(events: TraceEvent[] = EVENTS): Response {
  return json({ session_id: "s-1", events });
}

/** EVENTS를 되짚은 세션 값(서버 replay와 같게). 임차보증금은 모른다고 해서 값이 없다 */
export const VALUES = {
  age: { value: 29, source: "LLM", at: "2026-10-22T00:00:00Z", phrase: "만 29세" },
  intended_tenure: { value: "JEONSE", source: "LLM", at: "2026-10-22T00:00:00Z", phrase: null },
  household_head_status: { value: "HEAD", source: "USER", at: "2026-10-22T00:00:00Z", phrase: null },
};

export function sessionOf(values: Record<string, unknown> = VALUES): Response {
  return json({ session_id: "s-1", values });
}

/** next는 '모두 확인함', 판정은 기본 상품 하나, 기록은 EVENTS, 세션 값은 VALUES. routes로 바꾼다 */
export function server(routes: Parameters<typeof fakeServer>[0] = {}) {
  return fakeServer({
    [NEXT]: () => result("COMPLETE"),
    [ASSESS]: () => assessment(program()),
    [TRACE]: () => traceOf(),
    [SESSION]: () => sessionOf(),
    ...routes,
  });
}

/** 화면을 열고 판정 카드(또는 빈 결과)가 그려질 때까지 기다린다 */
export async function open() {
  renderApp(PATH);
  await screen.findByRole("region", { name: "다음 할 일" });
  await screen.findByText("어떤 순서로 무엇을 확인했나");
}

/** 상품 카드(article)를 상품 이름으로 */
export function card(name: string): HTMLElement {
  return screen.getByRole("heading", { level: 3, name }).closest("article")!;
}

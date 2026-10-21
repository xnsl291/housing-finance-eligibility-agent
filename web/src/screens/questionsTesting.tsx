/*
 * S3 테스트 도우미. 서버의 GET /next가 실제로 내는 모양(api.py get_next)을 만들고, 차례로 다른 답을 내게 한다.
 */
import { screen } from "@testing-library/react";

import type { FieldValue, NextAction, Question } from "../api/types";
import { callsTo, fakeServer, json, renderApp } from "./testing";

export const PATH = "/s/s-1/questions";
export const NEXT = "GET /v1/sessions/s-1/next";
export const SESSION = "GET /v1/sessions/s-1";
export const PUT = "PUT /v1/sessions/s-1/fields";
export const DECLINE = "POST /v1/sessions/s-1/declined";

/** 서버가 내는 질문 하나. 선택 항목 '세대주 여부'(next_action.py의 why 문구 그대로) */
export const CHOICE_Q: Question = {
  field: "household_head_status",
  label: "세대주 여부",
  kind: "CHOICE",
  ask_kind: "MISSING",
  why: "남은 상품 2개 모두 이 값이 있어야 판정할 수 있습니다",
  needed_by: ["p-youth", "p-buy"],
  how_to_check: null,
  choices: ["HEAD", "PROSPECTIVE_HEAD"],
  choice_labels: { HEAD: "세대주임", PROSPECTIVE_HEAD: "세대주 예정" },
};

const BASE = { session_id: "s-1", candidates: ["p-youth", "p-buy"], policy_version: 1 };

export function ask(question: Question): Response {
  return json({ ...BASE, action: "ASK", question } satisfies NextAction);
}

export function result(reason: NonNullable<NextAction["reason"]>, declined: string[] = []): Response {
  return json({ ...BASE, action: "RESULT", reason, declined_needed: declined } satisfies NextAction);
}

/** 부를 때마다 다음 응답을. 다 쓰면 마지막 것을 되풀이한다. Response는 한 번만 읽히므로 매번 새로 만든다 */
export function sequence(...responses: Response[]) {
  const bodies = responses.map((r) => ({ status: r.status, text: r.clone().text() }));
  let i = 0;
  return async () => {
    const r = bodies[Math.min(i++, bodies.length - 1)];
    return new Response(await r.text, { status: r.status, headers: { "Content-Type": "application/json" } });
  };
}

/** 세션 상태(값은 문장에서 읽은 것으로), 답 저장, 모름 기록을 기본으로 정상 응답한다 */
export function server(routes: Parameters<typeof fakeServer>[0] = {}, values: Record<string, FieldValue> = { age: 29 }) {
  const held = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, { value: v, source: "LLM", at: "2026-10-21T00:00:00Z", phrase: null }]),
  );
  return fakeServer({
    [SESSION]: () => json({ session_id: "s-1", values: held }),
    [PUT]: () => json({ session_id: "s-1", values: held }),
    [DECLINE]: () => json({ session_id: "s-1", declined: [] }),
    ...routes,
  });
}

export function start() {
  return renderApp(PATH);
}

/** 화면을 열고 질문 카드가 뜰 때까지 기다린다 */
export async function open(label = CHOICE_Q.label) {
  start();
  await screen.findByRole("region", { name: label });
}

export function sentBodies(spy: ReturnType<typeof fakeServer>, key: string) {
  return callsTo(spy, key).map(([, init]) => JSON.parse(String(init?.body)));
}

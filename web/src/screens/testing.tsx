/*
 * 화면 테스트 도우미. 서버는 fetch를 흉내 내서 대신한다 — 화면이 실제로 부르는 주소와 방식
 * (`api/client.ts`)을 그대로 지나가게 하려고 api 함수를 바꿔치기하지 않는다.
 */
import { render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

import { App } from "../App";
import type { Program } from "../api/types";

export const PROGRAMS: Program[] = [
  {
    program_id: "p-youth",
    program_name: "가상 청년 상품 가",
    organization: null,
    tenure: "JEONSE",
    source_url: "https://example.invalid/1",
    source_checked_at: "2026-10-01",
  },
  {
    program_id: "p-buy",
    program_name: "가상 상품 나",
    organization: null,
    tenure: "PURCHASE",
    source_url: "https://example.invalid/2",
    source_checked_at: "2026-10-01",
  },
];

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/**
 * "메서드 주소" → 응답. 처리기가 던지면 fetch가 던진 것으로 본다(TypeError = 연결 안 됨).
 * 상품 목록과 연결 상태는 기본으로 정상 응답한다. 등록하지 않은 주소는 404.
 */
export function fakeServer(routes: Record<string, Handler> = {}) {
  const all: Record<string, Handler> = {
    "GET /health": () => json({ status: "ok", programs: PROGRAMS.map((p) => p.program_id) }),
    "GET /v1/programs": () => json({ programs: PROGRAMS }),
    ...routes,
  };
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const handler = all[`${init?.method ?? "GET"} ${String(url)}`];
    if (!handler) return json({ detail: "없는 경로" }, 404);
    return handler(init);
  });
}

/** fetch 흉내가 받은 호출 중 이 "메서드 주소"인 것만 */
export function callsTo(spy: ReturnType<typeof fakeServer>, key: string) {
  return spy.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${String(url)}` === key);
}

/** 지금 주소와 라우터 state를 화면 밖에서 읽을 수 있게 그린다 */
function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location" data-state={JSON.stringify(location.state ?? null)}>
      {location.pathname}
    </output>
  );
}

export function renderApp(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

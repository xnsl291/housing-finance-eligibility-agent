/*
 * 화면 테스트 도우미. 서버는 fetch를 흉내 내서 대신한다 — 화면이 실제로 부르는 주소와 방식
 * (`api/client.ts`)을 그대로 지나가게 하려고 api 함수를 바꿔치기하지 않는다.
 */
import { render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

import { App } from "../App";
import type { FieldCatalog, Program } from "../api/types";

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

/** 항목 목록의 일부. 이름표·종류·선택지는 서버(`GET /v1/fields`)가 실제로 내는 것과 같게 */
export const FIELDS: FieldCatalog = {
  age: { label: "나이", kind: "INT" },
  household_head_status: {
    label: "세대주 여부",
    kind: "CHOICE",
    choices: ["HEAD", "PROSPECTIVE_HEAD"],
    choice_labels: { HEAD: "세대주임", PROSPECTIVE_HEAD: "세대주 예정" },
  },
  is_first_time_buyer: {
    label: "생애최초 주택구입",
    kind: "BOOL",
    how_to_check: "본인과 배우자 모두 과거에 주택을 소유한 적이 없어야 합니다",
  },
  region_name: { label: "주택 소재지", kind: "TEXT" },
  housing_area_m2: {
    label: "전용면적",
    kind: "FLOAT",
    how_to_check: "평이 아니라 제곱미터로 넣어 주세요. 등기부등본이나 매물 정보의 전용면적입니다",
  },
  combined_annual_income_krw: { label: "부부합산 총소득", kind: "AMOUNT" },
  lease_deposit_krw: { label: "임차보증금", kind: "AMOUNT" },
  move_in_date: { label: "전입일", kind: "DATE" },
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/**
 * "메서드 주소" → 응답. 처리기가 던지면 fetch가 던진 것으로 본다(TypeError = 연결 안 됨).
 * 상품 목록, 연결 상태, 항목 목록(FIELDS)은 기본으로 정상 응답한다. 그 밖에 등록하지 않은 주소는
 * 실제 서버처럼 404다 — 세션 상태(GET /v1/sessions/:id)도 등록하지 않으면 404(없는 세션)다.
 * emptySession을 켜면 등록하지 않은 세션 상태를 값이 하나도 없는 세션으로 답한다. S1 테스트처럼
 * S2로 넘어가는 것까지만 보고 S2의 내용은 보지 않는 테스트용이다. 기본으로 켜 두면 세션 상태를
 * 등록하지 않은 테스트도 S2가 멀쩡히 그려져, 실제로는 '기록을 찾을 수 없습니다'가 뜰 자리를 놓친다.
 */
export function fakeServer(routes: Record<string, Handler> = {}, { emptySession = false } = {}) {
  const all: Record<string, Handler> = {
    "GET /health": () => json({ status: "ok", programs: PROGRAMS.map((p) => p.program_id) }),
    "GET /v1/programs": () => json({ programs: PROGRAMS }),
    "GET /v1/fields": () => json({ fields: FIELDS }),
    ...routes,
  };
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const key = `${init?.method ?? "GET"} ${String(url)}`;
    const handler = all[key];
    const session = /^GET \/v1\/sessions\/([^/]+)$/.exec(key);
    if (!handler && session && emptySession) return json({ session_id: decodeURIComponent(session[1]), values: {} });
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

/** path에 state를 실으면 그 화면에 라우터 state를 들고 들어간 것과 같다(S1 → S2) */
export function renderApp(path: string | { pathname: string; state: unknown } = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/**
 * 붙잡아 둔 응답을 내주고, 화면 코드가 그 본문을 다 읽은 뒤 이어지는 일까지 끝날 때까지 기다린다.
 * 본문을 읽은 뒤의 일(떠났는지 확인 → 다음 호출 또는 상태 바꾸기)은 모두 마이크로태스크라,
 * 그다음 매크로태스크(setTimeout 0)가 돌 때는 이미 끝나 있다. 시간을 재며 기다리지 않는다
 */
export async function settle(release: (r: Response) => void, response: Response) {
  let read: () => void = () => {};
  const consumed = new Promise<void>((resolve) => (read = resolve));
  const json = response.json.bind(response);
  response.json = () =>
    json().then((body: unknown) => {
      read();
      return body;
    });
  release(response);
  await consumed;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/*
 * S3 '지금까지 확인한 항목'(S7 고치기, 시안 S3-e) — 목록 줄, 고치기 저장(그 값만 PUT → 다음 질문 다시 받기), 422,
 * 비우기, 저장 중 잠금, 늦은 응답.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Question } from "../api/types";
import { ask, CHOICE_Q, NEXT, open, PUT, sentBodies, sequence, server, TRACE } from "./questionsTesting";
import { callsTo, json, settle } from "./testing";

afterEach(() => {
  vi.restoreAllMocks();
});

const AREA_Q: Question = {
  ...CHOICE_Q,
  field: "housing_area_m2",
  label: "전용면적",
  kind: "FLOAT",
  why: "이 값이 있어야 판정할 수 있습니다 (가상 청년 상품 가)",
  choices: null,
  choice_labels: null,
};

/** 나이는 문장에서 읽음, 세대주 여부는 직접 넣음, 임차보증금은 모른다고 함 */
const TRACE_EVENTS = [
  { seq: 1, at: "2026-10-22T00:00:00Z", kind: "EXTRACTED", payload: { values: { age: 29 }, sources: {}, unreadable: {} } },
  { seq: 2, at: "2026-10-22T00:00:00Z", kind: "FIELD_DECLINED", payload: { field: "lease_deposit_krw" } },
];

function heldServer(routes: Parameters<typeof server>[0] = {}) {
  return server({
    [NEXT]: () => ask(CHOICE_Q),
    [TRACE]: () => json({ session_id: "s-1", events: TRACE_EVENTS }),
    "GET /v1/sessions/s-1": () =>
      json({
        session_id: "s-1",
        values: {
          age: { value: 29, source: "LLM", at: "t", phrase: "만 29세" },
          region_name: { value: "서울특별시", source: "USER", at: "t", phrase: null },
        },
      }),
    ...routes,
  });
}

async function openList() {
  const user = userEvent.setup();
  await open();
  await user.click(await screen.findByText(/지금까지 확인한 항목 3개/));
  return user;
}

const row = (label: string) => screen.getByRole("rowheader", { name: label }).closest("tr")!;

describe("S3 지금까지 확인한 항목 — 목록", () => {
  it("값이 있는 항목과 모른다고 한 항목을 항목 목록 순서로, 출처와 함께 보인다", async () => {
    heldServer();
    await openList();

    expect(row("나이")).toHaveTextContent("29");
    expect(row("나이")).toHaveTextContent("“만 29세”에서 읽음");
    expect(row("주택 소재지")).toHaveTextContent("직접 넣은 값");
    expect(row("임차보증금")).toHaveTextContent("값 없음");
    expect(row("임차보증금")).toHaveTextContent("모른다고 함 · 다시 묻지 않습니다");
    // 모른다고 한 줄은 '값 넣기', 값이 있는 줄은 '고치기'
    expect(within(row("임차보증금")).getByRole("button", { name: "값 넣기 — 임차보증금" })).toBeInTheDocument();
    expect(within(row("나이")).getByRole("button", { name: "고치기 — 나이" })).toBeInTheDocument();
    const order = screen.getAllByRole("rowheader").map((h) => h.textContent);
    expect(order).toEqual(["나이", "주택 소재지", "임차보증금"]);
  });

  it("세션 값이나 기록을 못 받으면 빈 목록이 아니라 못 불러왔다고 적는다", async () => {
    heldServer({ [TRACE]: () => json({ detail: "오류" }, 500) });
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByText(/지금까지 확인한 항목 — 잘못된 값은/));
    expect(screen.getByText(/지금까지 확인한 항목을 불러오지 못했습니다/)).toBeInTheDocument();
  });
});

describe("S3 고치기 저장", () => {
  it("고친 값 하나만 PUT으로 보내고 다음 질문을 다시 받는다", async () => {
    const spy = heldServer({ [NEXT]: sequence(ask(CHOICE_Q), ask(AREA_Q)) });
    const user = await openList();

    await user.click(screen.getByRole("button", { name: "고치기 — 나이" }));
    const field = screen.getByRole("textbox", { name: "나이" });
    // 지금 값을 채운 채 열리고 초점이 칸으로 간다
    expect(field).toHaveValue("29");
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.type(field, "31");
    await user.click(screen.getByRole("button", { name: "저장" }));

    await screen.findByRole("region", { name: "전용면적" });
    expect(sentBodies(spy, PUT)).toEqual([{ values: { age: 31 } }]);
    expect(callsTo(spy, NEXT)).toHaveLength(2);
    // 저장하면 줄이 닫힌다
    expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument();
  });

  it("값을 바꾸지 않으면 저장이 잠긴다 — 그대로 보내면 출처가 '직접 넣음'으로 바뀐다", async () => {
    const spy = heldServer();
    const user = await openList();
    await user.click(screen.getByRole("button", { name: "고치기 — 나이" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("값을 바꿔야 저장할 수 있습니다")).toBeInTheDocument();
    expect(callsTo(spy, PUT)).toHaveLength(0);
  });

  it("서버가 거절하면(422) 그 줄 아래에 사유를 보이고 줄은 열린 채, 다음 질문은 다시 받지 않는다", async () => {
    const spy = heldServer({ [PUT]: () => json({ detail: "값이 맞지 않습니다 — 나이: 정수가 아님" }, 422) });
    const user = await openList();
    await user.click(screen.getByRole("button", { name: "고치기 — 나이" }));
    const field = screen.getByRole("textbox", { name: "나이" });
    await user.clear(field);
    await user.type(field, "30");
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("값이 맞지 않습니다 — 나이: 정수가 아님")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeInTheDocument();
    expect(callsTo(spy, NEXT)).toHaveLength(1);
  });

  it("모른다고 한 줄에 값을 넣으면 그 값을 보낸다. 넣으면 '모른다고 함'이 풀린다고 알린다", async () => {
    const spy = heldServer({ [NEXT]: sequence(ask(CHOICE_Q), ask(AREA_Q)) });
    const user = await openList();
    await user.click(screen.getByRole("button", { name: "값 넣기 — 임차보증금" }));
    expect(screen.getByText(/값을 넣으면 ‘모른다고 함’이 풀립니다/)).toBeInTheDocument();
    // 모른다고 한 줄에는 비우기가 없다(비울 값이 없음)
    expect(screen.queryByRole("button", { name: "값 비우기" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "임차보증금" }), "1억 8천");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("region", { name: "전용면적" });
    expect(sentBodies(spy, PUT)).toEqual([{ values: { lease_deposit_krw: 180_000_000 } }]);
  });

  it("값 비우기는 null을 보내고, '모름'이 아니라 다시 여쭐 수 있다고 적는다", async () => {
    const spy = heldServer({ [NEXT]: sequence(ask(CHOICE_Q), ask(AREA_Q)) });
    const user = await openList();
    await user.click(screen.getByRole("button", { name: "고치기 — 나이" }));
    expect(
      screen.getByText(
        "값을 비우면 이 항목은 값이 없는 것으로 판정합니다. ‘모른다고 함’으로 남지 않아 질문을 이어서 하면 다시 여쭐 수 있습니다.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "값 비우기" }));
    await screen.findByRole("region", { name: "전용면적" });
    expect(sentBodies(spy, PUT)).toEqual([{ values: { age: null } }]);
  });
});

describe("S3 고치기 — 잠금과 늦은 응답", () => {
  it("저장하는 동안 질문 카드 버튼과 다른 줄의 고치기를 잠근다. 끝나면 풀린다", async () => {
    let finish!: (r: Response) => void;
    const spy = heldServer({
      [NEXT]: sequence(ask(CHOICE_Q), ask(CHOICE_Q)),
      [PUT]: () => new Promise<Response>((resolve) => (finish = resolve)),
    });
    const user = await openList();
    await user.click(screen.getByRole("button", { name: "고치기 — 나이" }));
    const field = screen.getByRole("textbox", { name: "나이" });
    await user.clear(field);
    await user.type(field, "31");
    await user.click(screen.getByRole("button", { name: "저장" }));

    const other = screen.getByRole("button", { name: "고치기 — 주택 소재지" });
    expect(other).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "모르겠어요" })).toHaveAttribute("aria-disabled", "true");
    await user.click(other);
    await user.click(screen.getByRole("button", { name: "모르겠어요" }));
    expect(callsTo(spy, "POST /v1/sessions/s-1/declined")).toHaveLength(0);
    expect(screen.queryByRole("textbox", { name: "주택 소재지" })).not.toBeInTheDocument();

    finish(json({ session_id: "s-1", values: {} }));
    await waitFor(() => expect(callsTo(spy, NEXT)).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "고치기 — 주택 소재지" })).not.toHaveAttribute("aria-disabled"),
    );
  });

  it("저장 중에 화면을 떠나면 늦게 온 응답으로 다음 질문을 받지 않는다", async () => {
    let finish!: (r: Response) => void;
    const spy = heldServer({ [PUT]: () => new Promise<Response>((resolve) => (finish = resolve)) });
    const user = await openList();
    await user.click(screen.getByRole("button", { name: "고치기 — 나이" }));
    const field = screen.getByRole("textbox", { name: "나이" });
    await user.clear(field);
    await user.type(field, "31");
    await user.click(screen.getByRole("button", { name: "저장" }));

    // 사이드바 전체 초기화로 떠난다
    await user.click(screen.getByRole("button", { name: "전체 초기화" }));
    await user.click(screen.getByRole("button", { name: "처음으로" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));

    // 붙잡아 둔 저장 응답을 풀고, 그 뒤 이어질 일까지 끝나기를 기다린다(시간을 재지 않음)
    await settle(finish, json({ session_id: "s-1", values: {} }));
    expect(callsTo(spy, NEXT)).toHaveLength(1);
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });
});

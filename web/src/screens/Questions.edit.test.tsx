/*
 * S3 고치기 저장(S7)과 질문 흐름이 맞물리는 곳 — 저장 중 잠금(다시 시도·다시 연결 확인·새로 시작·처음부터 다시),
 * 저장 뒤 초점, 같은 질문이 다시 오면 적던 답 유지, 받는 중에 들어온 '저장 뒤 다시 받기'를 버리지 않음.
 */
import { renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import type { Question } from "../api/types";
import { AppStateContext, type AppState } from "./AppState";
import { ask, CHOICE_Q, NEXT, open, PUT, sequence, server, TRACE } from "./questionsTesting";
import { callsTo, json, settle } from "./testing";
import { useQuestionFlow } from "./useQuestionFlow";

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

const LOCK = "고친 값을 저장하는 중입니다.";
const listToggle = () => screen.getByText(/지금까지 확인한 항목/);

/** 목록을 열고 나이를 to로 고쳐 저장을 누른다 */
async function saveAge(user: ReturnType<typeof userEvent.setup>, to: string) {
  if (!screen.queryByRole("button", { name: "고치기 — 나이" })) await user.click(listToggle());
  await user.click(screen.getByRole("button", { name: "고치기 — 나이" }));
  const field = screen.getByRole("textbox", { name: "나이" });
  await user.clear(field);
  await user.type(field, to);
  await user.click(screen.getByRole("button", { name: "저장" }));
}

/** PUT을 부를 때마다 하나씩: 처음 n번은 바로 답하고, 그다음은 붙잡아 둔다(finish로 푼다) */
function holdPutAfter(n: number) {
  let calls = 0;
  const hold: { finish: (r: Response) => void } = { finish: () => {} };
  const handler = () => {
    calls += 1;
    if (calls <= n) return json({ session_id: "s-1", values: {} });
    return new Promise<Response>((resolve) => (hold.finish = resolve));
  };
  return { handler, hold };
}

describe("S3 고치기 저장 중 잠금 — 저장 뒤 다음 질문 받기가 버려지지 않게", () => {
  it("다음 질문을 못 받은 상자의 다시 시도를 잠근다. 풀리면 고친 뒤의 질문을 받는다", async () => {
    const user = userEvent.setup();
    const put = holdPutAfter(1);
    const spy = server({
      [NEXT]: sequence(ask(CHOICE_Q), json({ detail: "엔진 오류" }, 500), ask(AREA_Q)),
      [PUT]: put.handler,
    });
    await open();
    await user.click(screen.getByRole("radio", { name: "세대주임" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));
    const box = (await screen.findByRole("heading", { name: "다음 질문을 받지 못했습니다" })).closest("section")!;

    await saveAge(user, "31");
    const retry = within(box).getByRole("button", { name: "다시 시도" });
    expect(retry).toHaveAttribute("aria-disabled", "true");
    expect(box).toHaveTextContent(LOCK);
    await user.click(retry);
    expect(callsTo(spy, NEXT)).toHaveLength(2);

    await settle(put.hold.finish, json({ session_id: "s-1", values: {} }));
    expect(await screen.findByRole("region", { name: "전용면적" })).toBeInTheDocument();
    expect(callsTo(spy, NEXT)).toHaveLength(3);
  });

  it("답 저장 실패 상자의 다시 시도와 새로 시작·처음부터 다시를 잠근다", async () => {
    const user = userEvent.setup();
    let calls = 0;
    let finish!: (r: Response) => void;
    server({
      [NEXT]: () => ask(CHOICE_Q),
      [PUT]: () => {
        calls += 1;
        if (calls === 1) return json({ detail: "저장소 오류" }, 500);
        return new Promise<Response>((resolve) => (finish = resolve));
      },
    });
    await open();
    await user.click(screen.getByRole("radio", { name: "세대주임" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));
    const box = (await screen.findByRole("heading", { name: "답을 저장하지 못했습니다" })).closest("section")!;

    await saveAge(user, "31");
    expect(within(box).getByRole("button", { name: "다시 시도" })).toHaveAttribute("aria-disabled", "true");
    const banner = screen.getByRole("region", { name: "이전에 하던 확인을 이어서 보여 드립니다" });
    expect(within(banner).getByRole("button", { name: "새로 시작" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "처음부터 다시" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await settle(finish, json({ session_id: "s-1", values: {} }));
    await waitFor(() => expect(screen.getByRole("button", { name: "처음부터 다시" })).not.toHaveAttribute("aria-disabled"));
  });
});

describe("S3 고치기 저장 뒤 초점과 적던 답", () => {
  it("같은 질문이 다시 오면 적던 답을 지우지 않고, 초점은 그 줄의 고치기로 돌아온다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: () => ask(CHOICE_Q) });
    await open();
    await user.click(screen.getByRole("radio", { name: "세대주 예정" }));
    await saveAge(user, "31");

    await waitFor(() => expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument());
    expect(screen.getByRole("radio", { name: "세대주 예정" })).toBeChecked();
    await waitFor(() => expect(screen.getByRole("button", { name: "고치기 — 나이" })).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it("새 질문이 오면 초점은 새 질문 제목으로 간다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: sequence(ask(CHOICE_Q), ask(AREA_Q)) });
    await open();
    await saveAge(user, "31");
    const card = await screen.findByRole("region", { name: "전용면적" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument());
    expect(within(card).getByRole("heading", { name: "전용면적" })).toHaveFocus();
  });

  it("고친 줄이 목록에서 사라지고 같은 질문이 오면 초점은 질문 제목으로 간다", async () => {
    const user = userEvent.setup();
    let cleared = false;
    server({
      [NEXT]: () => ask(CHOICE_Q),
      [PUT]: () => {
        cleared = true;
        return json({ session_id: "s-1", values: {} });
      },
      "GET /v1/sessions/s-1": () =>
        json({
          session_id: "s-1",
          values: cleared ? {} : { age: { value: 29, source: "LLM", at: "t", phrase: null } },
        }),
    });
    await open();
    await user.click(listToggle());
    await user.click(screen.getByRole("button", { name: "고치기 — 나이" }));
    await user.click(screen.getByRole("button", { name: "값 비우기" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "고치기 — 나이" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { name: CHOICE_Q.label })).toHaveFocus());
  });

  it("답을 보낸 뒤 같은 항목을 다시 물으면(기준에 걸침) 전처럼 칸을 비운다 — 고치기 저장 뒤만 남긴다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: sequence(ask(CHOICE_Q), ask({ ...CHOICE_Q, ask_kind: "IMPRECISE" })) });
    await open();
    await user.click(screen.getByRole("radio", { name: "세대주 예정" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "세대주 예정" })).not.toBeChecked());
  });
});

describe("S3 받는 중에 들어온 저장 뒤 다시 받기", () => {
  function wrapper({ children }: { children: ReactNode }) {
    const state: AppState = {
      draft: "",
      setDraft: () => {},
      programs: [],
      rememberSession: () => {},
      knowsSession: () => true,
      connected: true,
      recheckConnection: async () => {},
      lostConnection: () => {},
      answeredCount: () => 0,
      countAnswer: () => {},
    };
    return (
      <MemoryRouter>
        <AppStateContext.Provider value={state}>{children}</AppStateContext.Provider>
      </MemoryRouter>
    );
  }

  it("버리지 않고 받던 것이 끝난 뒤 한 번 더 받는다. 들어올 때와 같은 다시 받기는 겹치면 버린다", async () => {
    const holds: ((r: Response) => void)[] = [];
    const spy = server({
      [NEXT]: () => new Promise<Response>((resolve) => holds.push(resolve)),
      [TRACE]: () => json({ session_id: "s-1", events: [] }),
    });
    const { result } = renderHook(() => useQuestionFlow("s-1"), { wrapper });
    await waitFor(() => expect(callsTo(spy, NEXT)).toHaveLength(1));

    const again = result.current.fetchNext("edited");
    void result.current.fetchNext("enter");
    expect(callsTo(spy, NEXT)).toHaveLength(1);

    await settle(holds[0], ask(CHOICE_Q));
    await waitFor(() => expect(callsTo(spy, NEXT)).toHaveLength(2));
    await settle(holds[1], ask(AREA_Q));
    await again;
    await waitFor(() =>
      expect(result.current.load.kind === "ask" && result.current.load.question.field).toBe("housing_area_m2"),
    );
    expect(callsTo(spy, NEXT)).toHaveLength(2);
  });
});

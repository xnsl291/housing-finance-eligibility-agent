/*
 * S4 '이 조건으로 판정했습니다'(S7 고치기, 시안 S4-k) — 출처 표기, 고치기 → PUT → next → assess와 화면 갱신,
 * 모른다고 한 줄에 값 넣기(결함 D1), 비우기, 저장 중 잠금, 늦은 응답.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ask, CHOICE_Q, result, sentBodies, sequence } from "./questionsTesting";
import { ASSESS, assessment, NEXT, open, program, PUT, server, SESSION, sessionOf, TRACE, VALUES } from "./resultTesting";
import { callsTo, json } from "./testing";

afterEach(() => {
  vi.restoreAllMocks();
});

const summary = () => screen.getByRole("region", { name: "이 조건으로 판정했습니다" });
const row = (label: string) => within(summary()).getByRole("rowheader", { name: label }).closest("tr")!;
const keys = (spy: ReturnType<typeof server>) =>
  spy.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`).filter((k) => k.includes("s-1"));

async function changeAge(user: ReturnType<typeof userEvent.setup>, to: string) {
  await user.click(within(summary()).getByRole("button", { name: "고치기 — 나이" }));
  const field = screen.getByRole("textbox", { name: "나이" });
  await user.clear(field);
  await user.type(field, to);
  await user.click(screen.getByRole("button", { name: "저장" }));
}

describe("S4 조건 요약 — 출처", () => {
  it("항목 · 값 · 어디서 온 값인가를 보인다. 문장에서 읽음 / 직접 넣은 값 / 모른다고 함", async () => {
    server();
    await open();

    expect(row("나이")).toHaveTextContent("29");
    expect(row("나이")).toHaveTextContent("“만 29세”에서 읽음");
    expect(row("세대주 여부")).toHaveTextContent("세대주임");
    expect(row("세대주 여부")).toHaveTextContent("직접 넣은 값");
    expect(row("임차보증금")).toHaveTextContent("값 없음");
    expect(row("임차보증금")).toHaveTextContent("모른다고 함 · 다시 묻지 않습니다");
    // 근거 구절을 받지 못한 읽은 값은 구절을 지어내지 않는다. 항목 목록에 없는 항목은 칸 종류를 몰라 고치기가 없다
    expect(row("intended_tenure")).toHaveTextContent("문장에서 읽음");
    expect(within(row("intended_tenure")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("세션 값을 못 받으면 요약 자리에 그렇다고 적고, 다시 시도하면 다시 받는다", async () => {
    const user = userEvent.setup();
    const spy = server({ [SESSION]: sequence(json({ detail: "저장소 오류" }, 500), sessionOf()) });
    await open();
    expect(summary()).toHaveTextContent("판정에 쓴 값을 불러오지 못했습니다. 저장소 오류");
    await user.click(within(summary()).getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(row("나이")).toBeInTheDocument());
    expect(callsTo(spy, ASSESS)).toHaveLength(1);
  });
});

describe("S4 고치기 → 다시 판정", () => {
  it("저장하면 그 값만 PUT → next → assess 차례로 부르고, 결과와 바뀐 곳 안내를 갱신한다", async () => {
    const user = userEvent.setup();
    const spy = server({
      [ASSESS]: sequence(assessment(program()), assessment(program({ status: "NOT_MATCHED", loan_limit: null }))),
      [SESSION]: sequence(sessionOf(), sessionOf({ ...VALUES, age: { value: 40, source: "USER", at: "t", phrase: null } })),
    });
    await open();
    const before = keys(spy).length;

    await changeAge(user, "40");
    await screen.findByText(/고치신 값으로 다시 판정했습니다/);
    expect(sentBodies(spy, PUT)).toEqual([{ values: { age: 40 } }]);
    expect(keys(spy).slice(before, before + 3)).toEqual([PUT, NEXT, ASSESS]);

    const box = screen.getByText(/고치신 값으로 다시 판정했습니다/).closest("[role=status]") as HTMLElement;
    expect(box).toHaveTextContent("고치신 값으로 다시 판정했습니다 — 바뀐 곳 1군데");
    expect(box).toHaveTextContent("가상 청년 상품 가 — 사전 조건 부합 → 조건 불충족");
    expect(box).toHaveTextContent("고친 값: 나이 — 29 → 40");
    // 저장하면 고치기 줄이 닫혀 초점 둘 곳이 사라지므로 안내로 옮긴다
    expect(box).toHaveFocus();
    // 카드와 요약도 새 응답으로
    expect(screen.getByRole("heading", { level: 3, name: "가상 청년 상품 가" }).closest("article")).toHaveTextContent("조건 불충족");
    expect(row("나이")).toHaveTextContent("직접 넣은 값");
  });

  it("다시 판정해도 바뀐 것이 없으면 그대로라고 적는다", async () => {
    const user = userEvent.setup();
    server();
    await open();
    await changeAge(user, "30");
    expect(await screen.findByText("판정과 한도는 그대로입니다.")).toBeInTheDocument();
  });

  it("고친 뒤 아직 물을 것이 남으면 '중간에 멈췄습니다'가 아니라 남았다고 하고, 질문 이어서 하기를 둔다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: sequence(result("COMPLETE"), ask(CHOICE_Q)) });
    await open();
    expect(screen.queryByRole("button", { name: "질문 이어서 하기" })).not.toBeInTheDocument();
    await changeAge(user, "30");
    expect(await screen.findByText("아직 여쭐 항목이 남았습니다")).toBeInTheDocument();
    expect(screen.queryByText("중간에 멈췄습니다")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "질문 이어서 하기" })).toBeInTheDocument();
  });

  it("값 비우기는 null을 보내고, 바뀐 곳 안내에 '비움'으로 적는다", async () => {
    const user = userEvent.setup();
    const { age: _age, ...rest } = VALUES;
    const spy = server({ [SESSION]: sequence(sessionOf(), sessionOf(rest)) });
    await open();
    await user.click(within(summary()).getByRole("button", { name: "고치기 — 나이" }));
    expect(summary()).toHaveTextContent("‘모른다고 함’으로 남지 않아 질문을 이어서 하면 다시 여쭐 수 있습니다");
    await user.click(screen.getByRole("button", { name: "값 비우기" }));
    expect(await screen.findByText("고친 값: 나이 — 29 → 비움")).toBeInTheDocument();
    expect(sentBodies(spy, PUT)).toEqual([{ values: { age: null } }]);
    expect(within(summary()).queryByRole("rowheader", { name: "나이" })).not.toBeInTheDocument();
  });

  it("서버가 거절하면(422) 그 줄 아래에 사유. 다시 판정하지 않는다", async () => {
    const user = userEvent.setup();
    const spy = server({ [PUT]: () => json({ detail: "값이 맞지 않습니다 — 나이: 음수" }, 422) });
    await open();
    await changeAge(user, "31");
    expect(await within(summary()).findByText("값이 맞지 않습니다 — 나이: 음수")).toBeInTheDocument();
    expect(callsTo(spy, NEXT)).toHaveLength(1);
    expect(callsTo(spy, ASSESS)).toHaveLength(1);
  });
});

describe("S4 모른다고 한 항목에 값 넣기 — 결함 D1", () => {
  // sequence는 부른 횟수를 들고 있어 테스트마다 새로 만든다
  const declinedLeft = () => ({ [NEXT]: sequence(result("ONLY_DECLINED_LEFT", ["lease_deposit_krw"]), result("COMPLETE")) });

  it("모른다고 한 것만 남아 멈췄으면 배너 안에 그 항목의 '값 넣기'가 있고, 누르면 요약의 그 줄이 열려 칸에 초점이 간다", async () => {
    const user = userEvent.setup();
    server(declinedLeft());
    await open();
    expect(screen.getByText("임차보증금을(를) 모르셔서 확정하지 못한 부분이 있습니다. 확인되면 이어서 판정할 수 있습니다.")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "임차보증금 값 넣기" }));
    const field = within(row("임차보증금").nextElementSibling as HTMLElement).getByRole("textbox", { name: "임차보증금" });
    expect(field).toHaveFocus();
  });

  it("값을 넣어 저장하면 다시 판정하고, 모른다고 한 것이 풀려 멈춘 이유가 바뀐다", async () => {
    const user = userEvent.setup();
    const spy = server({
      ...declinedLeft(),
      [SESSION]: sequence(
        sessionOf(),
        sessionOf({ ...VALUES, lease_deposit_krw: { value: 180_000_000, source: "USER", at: "t", phrase: null } }),
      ),
      [TRACE]: sequence(
        json({ session_id: "s-1", events: [{ seq: 1, at: "t", kind: "FIELD_DECLINED", payload: { field: "lease_deposit_krw" } }] }),
        json({
          session_id: "s-1",
          events: [
            { seq: 1, at: "t", kind: "FIELD_DECLINED", payload: { field: "lease_deposit_krw" } },
            { seq: 2, at: "t", kind: "FIELD_SET", payload: { values: { lease_deposit_krw: 180_000_000 } } },
          ],
        }),
      ),
    });
    await open();
    await user.click(await screen.findByRole("button", { name: "임차보증금 값 넣기" }));
    await user.type(screen.getByRole("textbox", { name: "임차보증금" }), "1억 8천");
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("모두 확인했습니다")).toBeInTheDocument();
    expect(screen.queryByText("모르신 항목이 남았습니다")).not.toBeInTheDocument();
    expect(sentBodies(spy, PUT)).toEqual([{ values: { lease_deposit_krw: 180_000_000 } }]);
    expect(row("임차보증금")).toHaveTextContent("1억 8,000만원");
    expect(screen.getByText("고친 값: 임차보증금 — 모른다고 함 → 1억 8,000만원")).toBeInTheDocument();
  });
});

describe("S4 고치기 — 잠금과 늦은 응답", () => {
  it("저장하고 다시 판정하는 동안 다른 줄의 고치기를 잠근다", async () => {
    const user = userEvent.setup();
    let finish!: (r: Response) => void;
    const spy = server({ [PUT]: () => new Promise<Response>((resolve) => (finish = resolve)) });
    await open();
    await changeAge(user, "31");
    const other = within(summary()).getByRole("button", { name: "고치기 — 세대주 여부" });
    expect(other).toHaveAttribute("aria-disabled", "true");
    expect(summary()).toHaveTextContent("고친 값을 저장하는 중입니다.");
    await user.click(other);
    expect(screen.queryByRole("radio", { name: "세대주 예정" })).not.toBeInTheDocument();

    finish(json({ session_id: "s-1", values: {} }));
    await waitFor(() => expect(callsTo(spy, ASSESS)).toHaveLength(2));
    await waitFor(() => expect(within(summary()).getByRole("button", { name: "고치기 — 세대주 여부" })).not.toHaveAttribute("aria-disabled"));
  });

  it("다시 판정을 기다리는 동안 앞 결과와 요약을 지우지 않는다 — 고치던 줄과 초점을 잃지 않게", async () => {
    const user = userEvent.setup();
    let calls = 0;
    let finish!: (r: Response) => void;
    server({
      [NEXT]: () => (++calls === 1 ? result("COMPLETE") : new Promise<Response>((resolve) => (finish = resolve))),
    });
    await open();
    await changeAge(user, "31");
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getByRole("heading", { level: 3, name: "가상 청년 상품 가" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장하는 중" })).toBeInTheDocument();
    finish(result("COMPLETE"));
    expect(await screen.findByText(/고치신 값으로 다시 판정했습니다/)).toBeInTheDocument();
  });

  it("저장 중에 화면을 떠나면 늦게 온 응답으로 다시 판정하지 않는다", async () => {
    const user = userEvent.setup();
    let finish!: (r: Response) => void;
    const spy = server({ [PUT]: () => new Promise<Response>((resolve) => (finish = resolve)) });
    await open();
    await changeAge(user, "31");
    await user.click(screen.getByRole("button", { name: "전체 초기화" }));
    await user.click(screen.getByRole("button", { name: "처음으로" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));

    finish(json({ session_id: "s-1", values: {} }));
    await new Promise((r) => setTimeout(r, 20));
    expect(callsTo(spy, NEXT)).toHaveLength(1);
    expect(callsTo(spy, ASSESS)).toHaveLength(1);
  });
});

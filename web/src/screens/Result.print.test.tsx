/*
 * S12 결과 인쇄·복사와 행동 영역의 주 버튼 규칙.
 * - 복사한 글: 고지가 맨 앞(G1), 불충족 상품은 한도 없음, 확정 전 한도는 '지금까지 확인된 조건 기준'과 단서(G7)
 * - 클립보드 실패 알림, 인쇄 호출, 인쇄 동안만 접힌 것을 펼침
 * - 주 버튼: 물을 것이 남았으면 '질문 이어서 하기', 아니면 '결과 인쇄'
 */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { NOTICE } from "../components/Notice";
import { AppStateContext, type AppState } from "./AppState";
import { ask, CHOICE_Q } from "./questionsTesting";
import { COPIED, COPY_FAILED, ResultActions } from "./ResultActions";
import { copyText } from "./resultCopy";
import { ASSESS, assessment, NEXT, open, PATH, program, server } from "./resultTesting";
import { renderApp } from "./testing";

// 테스트가 navigator.clipboard를 바꾼다. 다른 테스트로 새지 않게 원래 것(jsdom은 없음)으로 되돌린다
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

const MATCH = program({ program_id: "p-a", program_name: "상품 가" });
const MAYBE = program({
  program_id: "p-b",
  program_name: "상품 나",
  status: "CONDITIONAL",
  missing_fields: ["net_asset_krw"],
  next_actions: ["순자산 정보가 필요합니다"],
  loan_limit: { ...MATCH.loan_limit!, amount_krw: 120_000_000, ratio_amount_krw: 120_000_000 },
});
const FAIL = program({
  program_id: "p-c",
  program_name: "상품 다",
  status: "NOT_MATCHED",
  next_actions: ["임차보증금이 3억원을 넘음"],
  loan_limit: { ...MATCH.loan_limit!, amount_krw: 99_000_000, ratio_amount_krw: 99_000_000 },
});

const actions = () => screen.getByRole("region", { name: "다음 할 일" });
const button = (name: string) => within(actions()).getByRole("button", { name });

/** 클립보드를 흉내 낸다. writeText가 받은 글을 돌려준다 */
function clipboard(fail = false) {
  const writeText = vi.fn(async (text: string) => {
    if (fail) throw new DOMException("막힘", "NotAllowedError");
    return text && undefined;
  });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

const SCOPE = "전세를 구하신다고 해서 매매 상품은 빼고 봤습니다";

describe("결과 복사 글 (S12)", () => {
  const text = copyText({
    reason: "COMPLETE",
    declinedLabels: [],
    scope: SCOPE,
    copiedAt: new Date(2026, 9, 22, 9, 5),
    results: [FAIL, MAYBE, MATCH],
    programs: null,
    items: [
      { field: "age", label: "나이", source: "read", declined: false, value: 29, shown: "29", phrase: "만 29세" },
      { field: "net_asset_krw", label: "순자산", source: "declined", declined: true, value: null, shown: null, phrase: null },
    ],
  });
  const lines = text.split("\n");

  it("고지 문구가 맨 앞 두 줄이다 — 판정만 잘려 나가지 않게(G1). 끝에도 결과 고지를 한 번 더", () => {
    expect(lines[0]).toBe(NOTICE.header);
    expect(lines[1]).toBe(NOTICE.result);
    expect(lines.at(-1)).toBe(NOTICE.result);
  });

  it("고지 다음 제목 줄 아래에 복사 일시를 적는다 — 언제 본 결과인지", () => {
    expect(lines[3]).toBe("주거금융 지원가능성 판정 결과");
    expect(lines[4]).toBe("복사 일시 2026-10-22 09:05");
  });

  it("'왜 이 상품만 보이나' 한 줄을 판정 상품 목록 앞에 둔다(화면의 scope 줄과 같은 말)", () => {
    expect(text.indexOf(SCOPE)).toBeGreaterThan(0);
    expect(text.indexOf(SCOPE)).toBeLessThan(text.indexOf("[상품 가]"));
  });

  it("조건 불충족 상품은 한도 줄이 없다 — 금액을 보이지 않는다(G7)", () => {
    const fail = text.slice(text.indexOf("[상품 다]"), text.indexOf("이 조건으로 판정했습니다"));
    expect(fail).toContain("조건 불충족");
    expect(fail).not.toMatch(/한도/);
    expect(text).not.toContain("9,900만원");
    expect(fail).toContain("- 임차보증금이 3억원을 넘음");
  });

  it("확정 전 한도는 '지금까지 확인된 조건 기준'과 단서를 붙이고, 확정이면 '예상 대출 한도'", () => {
    expect(text).toContain(
      "지금까지 확인된 조건 기준 한도: 1억 2,000만원 (비율로 구한 1억 2,000만원과 금액 상한 1억 5,000만원 중 작은 쪽입니다 — 비율에 걸렸습니다) — 아직 확인되지 않은 조건이 1개 있어 이 금액은 달라질 수 있습니다",
    );
    expect(text).toContain("예상 대출 한도: 1억 4,400만원");
    expect(text).not.toMatch(/예상 대출 한도: 1억 2,000만원/);
  });

  it("상품은 카드와 같은 판정 순, 확정 표현을 쓰지 않는다(G1)", () => {
    const order = ["[상품 가]", "[상품 나]", "[상품 다]"].map((n) => text.indexOf(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).not.toMatch(/승인되|자격 있음|가능합니다|대출 가능/);
  });

  it("이 조건으로 판정했습니다 — 값과 출처, 모른다고 한 항목", () => {
    expect(text).toContain("- 나이: 29 (“만 29세”에서 읽음)");
    expect(text).toContain("- 순자산: 모른다고 함");
  });
});

describe("결과 복사·인쇄 버튼", () => {
  it("결과 복사: 고지가 맨 앞인 글을 클립보드에 쓰고 성공을 알린다", async () => {
    const writeText = clipboard();
    server({ [ASSESS]: () => assessment(MATCH, FAIL) });
    await open();
    await userEvent.click(button("결과 복사"));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied.startsWith(`${NOTICE.header}\n${NOTICE.result}\n`)).toBe(true);
    expect(copied).toContain("[상품 다] 조건 불충족");
    expect(await screen.findByText(COPIED)).toBeInTheDocument();
  });

  it("클립보드가 막히면 실패를 알린다 — 복사된 줄 알고 빈 글을 붙여 넣지 않게", async () => {
    clipboard(true);
    server();
    await open();
    await userEvent.click(button("결과 복사"));
    expect(await screen.findByText(COPY_FAILED)).toBeInTheDocument();
    expect(screen.queryByText(COPIED)).not.toBeInTheDocument();
  });

  it("클립보드가 아예 없으면(주소가 https·localhost가 아님 등) 실패를 알린다", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    server();
    await open();
    await userEvent.click(button("결과 복사"));
    expect(await screen.findByText(COPY_FAILED)).toBeInTheDocument();
  });

  it("같은 알림을 곧바로 다시 띄우면 알림 줄을 새로 그린다 — 화면 읽기 프로그램이 다시 읽게", async () => {
    clipboard(true);
    server();
    await open();
    await userEvent.click(button("결과 복사"));
    const first = await screen.findByText(COPY_FAILED);
    await userEvent.click(button("결과 복사"));
    await vi.waitFor(() => expect(first).not.toBeInTheDocument());
    expect(screen.getByText(COPY_FAILED)).not.toBe(first);
  });

  it("결과 인쇄는 브라우저 인쇄를 부른다", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    server();
    await open();
    await userEvent.click(button("결과 인쇄"));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("인쇄하는 동안만 접힌 판정 근거·확인 과정을 펼치고, 사용자가 열어 둔 것은 그대로 둔다", async () => {
    server({ [ASSESS]: () => assessment(MATCH, MAYBE) });
    await open();
    const all = [...document.querySelectorAll<HTMLDetailsElement>("main details")];
    expect(all.length).toBeGreaterThanOrEqual(3);
    all[0].open = true;
    act(() => void window.dispatchEvent(new Event("beforeprint")));
    expect(all.every((d) => d.open)).toBe(true);
    // 인쇄 후 이벤트 없이 인쇄 전 이벤트가 한 번 더 와도 처음에 연 것을 잊지 않는다
    act(() => void window.dispatchEvent(new Event("beforeprint")));
    act(() => void window.dispatchEvent(new Event("afterprint")));
    expect(all[0].open).toBe(true);
    expect(all.slice(1).every((d) => !d.open)).toBe(true);
  });

  it("인쇄할 때 머리에 인쇄 일시를 적는다. 인쇄 전에는 화면에 없다", async () => {
    server();
    await open();
    const main = screen.getByRole("main");
    expect(main).not.toHaveTextContent("인쇄 일시");
    act(() => void window.dispatchEvent(new Event("beforeprint")));
    expect(main.textContent).toMatch(/인쇄 일시 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    // 제목보다 앞(머리)
    const stamp = within(main).getByText(/^인쇄 일시/);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(stamp.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("인쇄하는 동안 맨 위로 올렸다가 끝나면 보던 자리로 돌려놓는다 — 내려 본 채로 인쇄하면 Chrome이 바닥 고지를 쪽마다 찍지 않는다", async () => {
    server();
    await open();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(window, "scrollY", "get").mockReturnValue(800);
    act(() => void window.dispatchEvent(new Event("beforeprint")));
    act(() => void window.dispatchEvent(new Event("beforeprint")));
    act(() => void window.dispatchEvent(new Event("afterprint")));
    expect(scrollTo.mock.calls).toEqual([[0, 0], [0, 0], [0, 800]]);
  });

  it("쪽마다 바닥에 반복할 고지는 기존 결과 고지 문구 그대로다(화면에서는 CSS로 숨김, 화면 읽기 프로그램도 읽지 않음)", async () => {
    server();
    await open();
    const footer = document.querySelector("[data-print-footer]")!;
    expect(footer.textContent).toBe(NOTICE.result);
    expect(footer).toHaveAttribute("aria-hidden", "true");
  });
});

describe("결과 복사 — 글 만들기에서 난 예외", () => {
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

  it("복사할 글을 만들다 던져도 실패를 알린다 — 조용히 넘어가 복사된 줄 알지 않게", async () => {
    const writeText = clipboard();
    render(
      <MemoryRouter>
        <AppStateContext.Provider value={state}>
          <ResultActions
            sessionId="s-1"
            moreToAsk={false}
            copy={() => {
              throw new Error("글 만들기 실패");
            }}
            dirty={false}
            continueLock={undefined}
            savingLock={undefined}
          />
        </AppStateContext.Provider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "결과 복사" }));
    expect(await screen.findByText(COPY_FAILED)).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("행동 영역의 주 버튼 (설계서 S4 제안 배치 8)", () => {
  // 주 버튼은 행동 영역의 맨 앞(왼쪽, 탭 순서 첫째)에 온다. 색(CSS 클래스)은 vitest가 CSS를 읽지 않아 볼 수 없으므로
  // 사용자가 보고 누르는 순서로 확인한다. 처음부터 다시는 늘 맨 뒤 글자 버튼
  const order = () => within(actions()).getAllByRole("button").map((b) => b.textContent);

  it("물을 것이 남지 않았으면 '결과 인쇄'가 맨 앞(주 버튼), 다음이 '결과 복사'", async () => {
    server();
    await open();
    expect(order()).toEqual(["결과 인쇄", "결과 복사", "처음부터 다시"]);
  });

  it("물을 것이 남았으면 '질문 이어서 하기'가 맨 앞(주 버튼), 인쇄·복사는 그 뒤", async () => {
    server({ [NEXT]: () => ask(CHOICE_Q) });
    await open();
    expect(order()).toEqual(["질문 이어서 하기", "결과 인쇄", "결과 복사", "처음부터 다시"]);
  });

  it("결과를 못 받았으면 인쇄·복사를 두지 않는다", async () => {
    server({ [ASSESS]: () => new Response(JSON.stringify({ detail: "x" }), { status: 500 }) });
    renderApp(PATH);
    await screen.findByText("판정하지 못했습니다");
    expect(within(actions()).queryByRole("button", { name: "결과 인쇄" })).not.toBeInTheDocument();
    expect(within(actions()).queryByRole("button", { name: "결과 복사" })).not.toBeInTheDocument();
  });
});

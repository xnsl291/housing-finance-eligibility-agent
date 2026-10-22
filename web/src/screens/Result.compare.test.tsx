/*
 * S9 상품 비교표 — 후보 2개 이상일 때만, 열, 한도 칸의 G7 규칙, 카드와 같은 판정 순, '자세히'로 카드에 가기.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { STAR_NOTE, STAR_NOTE_WIDE } from "./CompareTable";
import { ASSESS, assessment, card, open, program, server } from "./resultTesting";

afterEach(() => vi.restoreAllMocks());

const MATCH = program({ program_id: "p-a", program_name: "상품 가" });
const MAYBE = program({
  program_id: "p-b",
  program_name: "상품 나",
  status: "CONDITIONAL",
  imprecise_fields: ["combined_annual_income_krw"],
  missing_fields: ["net_asset_krw"],
  loan_limit: { ...MATCH.loan_limit!, amount_krw: 120_000_000 },
});
const FAIL = program({
  program_id: "p-c",
  program_name: "상품 다",
  status: "NOT_MATCHED",
  missing_fields: ["age"],
  loan_limit: { ...MATCH.loan_limit!, amount_krw: 99_000_000 },
});

const table = () => screen.getByRole("table", { name: /한눈에/ });

/** 표의 줄들을 [상품, 판정, 한도, 남은 확인] 글로 */
function rows(): string[][] {
  return within(table())
    .getAllByRole("row")
    .slice(1)
    .map((row) => [...row.querySelectorAll("th, td")].slice(0, 4).map((c) => c.textContent ?? ""));
}

describe("S9 상품 비교표", () => {
  it("후보가 1개면 그리지 않는다", async () => {
    server();
    await open();
    expect(screen.queryByRole("table", { name: /한눈에/ })).not.toBeInTheDocument();
  });

  it("2개 이상이면 카드 목록 위에, 열은 상품·판정·예상 한도·남은 확인·자세히", async () => {
    server({ [ASSESS]: () => assessment(MATCH, MAYBE) });
    await open();
    const t = table();
    expect(t).toHaveAccessibleName("상품 2개를 한눈에");
    const heads = within(t).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["상품", "판정", "예상 한도", "남은 확인", "카드로 가기"]);
    // 표가 첫 카드보다 앞에 있다
    expect(t.compareDocumentPosition(card("상품 가")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("카드와 같은 판정 순으로 줄을 세운다 — 서버 순서가 불충족·확인 필요·부합이어도", async () => {
    server({ [ASSESS]: () => assessment(FAIL, MAYBE, MATCH) });
    await open();
    expect(rows().map((r) => r[0])).toEqual(["상품 가", "상품 나", "상품 다"]);
    const cards = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(cards).toEqual(["상품 가", "상품 나", "상품 다"]);
  });

  it("한도(G7): 확정이면 금액, 확정 전이면 금액 옆 '*'와 표 아래 설명, 불충족이면 '—'(금액을 보이지 않음)", async () => {
    server({ [ASSESS]: () => assessment(FAIL, MAYBE, MATCH) });
    await open();
    expect(rows()).toEqual([
      ["상품 가", "사전 조건 부합", "1억 4,400만원", "0개"],
      ["상품 나", "추가 확인 필요", "1억 2,000만원 * (달라질 수 있음 — 표 아래 설명)", "2개"],
      ["상품 다", "조건 불충족", "—", "—"],
    ]);
    expect(table()).not.toHaveTextContent("9,900만원");
    expect(table()).toHaveAccessibleDescription(STAR_NOTE);
    expect(screen.getByText(STAR_NOTE)).toBeInTheDocument();
  });

  it("'*'가 없으면 표 아래 설명도 없다", async () => {
    server({ [ASSESS]: () => assessment(MATCH, FAIL) });
    await open();
    expect(screen.queryByText(STAR_NOTE)).not.toBeInTheDocument();
    expect(table()).not.toHaveAccessibleDescription();
  });

  it("남은 조건 0개인데 판정이 안 끝난 금액이 있으면 설명을 넓혀 쓴다 — '남은 조건이 있어'는 틀린 말이라서", async () => {
    const pending = program({ program_id: "p-d", program_name: "상품 라", status: "CONDITIONAL" });
    server({ [ASSESS]: () => assessment(MATCH, pending) });
    await open();
    expect(rows()[1][2]).toContain("*");
    expect(screen.getByText(STAR_NOTE_WIDE)).toBeInTheDocument();
  });

  it("금액을 못 냈으면 '계산하지 못함'", async () => {
    const none = program({
      program_id: "p-e",
      program_name: "상품 마",
      status: "INSUFFICIENT_INFORMATION",
      loan_limit: { ...MATCH.loan_limit!, amount_krw: null, reason: "BASE_UNKNOWN" },
    });
    server({ [ASSESS]: () => assessment(MATCH, none) });
    await open();
    expect(rows()[1][2]).toBe("계산하지 못함");
  });

  it("'자세히'는 그 카드로 스크롤하고 카드 제목에 초점을 옮기고 카드를 잠깐 강조한다", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    server({ [ASSESS]: () => assessment(MATCH, MAYBE) });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "자세히 상품 나" }));
    const target = card("상품 나");
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(target);
    expect(within(target).getByRole("heading", { level: 3 })).toHaveFocus();
    expect(target).toHaveAttribute("data-flash");
    expect(card("상품 가")).not.toHaveAttribute("data-flash");
    // 강조는 애니메이션이 끝나면 거둔다
    target.dispatchEvent(new Event("animationend"));
    expect(target).not.toHaveAttribute("data-flash");
    // jsdom에는 scrollIntoView가 없어 테스트가 붙였다. 다른 테스트로 새지 않게 뗀다
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });
});

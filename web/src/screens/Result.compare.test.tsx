/*
 * S9 상품 비교표 — 후보 2개 이상일 때만, 열, 한도 칸의 G7 규칙, 카드와 같은 판정 순, '자세히'로 카드에 가기.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { STAR_NOTE, STAR_NOTE_WIDE } from "./CompareTable";
import { ASSESS, assessment, card, open, program, server } from "./resultTesting";
import { screenWidth } from "./testing";
import compareCss from "./CompareTable.module.css?raw";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // jsdom에는 scrollIntoView가 없어 '자세히' 테스트가 붙인다. 테스트가 중간에 실패해도 다른 테스트로 새지 않게 여기서 뗀다
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

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
    // 카드 안 다른 요소의 애니메이션이 끝난 것(올라온 animationend)으로는 거두지 않는다
    within(target).getByRole("heading", { level: 3 }).dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(target).toHaveAttribute("data-flash");
    // 강조는 카드 자신의 애니메이션이 끝나면 거둔다
    target.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(target).not.toHaveAttribute("data-flash");
  });
});

describe("S9 — 600px 미만에서는 표 대신 상품마다 한 줄 카드(설계서 S9·11.4)", () => {
  // 표와 카드를 둘 다 그리고 CSS가 화면 폭으로 하나만 보인다(CompareTable.tsx 머리말). jsdom은 @media를 계산하지 않아
  // 어느 쪽이 보이는지는 CSS 규칙(아래 'CSS 규칙')과 브라우저로 확인하고, 여기서는 두 구조와 그 내용을 본다
  const list = () => screen.getByRole("list", { name: /한눈에/, hidden: true });
  const items = () => within(list()).getAllByRole("button", { hidden: true }).map((b) => b.textContent);

  it.each([390, 900, 1440])("%ipx: 표와 카드를 둘 다 그린다. 카드 묶음은 넓은 화면·인쇄에서 숨는 클래스를 단다", async (width) => {
    screenWidth(width);
    server({ [ASSESS]: () => assessment(MATCH, MAYBE) });
    await open();
    expect(screen.getByRole("table", { name: /한눈에/, hidden: true })).toBeInTheDocument();
    expect(list()).toHaveAccessibleName("상품 2개를 한눈에");
    const box = list().parentElement!;
    expect(box.className).toMatch(/cardList/);
    expect(box).toContainElement(screen.getByText("상품 2개를 한눈에", { selector: "p" }));
    // 감싼 구역에는 이름을 붙이지 않는다 — 표·목록과 같은 이름이 두 번 읽힌다
    expect(screen.queryByRole("region", { name: /한눈에/, hidden: true })).not.toBeInTheDocument();
  });

  it("카드 묶음은 넓은 화면에서 display:none이라 화면 읽기 프로그램이 표와 카드를 두 번 읽지 않는다", async () => {
    server({ [ASSESS]: () => assessment(MATCH, MAYBE) });
    await open();
    expect(getComputedStyle(list().parentElement!).display).toBe("none");
    expect(screen.queryByRole("list", { name: /한눈에/ })).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: /한눈에/ })).toBeVisible();
  });

  it("칸 규칙은 표와 같다 — 판정 순, 확정 전 금액 '*'와 아래 설명, 불충족은 '—'이고 남은 확인을 적지 않음", async () => {
    screenWidth(390);
    server({ [ASSESS]: () => assessment(FAIL, MAYBE, MATCH) });
    await open();
    expect(items()).toEqual([
      "상품 가사전 조건 부합예상 한도 1억 4,400만원남은 확인 0개",
      "상품 나추가 확인 필요예상 한도 1억 2,000만원 * (달라질 수 있음 — 목록 아래 설명)남은 확인 2개",
      "상품 다조건 불충족예상 한도 —",
    ]);
    expect(list()).not.toHaveTextContent("9,900만원");
    expect(list()).toHaveAccessibleDescription(STAR_NOTE);
  });

  it("'예상 한도'는 눈에 보이는 이름표다 — 불충족 카드에 '—'만 덩그러니 남지 않게", async () => {
    screenWidth(390);
    server({ [ASSESS]: () => assessment(MATCH, FAIL) });
    await open();
    for (const label of within(list()).getAllByText(/^예상 한도/)) expect(label.closest(".sr-only")).toBeNull();
  });

  it("카드를 누르면 표의 '자세히'처럼 그 상품 카드로 가 제목에 초점을 옮긴다", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    screenWidth(390);
    server({ [ASSESS]: () => assessment(MATCH, MAYBE) });
    await open();
    await userEvent.click(within(list()).getByRole("button", { name: /^상품 나/, hidden: true }));
    const target = card("상품 나");
    expect(scroll.mock.contexts[0]).toBe(target);
    expect(within(target).getByRole("heading", { level: 3 })).toHaveFocus();
    expect(target).toHaveAttribute("data-flash");
  });
});

describe("S9 CSS 규칙 — 어느 쪽을 보일지(jsdom이 @media를 계산하지 않아 규칙 글을 읽어 본다)", () => {
  /** css에서 `@media <조건> { ... }` 본문. 중괄호 짝을 세어 자른다. 없으면 빈 글 */
  function mediaBlock(condition: string): string {
    const start = compareCss.indexOf(`@media ${condition} {`);
    if (start < 0) return "";
    let depth = 0;
    for (let i = compareCss.indexOf("{", start); i < compareCss.length; i++) {
      if (compareCss[i] === "{") depth++;
      if (compareCss[i] === "}" && --depth === 0) return compareCss.slice(start, i + 1);
    }
    return "";
  }
  /** @media 밖의 규칙만 */
  const outsideMedia = () => compareCss.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, "");
  const display = (css: string, cls: string, value: string) =>
    new RegExp(String.raw`\.${cls}\s*\{[^}]*display:\s*${value}`).test(css);

  it("기본(넓은 화면·인쇄): 카드 묶음은 숨고 표는 보인다", () => {
    expect(display(outsideMedia(), "cardList", "none")).toBe(true);
    expect(display(outsideMedia(), "table", "none")).toBe(false);
  });

  it("600px 미만 화면에서만 표를 숨기고 카드를 보인다 — 'screen and'라 인쇄에는 걸리지 않아 폰에서 인쇄해도 표가 찍힌다", () => {
    const small = mediaBlock("screen and (max-width: 599px)");
    expect(display(small, "table", "none")).toBe(true);
    expect(display(small, "cardList", "flex")).toBe(true);
    const print = mediaBlock("print");
    expect(display(print, "table", "none")).toBe(false);
    expect(display(print, "cardList", "flex")).toBe(false);
  });
});

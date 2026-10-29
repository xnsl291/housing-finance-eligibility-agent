/*
 * S13 의견 보내기 — 판정 근거(S5) 끝의 '이 판정이 이상해요'. 공개 GitHub 이슈로 열리므로 입력한 값·세션 번호는
 * 주소에 넣지 않는다(이슈는 누구나 본다). 넣는 것은 양식 이름·상품 이름·판정 이름뿐
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ASSESS, assessment, card, open, program, server, SESSION, sessionOf, VALUES } from "./resultTesting";

afterEach(() => vi.restoreAllMocks());

/** 판정에 쓴 값 — 다른 판정 테스트에 없는 숫자로 골라, 주소에 섞이면 바로 드러나게 */
const INCOME = 41_230_000;

async function reportLink(name = "가상 청년 상품 가") {
  const user = userEvent.setup();
  const article = card(name);
  await user.click(within(article).getByText("판정 근거 자세히 보기"));
  return within(article).getByRole("link", { name: /이 판정이 이상해요/ });
}

function setup() {
  server({
    [ASSESS]: () =>
      assessment(
        program({ status: "INSUFFICIENT_INFORMATION" }),
        program({ program_id: "p-buy", program_name: "가상 상품 나", status: "NOT_MATCHED", loan_limit: null }),
      ),
    [SESSION]: () =>
      sessionOf({
        ...VALUES,
        combined_annual_income_krw: { value: INCOME, source: "USER", at: "2026-10-22T00:00:00Z", phrase: "연봉 4123만원" },
      }),
  });
}

describe("S13 이 판정이 이상해요", () => {
  it("공개 저장소의 판정 의견 이슈 양식을 연다 — 상품 이름과 그 카드의 판정 이름만 채운다", async () => {
    setup();
    await open();
    const url = new URL((await reportLink()).getAttribute("href")!);
    expect(url.origin + url.pathname).toBe("https://github.com/xnsl291/housing-finance-eligibility-agent/issues/new");
    expect(url.searchParams.get("template")).toBe("judgment-feedback.yml");
    expect(url.searchParams.get("product")).toBe("가상 청년 상품 가");
    expect(url.searchParams.get("verdict")).toBe("정보 부족");
    expect(url.searchParams.get("title")).toBe("[판정 의견] 가상 청년 상품 가 — 정보 부족");

    const other = new URL((await reportLink("가상 상품 나")).getAttribute("href")!);
    expect(other.searchParams.get("product")).toBe("가상 상품 나");
    expect(other.searchParams.get("verdict")).toBe("조건 불충족");
  });

  it("넣은 값·근거 구절·세션 번호는 주소에 넣지 않는다", async () => {
    setup();
    await open();
    // 화면에는 그 값이 보인다(이 조건으로 판정했습니다) — 화면에 있어도 주소로 새지 않아야 한다
    expect(screen.getAllByText(/4,123만/).length).toBeGreaterThan(0);
    const url = new URL((await reportLink()).getAttribute("href")!);
    expect([...url.searchParams.keys()].sort()).toEqual(["product", "template", "title", "verdict"]);
    // 주소에서 읽히는 글 전부(경로 + 채운 값을 푼 것). '+'로 바뀐 띄어쓰기도 풀어서 본다
    const href = [decodeURIComponent(url.pathname), ...url.searchParams.values()].join(" ");
    // 나이 29는 저장소 주인 이름(xnsl291)에 숫자로 들어 있어 근거 구절 '만 29세'로 본다
    for (const leak of [String(INCOME), "4123", "4,123", "연봉", "만 29세", "s-1", "144000000", "144,000,000", "1억"]) {
      expect(href).not.toContain(leak);
    }
  });

  it("새 탭으로 안전하게 열고, 공개 이슈라 개인정보를 적지 말라는 말이 바로 옆에 보인다", async () => {
    setup();
    await open();
    const link = await reportLink();
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")?.split(" ").sort()).toEqual(["noopener", "noreferrer"]);
    const box = link.closest("section")!;
    expect(
      within(box).getByText(
        "GitHub 공개 이슈로 열립니다. 입력한 값이나 개인정보는 적지 마세요. GitHub 계정이 필요합니다.",
      ),
    ).toBeVisible();
    // 인쇄(S12)에서는 뺀다 — 종이에서는 누를 수 없고, 주소가 뒤에 붙어 찍힌다
    expect(box).toHaveClass("screen-only");
  });
});

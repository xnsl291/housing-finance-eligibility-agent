/*
 * S5 판정 근거 상세(카드 안)와 S6 확인 과정(결과 아래 접힘).
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NOTICE } from "../components/Notice";
import { ASSESS, assessment, card, EVENTS, event, open, program, server, TRACE, traceOf } from "./resultTesting";
import { json } from "./testing";

afterEach(() => vi.restoreAllMocks());

/** 서버(api.py)처럼 field_label은 항목 목록의 이름표, 파생 항목도 이름표, field가 null이면 null */
const LABEL: Record<string, string> = {
  age: "나이",
  household_head_status: "세대주 여부",
  lease_deposit_krw: "임차보증금",
  net_asset_krw: "순자산",
  combined_annual_income_krw: "부부합산 총소득",
  region: "수도권 여부",
  military_service_years: "병역 복무기간",
  employment_category: "고용 형태",
  move_in_date: "전입일",
};
const rule = (rule_id: string, outcome: string, field: string | null, citation: string | null, failure_message: string | null = null) => ({
  rule_id,
  outcome,
  field,
  field_label: field === null ? null : (LABEL[field] ?? field),
  citation,
  failure_message,
});

const OUTCOMES = [
  rule("YJ-01", "PASSED", "age", "만 19세~34세 이하"),
  rule("YJ-02", "PASSED", "household_head_status", "세대주 및 세대주예정자"),
  rule("YJ-04", "FAILED", "lease_deposit_krw", "임차보증금 3억원 이하*(단서)*", "임차보증금이 3억원을 넘음"),
  rule("YJ-05", "MISSING_VALUE", "net_asset_krw", null),
  rule("YJ-06", "IMPRECISE", "combined_annual_income_krw", "연소득 5천만원 이하", "소득 초과"),
  rule("YJ-07", "SUPERSEDED", "region", "수도권"),
  rule("YJ-08", "NOT_APPLICABLE", "military_service_years", "병역"),
  rule("YJ-09", "NOT_REVIEWED", "employment_category", "중소기업"),
  rule("YJ-10", "NOT_REVIEWED", "move_in_date", "전입일"),
  rule("YJ-11", "NEW_KIND", "age", "새 종류"),
];

/** 카드의 '판정 근거 자세히 보기'를 펼치고 그 안을 돌려준다 */
async function details(name = "가상 청년 상품 가") {
  const user = userEvent.setup();
  const article = card(name);
  await user.click(within(article).getByText("판정 근거 자세히 보기"));
  return article.querySelector("details")!;
}

describe("S5 규칙별 판정 — 설계서 표 순서와 기본 펼침/접힘", () => {
  it("불충족·값 없음·걸침·모르는 코드는 펼쳐 있고, 통과·대체·대상 아님은 접혀 건수만, 검수 대기는 건수 주의 + 접힘", async () => {
    server({ [ASSESS]: () => assessment(program({ status: "NOT_MATCHED", loan_limit: null, rule_outcomes: OUTCOMES })) });
    await open();
    const box = await details();

    const opened = ["불충족 1건", "값 없음 1건", "값이 기준에 걸쳐 판단 불가 1건", "NEW_KIND 1건"];
    const titles = within(box).getAllByRole("heading", { level: 5 }).map((h) => h.textContent);
    expect(titles).toEqual(opened);
    for (const t of opened) expect(within(box).getByText(t)).toBeVisible();

    for (const t of ["통과 2건", "특례로 대체됨 1건", "적용 대상 아님 1건", "검수 대기 규칙 2건 보기"]) {
      const fold = within(box).getByText(t).closest("details")!;
      expect(fold).not.toHaveAttribute("open");
    }
    // 접힌 안의 규칙은 보이지 않는다
    expect(within(box).getByText("YJ-01")).not.toBeVisible();
    // 검수 대기 건수는 접혀 있어도 늘 보인다(G9)
    expect(within(box).getByText("2건은 검수 전이라 이번 판정에 쓰이지 않았습니다")).toBeVisible();
  });

  it("불충족만 빨간 사유를 붙이고, 머리에는 항목 이름표와 작은 규칙 번호(결함 D4)", async () => {
    server({ [ASSESS]: () => assessment(program({ rule_outcomes: OUTCOMES })) });
    await open();
    const box = await details();
    const failed = within(box).getByText("YJ-04").closest("li")!;
    expect(failed).toHaveTextContent("YJ-04임차보증금— 임차보증금이 3억원을 넘음");
    expect(within(failed).getByText("— 임차보증금이 3억원을 넘음").className).toMatch(/failure/);
    // 걸침 규칙의 failure_message는 붙이지 않는다(설계서 8.2 — 사유 빨강은 불충족만)
    expect(within(box).getByText("YJ-06").closest("li")).not.toHaveTextContent("소득 초과");
    expect(box).not.toHaveTextContent("lease_deposit_krw");
    // 파생 항목도 이름표로
    expect(within(box).getByText("YJ-07").closest("li")).toHaveTextContent("수도권 여부");
  });

  it("원문 인용은 서식 없이 글자 그대로(G8), 없으면 '이 규칙에는 원문 인용이 붙어 있지 않습니다'", async () => {
    server({ [ASSESS]: () => assessment(program({ rule_outcomes: OUTCOMES })) });
    await open();
    const box = await details();
    expect(within(box).getByText("임차보증금 3억원 이하*(단서)*")).toBeInTheDocument();
    expect(box.querySelector("em, strong i, i")).toBeNull();
    expect(within(box).getByText("YJ-05").closest("li")).toHaveTextContent("이 규칙에는 원문 인용이 붙어 있지 않습니다");
  });

  it("규칙 결과가 없으면 '규칙 결과를 응답에서 받지 못했습니다'", async () => {
    server();
    await open();
    expect(await details()).toHaveTextContent("규칙 결과를 응답에서 받지 못했습니다");
  });

  it("항목 이름은 서버가 준 field_label — 화면 항목 목록에 없는 파생 항목도 (결함 D4)", async () => {
    const derived = { ...rule("YJ-12", "PASSED", "household_size_bucket", "세대원 수"), field_label: "세대원 수 구간" };
    server({ [ASSESS]: () => assessment(program({ rule_outcomes: [derived] })), "GET /v1/fields": () => json({ detail: "x" }, 500) });
    await open();
    const box = await details();
    expect(within(box).getByText("YJ-12").closest("li")).toHaveTextContent("세대원 수 구간");
    expect(box).not.toHaveTextContent("household_size_bucket");
  });

  it("field_label이 없으면 항목 목록의 이름으로", async () => {
    const bare = [{ ...rule("YJ-04", "FAILED", "lease_deposit_krw", "x", "넘음"), field_label: null }];
    server({ [ASSESS]: () => assessment(program({ rule_outcomes: bare })) });
    await open();
    const box = await details();
    expect(within(box).getByText("YJ-04").closest("li")).toHaveTextContent("임차보증금");
    expect(box).not.toHaveTextContent("lease_deposit_krw");
  });

  it("field_label도 항목 목록도 없으면 코드를 작게 (설계서 S4 상태표)", async () => {
    const bare = [{ ...rule("YJ-04", "FAILED", "lease_deposit_krw", "x", "넘음"), field_label: null }];
    server({ [ASSESS]: () => assessment(program({ rule_outcomes: bare })), "GET /v1/fields": () => json({ detail: "x" }, 500) });
    await open();
    expect(within(await details()).getByText("lease_deposit_krw").className).toMatch(/code/);
  });
});

describe("S5 한도 계산 근거·아직 다루지 않는 조건·출처", () => {
  it("금액·계산·서버 이름표로 적용 구간·근거 규칙·인용", async () => {
    const limit = { ...program().loan_limit!, tier: "under_25_single", tier_label: "만 25세 미만 단독세대주" };
    server({ [ASSESS]: () => assessment(program({ loan_limit: limit, unresolved: ["증액갱신계약은 다루지 않음"] })) });
    await open();
    const box = await details();
    expect(box).toHaveTextContent("금액1억 4,400만원");
    expect(box).toHaveTextContent("계산보증금 비율로 구한 1억 4,400만원과 금액 상한 1억 5,000만원 중 작은 쪽입니다 — 보증금 비율에 걸렸습니다");
    expect(box).toHaveTextContent("적용 구간만 25세 미만 단독세대주");
    expect(box).not.toHaveTextContent("under_25_single");
    expect(box).toHaveTextContent("근거 규칙B-12");
    expect(box).toHaveTextContent("임차보증금의 80%이내에서 최고 1억 5천만원 이내");
    expect(box).not.toHaveTextContent("단서");
    expect(box).toHaveTextContent("증액갱신계약은 다루지 않음");
  });

  it("적용 구간 줄은 기본 구간도 이름표로 보이고, 확정이 아니면 단서를 단다", async () => {
    server({ [ASSESS]: () => assessment(program({ status: "INSUFFICIENT_INFORMATION", missing_fields: ["net_asset_krw", "age"] })) });
    await open();
    const box = await details();
    expect(box).toHaveTextContent("적용 구간그 밖의 가구");
    expect(box).not.toHaveTextContent("default");
    expect(box).not.toHaveTextContent("확인 못 한 구간");
    expect(box).toHaveTextContent("단서아직 확인되지 않은 조건이 2개 있어 이 금액은 달라질 수 있습니다");
  });

  it("해당 여부를 몰라 건너뛴 구간은 서버 이름표로 한 줄", async () => {
    const limit = {
      ...program().loan_limit!,
      skipped_tiers: ["newlywed_or_two_children", "first_time"],
      skipped_tier_labels: ["신혼 가구 또는 2자녀 이상 가구", "생애최초 주택구입자"],
    };
    server({ [ASSESS]: () => assessment(program({ loan_limit: limit })) });
    await open();
    const box = await details();
    expect(box).toHaveTextContent(
      "확인 못 한 구간신혼 가구 또는 2자녀 이상 가구, 생애최초 주택구입자 — 해당 여부를 몰라 계산에 쓰지 않았습니다",
    );
    expect(box).not.toHaveTextContent("newlywed_or_two_children");
  });

  it("조건 불충족이면 한도 계산 근거 자리에 '이 판정에서는 한도를 계산하지 않았습니다'", async () => {
    server({ [ASSESS]: () => assessment(program({ status: "NOT_MATCHED", loan_limit: null, rule_version: null })) });
    await open();
    const box = await details();
    expect(box).toHaveTextContent("이 판정에서는 한도를 계산하지 않았습니다");
    expect(box).toHaveTextContent("이 상품에 적어 둔 미해결 조건이 없습니다");
    expect(box).toHaveTextContent("자료 확인일 2026-09-08");
    expect(box).toHaveTextContent("규칙 버전 표시 없음");
    expect(within(box).getByRole("link", { name: /example\.invalid\/1/ })).toHaveAttribute("href", "https://example.invalid/1");
  });
});

describe("S6 확인 과정", () => {
  it("기본은 접혀 있고, 펼치면 기록 종류별 한 줄과 그 아래 TRACE_NOTE가 글자 그대로", async () => {
    const user = userEvent.setup();
    server({
      [TRACE]: () =>
        traceOf([
          ...EVENTS.slice(0, 3),
          event("FIELD_SET", { values: { lease_deposit_krw: 180_000_000, combined_annual_income_krw: { low: 45_000_000, high: 50_000_000 } } }),
          event("FIELD_SET", { values: { is_first_time_buyer: false, age: null } }),
          ...EVENTS.slice(3),
        ]),
    });
    await open();
    const summary = screen.getByText("어떤 순서로 무엇을 확인했나");
    const box = summary.closest("details")!;
    expect(box).not.toHaveAttribute("open");
    await user.click(summary);
    const lines = within(box).getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toEqual([
      // 테스트 항목 목록(testing.tsx FIELDS)에 전세·매매 항목이 없어 코드로 나온다. 실제 서버 목록에는 있다
      "문장에서 읽음 — 나이, intended_tenure",
      "세대주 여부 — 세대주임",
      "임차보증금 — 1억 8,000만원",
      "부부합산 총소득 — 4,500만~5,000만원",
      "생애최초 주택구입 — 아니오",
      "나이 — 비움",
      "임차보증금 — 모른다고 함",
      "판정함",
    ]);
    expect(screen.getByText(NOTICE.trace)).toBeInTheDocument();
    expect(NOTICE.trace).toBe("입력하신 문장 전체는 저장하지 않습니다. 위에 보이는 값과 근거 구절은 서버에 남습니다.");
  });

  it("이어진 '판정함'은 결과가 같으면 한 줄로 — 시간 초과 뒤 다시 시도해 서버가 두 번 판정한 경우", async () => {
    const user = userEvent.setup();
    const same = { results: [{ program_id: "p-youth", status: "PRECHECK_MATCH", rule_version: 2 }] };
    const other = { results: [{ program_id: "p-youth", status: "CONDITIONAL", rule_version: 2 }] };
    server({
      [TRACE]: () =>
        traceOf([
          event("FIELD_SET", { values: { age: 30 } }),
          event("ASSESSED", same),
          event("ASSESSED", same),
          event("ASSESSED", other),
          event("FIELD_SET", { values: { age: 31 } }),
          event("ASSESSED", other),
        ]),
    });
    await open();
    await user.click(screen.getByText("어떤 순서로 무엇을 확인했나"));
    const box = screen.getByText("어떤 순서로 무엇을 확인했나").closest("details")!;
    expect(within(box).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "나이 — 30",
      "판정함",
      "판정함",
      "나이 — 31",
      "판정함",
    ]);
  });

  it("기록을 못 받으면 '기록을 불러오지 못했습니다. (사유)'와 다시 시도, 결과는 그대로", async () => {
    const user = userEvent.setup();
    let fail = true;
    server({ [TRACE]: () => (fail ? json({ detail: "기록 저장소 오류" }, 500) : traceOf()) });
    await open();
    expect(screen.getByRole("heading", { level: 3, name: "가상 청년 상품 가" })).toBeInTheDocument();
    const box = screen.getByText("어떤 순서로 무엇을 확인했나").closest("details")!;
    await user.click(screen.getByText("어떤 순서로 무엇을 확인했나"));
    expect(box).toHaveTextContent("기록을 불러오지 못했습니다. 기록 저장소 오류");
    fail = false;
    await user.click(within(box).getByRole("button", { name: "다시 시도" }));
    expect(await within(box).findByText("판정함")).toBeInTheDocument();
  });
});

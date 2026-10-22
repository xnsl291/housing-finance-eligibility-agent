/*
 * S7 계산 — 목록 줄(값 + 모른다고 한 항목, 서버 declined_of와 같은 규칙)과 다시 판정한 뒤 바뀐 곳.
 */
import type { HeldValue, TraceEvent } from "../api/types";
import { changeLines, heldItems } from "./heldItems";
import { program } from "./resultTesting";
import { FIELDS } from "./testing";

const ev = (seq: number, kind: string, payload: Record<string, unknown>): TraceEvent => ({ seq, at: "t", kind, payload });
const held = (value: HeldValue["value"], source: HeldValue["source"] = "USER"): HeldValue => ({ value, source, at: "t", phrase: null });

describe("heldItems — 목록 줄", () => {
  it("모른다고 한 뒤 값을 넣으면 풀리고, 값을 지우는 것(null)만으로는 모름이 생기지도 풀리지도 않는다", () => {
    const events = [
      ev(1, "FIELD_DECLINED", { field: "age" }),
      ev(2, "FIELD_DECLINED", { field: "lease_deposit_krw" }),
      ev(3, "FIELD_SET", { values: { age: 30, lease_deposit_krw: null } }),
    ];
    const items = heldItems({ age: held(30) }, events, FIELDS);
    expect(items.map((i) => [i.field, i.source, i.shown])).toEqual([
      ["age", "direct", "30"],
      ["lease_deposit_krw", "declined", null],
    ]);
  });

  it("금액은 억·만, 범위는 범위, 선택지는 한국어 이름표로 보인다", () => {
    const items = heldItems(
      {
        lease_deposit_krw: held(180_000_000),
        combined_annual_income_krw: held({ low: 45_000_000, high: 50_000_000 }, "LLM"),
        household_head_status: held("HEAD"),
      },
      [],
      FIELDS,
    );
    expect(Object.fromEntries(items.map((i) => [i.field, i.shown]))).toEqual({
      lease_deposit_krw: "1억 8,000만원",
      combined_annual_income_krw: "4,500만~5,000만원",
      household_head_status: "세대주임",
    });
    expect(items.find((i) => i.field === "combined_annual_income_krw")?.source).toBe("read");
  });

  it("값이 있는데 모른다고도 한 항목(범위 값을 다시 물었을 때 모르겠어요)은 값 줄이고 declined가 켜진다", () => {
    const events = [
      ev(1, "EXTRACTED", { values: { combined_annual_income_krw: { low: 45_000_000, high: 50_000_000 } } }),
      ev(2, "FIELD_DECLINED", { field: "combined_annual_income_krw" }),
    ];
    const items = heldItems(
      { combined_annual_income_krw: held({ low: 45_000_000, high: 50_000_000 }, "LLM"), age: held(30) },
      events,
      FIELDS,
    );
    expect(items.map((i) => [i.field, i.source, i.declined])).toEqual([
      ["age", "direct", false],
      ["combined_annual_income_krw", "read", true],
    ]);
  });
});

describe("changeLines — 바뀐 곳", () => {
  it("판정이 바뀐 상품, 금액이 바뀐 상품만 적는다. 금액이 한쪽만 있으면 금액 줄을 만들지 않는다", () => {
    const before = [program(), program({ program_id: "p-2", program_name: "나", status: "CONDITIONAL" })];
    const after = [
      program({ loan_limit: { ...program().loan_limit!, amount_krw: 120_000_000 } }),
      program({ program_id: "p-2", program_name: "나", status: "NOT_MATCHED", loan_limit: null }),
    ];
    expect(changeLines(before, after)).toEqual([
      "가상 청년 상품 가 — 한도 1억 4,400만원 → 1억 2,000만원",
      "나 — 추가 확인 필요 → 조건 불충족",
    ]);
    expect(changeLines(before, before)).toEqual([]);
  });

  it("후보에서 빠지거나 새로 들어온 상품을 적는다(전세·매매를 고친 경우)", () => {
    const youth = program();
    const buy = program({ program_id: "p-buy", program_name: "가상 상품 나" });
    expect(changeLines([youth], [buy])).toEqual(["가상 상품 나 — 이번에 새로 봤습니다", "가상 청년 상품 가 — 이번에는 보지 않았습니다"]);
  });
});

describe("changeLines — 한도 표기(G7)", () => {
  const limit = program().loan_limit!;
  const won = (amount_krw: number | null) => ({ ...limit, amount_krw, reason: amount_krw === null ? "BASE_UNKNOWN" : null });
  /** 판정이 끝나지 않은 상품(추가 확인 필요, 남은 조건 1개) */
  const open = (amount: number | null) =>
    program({ status: "CONDITIONAL", missing_fields: ["net_asset_krw"], loan_limit: won(amount) });
  const final = (amount: number | null) => program({ loan_limit: won(amount) });

  it("확정이 아닌 한도는 '지금까지 확인된 조건 기준'을 붙인다", () => {
    expect(changeLines([open(144_000_000)], [open(120_000_000)])).toEqual([
      "가상 청년 상품 가 — 지금까지 확인된 조건 기준 한도 1억 4,400만원 → 1억 2,000만원",
    ]);
    expect(changeLines([final(144_000_000)], [final(120_000_000)])).toEqual([
      "가상 청년 상품 가 — 한도 1억 4,400만원 → 1억 2,000만원",
    ]);
  });

  it("판정이 같아도 한도가 없다가 생기거나 있다가 없어지면 적는다 — '판정과 한도는 그대로'가 거짓이 되지 않게", () => {
    expect(changeLines([open(null)], [open(120_000_000)])).toEqual([
      "가상 청년 상품 가 — 한도를 이번에 계산했습니다: 지금까지 확인된 조건 기준 1억 2,000만원",
    ]);
    expect(changeLines([final(null)], [final(120_000_000)])).toEqual([
      "가상 청년 상품 가 — 한도를 이번에 계산했습니다: 1억 2,000만원",
    ]);
    expect(changeLines([final(144_000_000)], [final(null)])).toEqual(["가상 청년 상품 가 — 한도를 이번에는 계산하지 못했습니다"]);
  });

  it("금액이 같아도 확정 여부가 바뀌면 적는다", () => {
    expect(changeLines([open(144_000_000)], [final(144_000_000)])).toEqual([
      "가상 청년 상품 가 — 추가 확인 필요 → 사전 조건 부합",
      "가상 청년 상품 가 — 한도 지금까지 확인된 조건 기준 1억 4,400만원 → 1억 4,400만원",
    ]);
  });

  it("조건 불충족 상품의 한도는 어떤 경우에도 금액을 쓰지 않는다", () => {
    const notMatched = (amount: number | null) => program({ status: "NOT_MATCHED", loan_limit: won(amount) });
    const lines = [
      ...changeLines([notMatched(144_000_000)], [notMatched(120_000_000)]),
      ...changeLines([notMatched(null)], [final(120_000_000)]),
      ...changeLines([final(144_000_000)], [notMatched(120_000_000)]),
      ...changeLines([], [notMatched(120_000_000)]),
    ];
    expect(lines.join(" / ")).not.toMatch(/만원|한도/);
  });
});

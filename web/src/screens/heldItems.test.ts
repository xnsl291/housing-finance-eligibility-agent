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

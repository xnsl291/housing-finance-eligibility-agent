/*
 * S4 판정 결과 — 멈춘 이유, 후보만 판정, 정렬, 카드, 왜 이 상품만 보이나, 확정 표현 없음.
 * 실패·버튼은 Result.flow.test.tsx, 판정 근거(S5)·확인 과정(S6)은 Result.details.test.tsx.
 */
import { screen, waitFor, within } from "@testing-library/react";

import type { NextAction } from "../api/types";
import { ask, CHOICE_Q, result } from "./questionsTesting";
import { ASSESS, assessment, card, event, open, program, server, traceOf } from "./resultTesting";
import { callsTo, json } from "./testing";

afterEach(() => vi.restoreAllMocks());

describe("멈춘 이유 (설계서 8.4) — next가 RESULT면 그 이유, ASK면 사용자가 멈춤", () => {
  it.each<[string, () => Response, string, string]>([
    ["COMPLETE", () => result("COMPLETE"), "모두 확인했습니다", "판정에 필요한 항목을 모두 확인했습니다."],
    [
      "ALL_NOT_MATCHED",
      () => result("ALL_NOT_MATCHED"),
      "더 물어도 바뀌지 않습니다",
      "확인한 조건으로는 남은 상품 모두 조건에 맞지 않아 더 묻지 않았습니다. 아래에서 어느 조건 때문인지 확인할 수 있습니다.",
    ],
    [
      "ONLY_DECLINED_LEFT",
      () => result("ONLY_DECLINED_LEFT", ["household_head_status", "lease_deposit_krw"]),
      "모르신 항목이 남았습니다",
      "세대주 여부, 임차보증금을(를) 모르셔서 확정하지 못한 부분이 있습니다. 확인되면 이어서 판정할 수 있습니다.",
    ],
    [
      "ASK → USER_STOPPED",
      () => ask(CHOICE_Q),
      "중간에 멈췄습니다",
      "질문을 중간에 멈췄습니다. 지금까지 확인한 값으로만 판정했습니다.",
    ],
    [
      "모르는 이유",
      () => json({ session_id: "s-1", action: "RESULT", candidates: [], policy_version: 1, reason: "NEW_REASON" }),
      "판정했습니다",
      "판정했습니다.",
    ],
  ])("%s", async (_name, next, title, body) => {
    server({ "GET /v1/sessions/s-1/next": next });
    await open();
    const banner = screen.getByText(title).closest("div")!.parentElement!;
    expect(banner).toHaveTextContent(body);
  });

  it("항목 목록을 못 받으면 모른다고 한 항목이 코드로 나온다 (설계서 S4 상태표)", async () => {
    server({
      "GET /v1/sessions/s-1/next": () => result("ONLY_DECLINED_LEFT", ["household_head_status"]),
      "GET /v1/fields": () => json({ detail: "x" }, 500),
    });
    await open();
    expect(screen.getByText(/을\(를\) 모르셔서/)).toHaveTextContent("household_head_status을(를) 모르셔서");
  });
});

describe("후보 상품만 판정한다", () => {
  it("next가 준 후보 목록을 판정 본문에 그대로 보낸다", async () => {
    const spy = server();
    await open();
    const [, init] = callsTo(spy, ASSESS)[0];
    expect(JSON.parse(String(init?.body))).toEqual(["p-youth", "p-buy"]);
  });

  it("후보가 비어 있으면 본문을 보내지 않는다 — 빈 목록은 서버가 '전부'로 읽는다", async () => {
    const empty: NextAction = { session_id: "s-1", action: "RESULT", candidates: [], policy_version: 1, reason: "COMPLETE" };
    const spy = server({ "GET /v1/sessions/s-1/next": () => json(empty) });
    await open();
    expect(callsTo(spy, ASSESS)[0][1]?.body).toBeUndefined();
  });

  it("판정은 멈춘 이유를 받은 뒤에, 기록은 판정 뒤에 부른다 — 방금 한 판정이 기록에 들어가게", async () => {
    const spy = server();
    await open();
    const order = spy.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`).filter((k) => k.includes("s-1"));
    expect(order).toEqual(["GET /v1/sessions/s-1/next", ASSESS, "GET /v1/sessions/s-1/trace"]);
  });
});

describe("상품 카드", () => {
  const four = () =>
    assessment(
      program({ program_id: "a", program_name: "불충족 상품", status: "NOT_MATCHED", loan_limit: null, next_actions: ["임차보증금이 3억원을 넘음"] }),
      program({ program_id: "b", program_name: "부족 상품", status: "INSUFFICIENT_INFORMATION", missing_fields: ["net_asset_krw"], next_actions: ["순자산 정보가 필요합니다"] }),
      program({ program_id: "c", program_name: "부합 상품", next_actions: ["생애최초 주택구입에 해당하면 한도가 더 늘어날 수 있습니다"] }),
      program({ program_id: "d", program_name: "확인 상품", status: "CONDITIONAL", imprecise_fields: ["combined_annual_income_krw"], next_actions: ["부부합산 총소득이 기준에 걸칩니다. 정확한 값을 알려주세요"] }),
    );

  it("판정 순(부합 → 추가 확인 → 정보 부족 → 불충족)으로 늘어선다 (13절 Q2)", async () => {
    server({ [ASSESS]: four });
    await open();
    const names = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(["부합 상품", "확인 상품", "부족 상품", "불충족 상품"]);
  });

  it("판정별 목록 제목이 판정에 따라 다르다", async () => {
    server({ [ASSESS]: four });
    await open();
    // 첫 h4가 판정별 목록 제목. 그 뒤 h4는 접힌 판정 근거(S5)의 묶음 제목
    const title = (name: string) => within(card(name)).getAllByRole("heading", { level: 4 })[0].textContent;
    expect(title("불충족 상품")).toBe("맞지 않는 조건");
    expect(title("부족 상품")).toBe("더 알려 주시면 판정할 수 있는 것");
    expect(title("확인 상품")).toBe("더 알려 주시면 판정할 수 있는 것");
    expect(title("부합 상품")).toBe("참고");
  });

  it("한도 네 경우 — 불충족은 한도 줄이 없고, 부합+남은 0개만 '예상 대출 한도', 나머지는 단서", async () => {
    server({ [ASSESS]: four });
    await open();
    // 판정 근거(S5)의 '한도 계산 근거' 제목은 있으므로 금액과 한도 줄 이름이 없는지를 본다
    expect(card("불충족 상품")).not.toHaveTextContent(/만원|예상 대출 한도|확인된 조건 기준 한도/);
    expect(card("부합 상품")).toHaveTextContent("예상 대출 한도1억 4,400만원");
    expect(card("확인 상품")).toHaveTextContent("지금까지 확인된 조건 기준 한도");
    expect(card("확인 상품")).toHaveTextContent("아직 확인되지 않은 조건이 1개 있어 이 금액은 달라질 수 있습니다");
    expect(card("확인 상품")).not.toHaveTextContent("예상 대출 한도");
  });

  it("한도 설명은 어느 상한에 걸렸는지, 매매 상품은 주택가격 비율로 말한다", async () => {
    server({
      [ASSESS]: () =>
        assessment(
          program(),
          program({
            program_id: "p-buy",
            program_name: "가상 상품 나",
            loan_limit: { ...program().loan_limit!, amount_krw: 200_000_000, ratio_amount_krw: 280_000_000, cap_amount_krw: 200_000_000 },
          }),
        ),
    });
    await open();
    expect(card("가상 청년 상품 가")).toHaveTextContent(
      "보증금 비율로 구한 1억 4,400만원과 금액 상한 1억 5,000만원 중 작은 쪽입니다 — 보증금 비율에 걸렸습니다",
    );
    expect(card("가상 상품 나")).toHaveTextContent(
      "주택가격 비율로 구한 2억 8,000만원과 금액 상한 2억원 중 작은 쪽입니다 — 금액 상한에 걸렸습니다",
    );
  });

  it("계산 근거가 없으면 설계서 문구, 금액을 못 냈으면 8.3 사유", async () => {
    const limit = program().loan_limit!;
    server({
      [ASSESS]: () =>
        assessment(
          program({ program_name: "근거 없음", loan_limit: { ...limit, ratio_amount_krw: null } }),
          program({ program_id: "x", program_name: "금액 없음", loan_limit: { ...limit, amount_krw: null, reason: "REGION_UNKNOWN" } }),
        ),
    });
    await open();
    expect(card("근거 없음")).toHaveTextContent("계산 근거를 응답에서 받지 못했습니다");
    expect(card("금액 없음")).toHaveTextContent("지역에 따라 한도가 달라집니다. 주택 소재지를 입력해 주세요");
  });

  it("상품이 없으면 '판정한 상품이 없습니다.'", async () => {
    server({ [ASSESS]: () => assessment() });
    await open();
    expect(screen.getByText("판정한 상품이 없습니다.")).toBeInTheDocument();
  });

  it("확정 표현(승인·가능합니다·대출 가능·자격 있음)이 결과 자리에 없다 (G1)", async () => {
    server({ [ASSESS]: four });
    await open();
    for (const article of screen.getAllByRole("article")) {
      expect(article).not.toHaveTextContent(/승인|가능합니다|대출 가능|자격 있음/);
    }
    expect(screen.getByText(/^판정에 필요한 항목을/).closest("div")).not.toHaveTextContent(/승인|가능합니다/);
  });
});

describe("왜 이 상품만 보이나 (설계서 S3 끝 표)", () => {
  it.each([
    ["문장에서 전세로 읽음", [event("EXTRACTED", { values: { intended_tenure: "JEONSE" } })], "전세를 구하신다고 해서 매매 상품은 빼고 봤습니다"],
    ["매매라고 답함", [event("FIELD_SET", { values: { intended_tenure: "PURCHASE" } })], "집을 사신다고 해서 전세 상품은 빼고 봤습니다"],
    ["모른다고 함", [event("FIELD_DECLINED", { field: "intended_tenure" })], "전세인지 매매인지 모르셔서 세 상품을 모두 봤습니다"],
    [
      "모른다고 한 뒤 답함 — 모름이 풀린다",
      [event("FIELD_DECLINED", { field: "intended_tenure" }), event("FIELD_SET", { values: { intended_tenure: "JEONSE" } })],
      "전세를 구하신다고 해서 매매 상품은 빼고 봤습니다",
    ],
    [
      "값이 있는데 모른다고 함 — 값이 남는다",
      [event("FIELD_SET", { values: { intended_tenure: "PURCHASE" } }), event("FIELD_DECLINED", { field: "intended_tenure" })],
      "집을 사신다고 해서 전세 상품은 빼고 봤습니다",
    ],
    ["아직 묻지 않음", [event("FIELD_SET", { values: { age: 30 } })], "전세인지 매매인지 아직 여쭙지 않아 세 상품을 모두 봤습니다"],
  ])("%s", async (_name, events, line) => {
    server({ "GET /v1/sessions/s-1/trace": () => traceOf(events) });
    await open();
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it("기록을 못 받으면 그 줄을 그리지 않는다 — 짐작하지 않는다", async () => {
    server({ "GET /v1/sessions/s-1/trace": () => json({ detail: "x" }, 500) });
    await open();
    await waitFor(() => expect(screen.queryByText(/상품은 빼고 봤습니다|모두 봤습니다/)).not.toBeInTheDocument());
  });
});

/*
 * S4 판정 결과 — 멈춘 이유, 후보만 판정, 정렬, 카드, 왜 이 상품만 보이나, 확정 표현 없음.
 * 실패·버튼은 Result.flow.test.tsx, 판정 근거(S5)·확인 과정(S6)은 Result.details.test.tsx.
 */
import { screen, waitFor, within } from "@testing-library/react";

import type { NextAction } from "../api/types";
import { ask, CHOICE_Q, result } from "./questionsTesting";
import { ASSESS, assessment, card, event, NEXT, open, program, server, TRACE, traceOf } from "./resultTesting";
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

  it("후보가 없으면 판정을 부르지 않고 '판정한 상품이 없습니다.' — 빈 목록을 보내면 서버가 전부 판정한다", async () => {
    const empty: NextAction = { session_id: "s-1", action: "RESULT", candidates: [], policy_version: 1, reason: "COMPLETE" };
    const spy = server({ [NEXT]: () => json(empty) });
    await open();
    expect(callsTo(spy, ASSESS)).toHaveLength(0);
    expect(screen.getByText("판정한 상품이 없습니다.")).toBeInTheDocument();
    expect(callsTo(spy, TRACE)).toHaveLength(1);
  });

  it("판정은 멈춘 이유를 받은 뒤에, 기록·세션 값은 판정 뒤에 부른다 — 방금 한 판정이 기록에 들어가게", async () => {
    const spy = server();
    await open();
    const order = spy.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`).filter((k) => k.includes("s-1"));
    expect(order.slice(0, 2)).toEqual(["GET /v1/sessions/s-1/next", ASSESS]);
    // 기록과 세션 값(S7 요약)은 함께 부르므로 둘 사이 순서는 정하지 않는다
    expect(order.slice(2).sort()).toEqual(["GET /v1/sessions/s-1", "GET /v1/sessions/s-1/trace"]);
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

  it("판정은 맞는데 한도를 못 냈으면 그 사유는 한 번만 — '참고' 목록에 같은 말을 다시 두지 않는다", async () => {
    const limit = { ...program().loan_limit!, amount_krw: null, tier: null, tier_label: null, reason: "BASE_UNKNOWN" };
    server({
      [ASSESS]: () => assessment(program({ loan_limit: limit, next_actions: ["대출 한도를 보려면 임차보증금을 알려주세요"] })),
    });
    await open();
    const box = card("가상 청년 상품 가");
    expect(box).toHaveTextContent("한도 계산에 쓰는 금액을 입력하면 한도를 계산할 수 있습니다");
    expect(box).not.toHaveTextContent("대출 한도를 보려면 임차보증금을 알려주세요");
    expect(within(box).queryByRole("heading", { level: 4, name: "참고" })).not.toBeInTheDocument();
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

describe("왜 이 상품만 보이나 (설계서 S3 끝 표) — 후보 상품과 모른다고 한 기록으로", () => {
  const ALL = ["p-youth", "p-buy"];
  const nextWith = (candidates: string[], declined: string[] = []) => () =>
    json({
      session_id: "s-1",
      action: "RESULT",
      reason: declined.length ? "ONLY_DECLINED_LEFT" : "COMPLETE",
      candidates,
      policy_version: 1,
      declined_needed: declined,
    });
  const fails = () => json({ detail: "x" }, 500);
  const tenure = (value: string | null) => event("FIELD_SET", { values: { intended_tenure: value } });
  const declined = () => event("FIELD_DECLINED", { field: "intended_tenure" });

  it.each<[string, string[], string[], () => Response, string]>([
    ["전세 상품만 후보", ["p-youth"], [], () => traceOf(), "전세를 구하신다고 해서 매매 상품은 빼고 봤습니다"],
    ["매매 상품만 후보", ["p-buy"], [], () => traceOf([tenure("PURCHASE")]), "집을 사신다고 해서 전세 상품은 빼고 봤습니다"],
    [
      "값이 있는데 모른다고 함 — 값이 남는다",
      ["p-buy"],
      [],
      () => traceOf([tenure("PURCHASE"), declined()]),
      "집을 사신다고 해서 전세 상품은 빼고 봤습니다",
    ],
    ["모른다고 함", ALL, [], () => traceOf([declined()]), "전세인지 매매인지 모르셔서 상품 2개를 모두 봤습니다"],
    [
      "모른다고 한 뒤 값을 비움 — 비우는 것만으로는 모름이 풀리지 않는다(session.py declined_of)",
      ALL,
      [],
      () => traceOf([declined(), tenure(null)]),
      "전세인지 매매인지 모르셔서 상품 2개를 모두 봤습니다",
    ],
    [
      "모른다고 한 뒤 답하고 그 값을 비움 — 답한 순간 모름이 풀렸다",
      ALL,
      [],
      () => traceOf([declined(), tenure("JEONSE"), tenure(null)]),
      "전세·매매를 답하지 않으셔서 상품 2개를 모두 봤습니다",
    ],
    [
      "답하지 않음(묻기 전에 멈췄거나 물을 필요가 없었음)",
      ALL,
      [],
      () => traceOf([event("FIELD_SET", { values: { age: 30 } })]),
      "전세·매매를 답하지 않으셔서 상품 2개를 모두 봤습니다",
    ],
    ["기록을 못 받아도 후보로 안다", ["p-youth"], [], fails, "전세를 구하신다고 해서 매매 상품은 빼고 봤습니다"],
    [
      "기록을 못 받아도 멈춘 이유가 전세·매매를 모른다고 알려 줌",
      ALL,
      ["intended_tenure"],
      fails,
      "전세인지 매매인지 모르셔서 상품 2개를 모두 봤습니다",
    ],
    ["기록을 못 받고 모른다고 했는지도 모름 — 어느 쪽이든 참인 말로", ALL, [], fails, "전세·매매를 답하지 않으셔서 상품 2개를 모두 봤습니다"],
  ])("%s", async (_name, candidates, declinedNeeded, trace, line) => {
    server({ [NEXT]: nextWith(candidates, declinedNeeded), [TRACE]: trace });
    await open();
    expect(await screen.findByText(line)).toBeInTheDocument();
  });

  it("상품 목록을 못 받으면 그 줄을 그리지 않는다 — 어느 쪽 상품인지 모른다", async () => {
    server({ [NEXT]: nextWith(["p-youth"]), "GET /v1/programs": fails });
    await open();
    await waitFor(() => expect(screen.queryByText(/빼고 봤습니다|모두 봤습니다/)).not.toBeInTheDocument());
  });

  it("멈춘 이유와 이 한 줄은 제목(h1) 아래 — 결과 화면에 들어오면 초점이 제목으로 가므로 위에 두면 건너뛴다", async () => {
    server({ [NEXT]: nextWith(["p-youth"]) });
    await open();
    const h1 = screen.getByRole("heading", { level: 1 });
    for (const text of ["모두 확인했습니다", "전세를 구하신다고 해서 매매 상품은 빼고 봤습니다"]) {
      const node = await screen.findByText(text);
      expect(h1.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});
